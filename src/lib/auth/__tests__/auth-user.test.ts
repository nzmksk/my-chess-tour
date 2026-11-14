import { describe, expect, it } from "vitest";
import { toAuthUser } from "../auth-user";

describe("toAuthUser", () => {
  it("returns null for null input", () => {
    expect(toAuthUser(null)).toBeNull();
  });

  it("returns null for undefined input", () => {
    expect(toAuthUser(undefined)).toBeNull();
  });

  it("returns null when neither id nor sub is present", () => {
    expect(toAuthUser({ email: "test@example.com" })).toBeNull();
  });

  it("uses id when present", () => {
    const result = toAuthUser({ id: "user-1", email: "test@example.com" });
    expect(result?.id).toBe("user-1");
  });

  it("falls back to sub when id is absent", () => {
    const result = toAuthUser({ sub: "sub-1", email: "test@example.com" });
    expect(result?.id).toBe("sub-1");
  });

  it("extracts first_name and last_name from user_metadata", () => {
    const result = toAuthUser({
      id: "user-1",
      email: "test@example.com",
      user_metadata: { first_name: "Alice", last_name: "Smith" },
    });
    expect(result?.fullName).toBe("Alice Smith");
    expect(result?.initials).toBe("AS");
  });

  it("falls back to camelCase firstName and lastName from user_metadata", () => {
    const result = toAuthUser({
      id: "user-1",
      email: "test@example.com",
      user_metadata: { firstName: "Bob", lastName: "Jones" },
    });
    expect(result?.fullName).toBe("Bob Jones");
    expect(result?.initials).toBe("BJ");
  });

  it("uses email as fullName when no name present", () => {
    const result = toAuthUser({ id: "user-1", email: "test@example.com" });
    expect(result?.fullName).toBe("test@example.com");
  });

  it("uses email first char as initials when no name present", () => {
    const result = toAuthUser({ id: "user-1", email: "test@example.com" });
    expect(result?.initials).toBe("T");
  });

  it("returns ? as initials when no name and no email", () => {
    const result = toAuthUser({ id: "user-1" });
    expect(result?.initials).toBe("?");
  });

  it("builds initials from only first name when last name is absent", () => {
    const result = toAuthUser({
      id: "user-1",
      email: "test@example.com",
      user_metadata: { first_name: "Alice" },
    });
    expect(result?.initials).toBe("A");
    expect(result?.fullName).toBe("Alice");
  });

  it("defaults email to empty string when absent", () => {
    const result = toAuthUser({
      id: "user-1",
      user_metadata: { first_name: "Alice", last_name: "Smith" },
    });
    expect(result?.email).toBe("");
  });

  it("returns the full AuthUser shape", () => {
    const result = toAuthUser({
      id: "user-1",
      email: "alice@example.com",
      user_metadata: { first_name: "Alice", last_name: "Smith" },
    });
    expect(result).toEqual({
      id: "user-1",
      email: "alice@example.com",
      fullName: "Alice Smith",
      initials: "AS",
    });
  });
});
