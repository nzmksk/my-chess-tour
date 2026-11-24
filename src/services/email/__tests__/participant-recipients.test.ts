import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockFrom, tables, eqCalls } = vi.hoisted(() => {
  const tables: Record<string, { data: unknown; error: unknown }> = {};
  const eqCalls: Array<[string, string, unknown]> = [];

  function makeBuilder(table: string) {
    const b: Record<string, unknown> = {};
    for (const m of ["select", "maybeSingle"]) {
      b[m] = vi.fn(() => b);
    }
    b.eq = vi.fn((col: string, val: unknown) => {
      eqCalls.push([table, col, val]);
      return b;
    });
    b.then = (
      onfulfilled: (v: unknown) => unknown,
      onrejected?: (r: unknown) => unknown,
    ) =>
      Promise.resolve(tables[table] ?? { data: null, error: null }).then(
        onfulfilled,
        onrejected,
      );
    return b;
  }

  return {
    tables,
    eqCalls,
    mockFrom: vi.fn((table: string) => makeBuilder(table)),
  };
});

vi.mock("@/services/supabase/admin", () => ({
  supabaseAdmin: { from: mockFrom },
}));

import {
  loadParticipantRecipients,
  nameForRecipient,
} from "../participant-recipients";

const PLAYER = "dddddddd-0000-4000-8000-000000000001";

function given(
  participant: Record<string, unknown> | null,
  guardians: Array<{ email: string | null; first_name: string | null }> = [],
) {
  tables.users = { data: participant, error: null };
  tables.guardianships = {
    data: guardians.map((guardian) => ({ guardian })),
    error: null,
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  for (const k of Object.keys(tables)) delete tables[k];
  eqCalls.length = 0;
  vi.spyOn(console, "error").mockImplementation(() => {});
});

describe("loadParticipantRecipients", () => {
  it("emails a managed child's active guardians, who see the child's name", async () => {
    given(
      {
        email: null,
        contact_email: null,
        first_name: "Aina",
        last_name: "Rahman",
        account_type: "managed",
      },
      [
        { email: "mum@example.com", first_name: "Siti" },
        { email: "dad@example.com", first_name: "Rahman" },
      ],
    );

    const contacts = await loadParticipantRecipients(PLAYER);

    expect([...contacts!.recipients.values()]).toEqual([
      { email: "mum@example.com", name: "Siti" },
      { email: "dad@example.com", name: "Rahman" },
    ]);
    expect(contacts!.participantName).toBe("Aina Rahman");
    expect(
      nameForRecipient(contacts!, { email: "mum@example.com", name: "Siti" }),
    ).toBe("Aina Rahman");
    expect(eqCalls).toContainEqual(["guardianships", "status", "active"]);
    expect(eqCalls).toContainEqual([
      "guardianships",
      "dependent_user_id",
      PLAYER,
    ]);
  });

  it("adds an adult dependent's contact email, written to them", async () => {
    given(
      {
        email: null,
        contact_email: "badrul@example.com",
        first_name: "Badrul",
        last_name: "Hisham",
        account_type: "managed",
      },
      [{ email: "carer@example.com", first_name: "Hana" }],
    );

    const contacts = await loadParticipantRecipients(PLAYER);

    expect([...contacts!.recipients.keys()]).toEqual([
      "carer@example.com",
      "badrul@example.com",
    ]);
    expect(
      nameForRecipient(contacts!, {
        email: "Badrul@example.com",
        name: "Badrul",
      }),
    ).toBeNull();
  });

  it("writes to the guardian when the contact email is the guardian's own", async () => {
    given(
      {
        email: null,
        contact_email: "Carer@Example.com",
        first_name: "Badrul",
        last_name: "Hisham",
        account_type: "managed",
      },
      [{ email: "carer@example.com", first_name: "Hana" }],
    );

    const contacts = await loadParticipantRecipients(PLAYER);

    expect(contacts!.recipients.size).toBe(1);
    expect(contacts!.participantAddresses.size).toBe(0);
  });

  it("emails a self-managed player and copies their helper", async () => {
    given(
      {
        email: "adam@example.com",
        contact_email: null,
        first_name: "Adam",
        last_name: "Adult",
        account_type: "self",
      },
      [{ email: "helper@example.com", first_name: "Hana" }],
    );

    const contacts = await loadParticipantRecipients(PLAYER);

    expect([...contacts!.recipients.keys()]).toEqual([
      "helper@example.com",
      "adam@example.com",
    ]);
    expect(contacts!.participantAddresses).toEqual(
      new Set(["adam@example.com"]),
    );
  });

  it("is just the player when nobody acts for them", async () => {
    given({
      email: "farid@example.com",
      contact_email: null,
      first_name: "Farid",
      last_name: null,
      account_type: "self",
    });

    const contacts = await loadParticipantRecipients(PLAYER);

    expect([...contacts!.recipients.values()]).toEqual([
      { email: "farid@example.com", name: "Farid" },
    ]);
    expect(contacts!.participantName).toBe("Farid");
  });

  it("returns null and logs when the player can't be loaded", async () => {
    tables.users = { data: null, error: { message: "boom" } };
    expect(await loadParticipantRecipients(PLAYER)).toBeNull();
    expect(console.error).toHaveBeenCalled();
  });
});
