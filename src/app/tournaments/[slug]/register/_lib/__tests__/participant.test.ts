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

const AINA = { id: "dep-1", first_name: "Aina", last_name: "Rahman" };

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
