import { beforeEach, describe, expect, it, vi } from "vitest";

const { mockInsert, mockFrom } = vi.hoisted(() => {
  const mockInsert = vi.fn();
  return { mockInsert, mockFrom: vi.fn(() => ({ insert: mockInsert })) };
});

vi.mock("@/services/supabase/server", () => ({
  createClient: vi.fn().mockResolvedValue({ from: mockFrom }),
}));

import { joinWaitlist } from "../joinWaitlist";

const initial = { error: null, submitted: false };

function form(fields: Record<string, string>): FormData {
  const data = new FormData();
  for (const [key, value] of Object.entries(fields)) data.set(key, value);
  return data;
}

describe("joinWaitlist", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mockInsert.mockResolvedValue({ error: null });
  });

  it.each(["player", "organizer", "parent", "coach", "arbiter", "other"])(
    "adds the email with the %s role",
    async (role) => {
      const result = await joinWaitlist(
        initial,
        form({ email: " a@b.com ", user_type: role }),
      );
      expect(result).toEqual({ error: null, submitted: true });
      expect(mockFrom).toHaveBeenCalledWith("waitlist");
      expect(mockInsert).toHaveBeenCalledWith({
        email: "a@b.com",
        user_type: role,
      });
    },
  );

  it("asks for an email first", async () => {
    const result = await joinWaitlist(initial, form({ user_type: "player" }));
    expect(result).toEqual({
      error: "Please enter your email address.",
      submitted: false,
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it.each([
    ["no role", {}],
    ["the placeholder", { user_type: "" }],
    ["an unknown role", { user_type: "spectator" }],
  ])("asks for a role when given %s", async (_case, fields) => {
    const result = await joinWaitlist(
      initial,
      form({ email: "a@b.com", ...fields }),
    );
    expect(result).toEqual({
      error: "Please choose your role.",
      submitted: false,
    });
    expect(mockInsert).not.toHaveBeenCalled();
  });

  it("treats an email already on the list as success", async () => {
    mockInsert.mockResolvedValue({ error: { code: "23505" } });
    const result = await joinWaitlist(
      initial,
      form({ email: "a@b.com", user_type: "coach" }),
    );
    expect(result).toEqual({ error: null, submitted: true });
  });

  it("reports any other failure", async () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    mockInsert.mockResolvedValue({ error: { code: "XX000" } });
    const result = await joinWaitlist(
      initial,
      form({ email: "a@b.com", user_type: "coach" }),
    );
    expect(result.submitted).toBe(false);
    expect(result.error).toMatch(/Something went wrong/);
    spy.mockRestore();
  });
});
