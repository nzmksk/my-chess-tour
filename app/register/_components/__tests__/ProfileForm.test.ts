import { describe, expect, it, vi } from "vitest";

vi.mock("../StepTracker", () => ({
  default: vi.fn().mockReturnValue(null),
}));

import ProfileForm from "../ProfileForm";

describe("ProfileForm", () => {
  it("is defined as a function", () => {
    expect(typeof ProfileForm).toBe("function");
  });

  it("has a default export", () => {
    expect(ProfileForm).toBeDefined();
  });

  it("is named ProfileForm", () => {
    expect(ProfileForm.name).toBe("ProfileForm");
  });
});
