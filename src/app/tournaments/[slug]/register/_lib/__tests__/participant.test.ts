import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockListDependents, mockGetDependent } = vi.hoisted(() => ({
  mockListDependents: vi.fn(),
  mockGetDependent: vi.fn(),
}));

vi.mock("@/services/guardianship/dependents", () => ({
  listDependents: mockListDependents,
  getDependent: mockGetDependent,
}));

import {
  loadRegisterParticipants,
  resolveReturnParticipant,
} from "../participant";

const AINA = {
  id: "dep-1",
  first_name: "Aina",
  last_name: "Rahman",
  basis: "minor",
  date_of_birth: "2012-05-01",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockListDependents.mockResolvedValue({ ok: true, data: [AINA] });
  mockGetDependent.mockResolvedValue({ ok: true, data: AINA });
});

describe("loadRegisterParticipants", () => {
  it("offers yourself first, then each active dependent", async () => {
    const choice = await loadRegisterParticipants("u1", undefined);
    expect(choice).toEqual({
      ok: true,
      participants: [
        { id: "u1", firstName: "You", name: "Myself", isSelf: true },
        { id: "dep-1", firstName: "Aina", name: "Aina Rahman", isSelf: false },
      ],
      options: [
        { id: "u1", label: "Myself", isSelf: true, disabled: false },
        { id: "dep-1", label: "Aina Rahman", isSelf: false, disabled: false },
      ],
      selected: { id: "u1", firstName: "You", name: "Myself", isSelf: true },
    });
    expect(mockListDependents).toHaveBeenCalledWith("u1");
  });

  it("selects the requested dependent", async () => {
    const choice = await loadRegisterParticipants("u1", "dep-1");
    expect(choice.ok && choice.selected?.id).toBe("dep-1");
  });

  it("selects nobody for a player the caller doesn't look after", async () => {
    const choice = await loadRegisterParticipants("u1", "stranger");
    expect(choice.ok && choice.selected).toBeNull();
  });

  it("leaves out a minor who has turned 18, as their guardian can no longer register them", async () => {
    mockListDependents.mockResolvedValue({
      ok: true,
      data: [AINA, { ...AINA, id: "dep-2", date_of_birth: "2008-11-20" }],
    });
    const choice = await loadRegisterParticipants("u1", "dep-2", "2026-11-25");
    expect(choice.ok && choice.participants.map((p) => p.id)).toEqual([
      "u1",
      "dep-1",
    ]);
    expect(choice.ok && choice.selected).toBeNull();
  });

  it("still shows a minor who has turned 18 in the picker, disabled and explained", async () => {
    mockListDependents.mockResolvedValue({
      ok: true,
      data: [AINA, { ...AINA, id: "dep-2", date_of_birth: "2008-11-26" }],
    });
    const choice = await loadRegisterParticipants(
      "u1",
      undefined,
      "2026-11-26",
    );
    expect(choice.ok && choice.options.map((o) => [o.id, o.disabled])).toEqual([
      ["u1", false],
      ["dep-1", false],
      ["dep-2", true],
    ]);
    expect(choice.ok && choice.options[2].label).toMatch(/turned 18/);
  });

  it("tells dependents who share a name apart by date of birth", async () => {
    mockListDependents.mockResolvedValue({
      ok: true,
      data: [
        { ...AINA, id: "dep-1", date_of_birth: "2012-05-01" },
        {
          ...AINA,
          id: "dep-2",
          first_name: "aina ",
          last_name: "RAHMAN",
          date_of_birth: "2015-03-09",
        },
        {
          ...AINA,
          id: "dep-3",
          first_name: "Siti",
          date_of_birth: "2013-01-01",
        },
      ],
    });
    const choice = await loadRegisterParticipants(
      "u1",
      undefined,
      "2026-11-26",
    );
    expect(choice.ok && choice.participants.map((p) => p.id)).toEqual([
      "u1",
      "dep-1",
      "dep-2",
      "dep-3",
    ]);
    const labels = choice.ok ? choice.options.map((o) => o.label) : [];
    expect(labels[1]).toMatch(/^Aina Rahman \(born .*2012\)$/);
    expect(labels[2]).toMatch(/\(born .*2015\)$/);
    expect(labels[1]).not.toBe(labels[2]);
    expect(labels[3]).toBe("Siti Rahman");
  });

  it("reports a failed lookup", async () => {
    mockListDependents.mockResolvedValue({ ok: false, error: "boom" });
    expect(await loadRegisterParticipants("u1", undefined)).toEqual({
      ok: false,
      error: "boom",
    });
  });
});

describe("resolveReturnParticipant", () => {
  it("is yourself without a request", async () => {
    expect((await resolveReturnParticipant("u1", undefined)).isSelf).toBe(true);
    expect(mockGetDependent).not.toHaveBeenCalled();
  });

  it("is the dependent the caller looks after", async () => {
    const p = await resolveReturnParticipant("u1", "dep-1");
    expect(p).toEqual({
      id: "dep-1",
      firstName: "Aina",
      name: "Aina Rahman",
      isSelf: false,
    });
    expect(mockGetDependent).toHaveBeenCalledWith("u1", "dep-1");
  });

  it("falls back to yourself for anyone else", async () => {
    mockGetDependent.mockResolvedValue({ ok: true, data: null });
    const p = await resolveReturnParticipant("u1", "stranger");
    expect(p.id).toBe("u1");
    expect(p.isSelf).toBe(true);
  });
});
