import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockRpc, mockFrom, usersResult, mockSend } = vi.hoisted(() => {
  const usersResult: { value: { data: unknown; error: unknown } } = {
    value: { data: [], error: null },
  };
  const builder: Record<string, unknown> = {};
  for (const m of ["select", "in"]) builder[m] = vi.fn(() => builder);
  builder.then = (resolve: (v: unknown) => unknown) =>
    Promise.resolve(usersResult.value).then(resolve);
  return {
    mockRpc: vi.fn(),
    mockFrom: vi.fn(() => builder),
    usersResult,
    mockSend: vi.fn(),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { rpc: mockRpc, from: mockFrom },
}));
vi.mock("@/services/email/email", () => ({
  sendGuardianshipAgeOutEmail: mockSend,
}));

import { agedOutResponse, runGuardianshipAgeOuts } from "../age-out";

const GUARDIAN = {
  id: "g-1",
  email: "gwen@test.local",
  contact_email: null,
  first_name: "Gwen",
  last_name: "Guardian",
};
const CHILD = {
  id: "c-1",
  email: null,
  contact_email: null,
  first_name: "Sara",
  last_name: "Child",
};

function rpcReturns(ended: unknown[], notices: unknown[]) {
  mockRpc.mockImplementation(async (fn: string) =>
    fn === "end_aged_out_minor_guardianships"
      ? { data: ended, error: null }
      : { data: notices, error: null },
  );
}

beforeEach(() => {
  vi.clearAllMocks();
  usersResult.value = { data: [GUARDIAN, CHILD], error: null };
  mockSend.mockResolvedValue(undefined);
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("agedOutResponse", () => {
  it("refuses a change during the grace period", async () => {
    const res = agedOutResponse(
      { first_name: "Sara", basis: "minor", date_of_birth: "2008-11-20" },
      "2026-11-25",
    );
    expect(res?.status).toBe(409);
    const json = await res!.json();
    expect(json.error.code).toBe("AGED_OUT");
    expect(json.error.message).toContain("Sara turned 18");
  });

  it("lets a 17-year-old's guardian and an adult's helper through", () => {
    expect(
      agedOutResponse(
        { first_name: "Sara", basis: "minor", date_of_birth: "2008-12-20" },
        "2026-11-25",
      ),
    ).toBeNull();
    expect(
      agedOutResponse(
        {
          first_name: "Aziz",
          basis: "authorised",
          date_of_birth: "1960-01-01",
        },
        "2026-11-25",
      ),
    ).toBeNull();
  });
});

describe("runGuardianshipAgeOuts", () => {
  it("ends guardianships first, then claims notices, with the shared day counts", async () => {
    rpcReturns([], []);

    expect(await runGuardianshipAgeOuts()).toEqual({
      ended: 0,
      notices: 0,
      emailed: 0,
      failed: 0,
    });
    expect(mockRpc.mock.calls.map(([fn]) => fn)).toEqual([
      "end_aged_out_minor_guardianships",
      "claim_guardianship_age_out_notices",
    ]);
    expect(mockRpc).toHaveBeenCalledWith("end_aged_out_minor_guardianships", {
      p_grace_days: 30,
    });
    expect(mockRpc).toHaveBeenCalledWith("claim_guardianship_age_out_notices", {
      p_notice_days: 30,
      p_grace_days: 30,
    });
    expect(mockFrom).not.toHaveBeenCalled();
  });

  it("emails the guardian each notice, and the player when they have a contact address", async () => {
    usersResult.value = {
      data: [GUARDIAN, { ...CHILD, contact_email: "sara@test.local" }],
      error: null,
    };
    rpcReturns(
      [
        {
          guardianship_id: "gs-1",
          guardian_user_id: "g-1",
          dependent_user_id: "c-1",
          turns_18_on: "2026-10-01",
        },
      ],
      [
        {
          stage: "upcoming",
          guardianship_id: "gs-2",
          guardian_user_id: "g-1",
          dependent_user_id: "c-1",
          turns_18_on: "2026-12-05",
          access_ends_on: "2027-01-04",
        },
      ],
    );

    const stats = await runGuardianshipAgeOuts();

    expect(stats).toEqual({ ended: 1, notices: 1, emailed: 4, failed: 0 });
    expect(mockSend).toHaveBeenCalledWith(
      "gwen@test.local",
      expect.objectContaining({
        audience: "guardian",
        stage: "ended",
        recipientName: "Gwen",
        playerName: "Sara Child",
        turns18On: "1 Oct 2026",
        accessEndsOn: "31 Oct 2026",
      }),
    );
    expect(mockSend).toHaveBeenCalledWith(
      "sara@test.local",
      expect.objectContaining({
        audience: "player",
        stage: "upcoming",
        guardianName: "Gwen Guardian",
      }),
    );
  });

  it("counts a failed email without failing the run", async () => {
    rpcReturns(
      [],
      [
        {
          stage: "turned_18",
          guardianship_id: "gs-2",
          guardian_user_id: "g-1",
          dependent_user_id: "c-1",
          turns_18_on: "2026-11-20",
          access_ends_on: "2026-12-20",
        },
      ],
    );
    mockSend.mockRejectedValue(new Error("resend down"));

    expect(await runGuardianshipAgeOuts()).toEqual({
      ended: 0,
      notices: 1,
      emailed: 0,
      failed: 1,
    });
  });

  it("throws when the database refuses, so the cron reports failure", async () => {
    mockRpc.mockResolvedValue({ data: null, error: { message: "down" } });
    await expect(runGuardianshipAgeOuts()).rejects.toThrow(
      "end_aged_out_minor_guardianships failed",
    );
  });
});
