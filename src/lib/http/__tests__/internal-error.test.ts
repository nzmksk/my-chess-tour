import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { INTERNAL_ERROR_MESSAGE, internalErrorResponse } from "../internal-error";

describe("internalErrorResponse", () => {
  let consoleError: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    consoleError = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleError.mockRestore();
  });

  it("returns a generic 500 that does not echo the database error", async () => {
    const res = internalErrorResponse("Org applications: insert failed", {
      code: "23503",
      message:
        'insert or update on table "organizations" violates foreign key constraint "organizations_created_by_fkey"',
    });

    expect(res.status).toBe(500);
    const body = await res.json();
    expect(body).toEqual({
      error: { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE },
    });
    expect(JSON.stringify(body)).not.toMatch(/organizations|constraint/);
  });

  it("logs a Supabase error as one readable line with code, details and hint", () => {
    internalErrorResponse("Ctx", {
      code: "23503",
      message: "fk violation",
      details: "Key (created_by)=(x) is not present",
      hint: "check the user row",
    });

    expect(consoleError).toHaveBeenCalledWith(
      "Ctx 23503: fk violation | details: Key (created_by)=(x) is not present | hint: check the user row",
    );
  });

  it("logs a Supabase error without a code as its message alone", () => {
    internalErrorResponse("Ctx", { message: "boom", details: null, hint: "" });
    expect(consoleError).toHaveBeenCalledWith("Ctx boom");
  });

  it("keeps an Error as its own argument and appends a string", () => {
    const err = new Error("thrown");
    internalErrorResponse("Ctx", err);
    expect(consoleError).toHaveBeenLastCalledWith("Ctx", err);

    internalErrorResponse("Ctx", "plain");
    expect(consoleError).toHaveBeenLastCalledWith("Ctx plain");
  });

  it("does not let format directives in the context swallow the detail", () => {
    internalErrorResponse("Payout %c lookup failed", { code: "23503", message: "fk" });
    expect(consoleError).toHaveBeenLastCalledWith("Payout %c lookup failed 23503: fk");

    const err = new Error("thrown");
    internalErrorResponse("Payout %c lookup failed", err);
    expect(consoleError).toHaveBeenLastCalledWith("Payout %%c lookup failed", err);
  });

  it("logs the context alone when there is no cause", () => {
    internalErrorResponse("Ctx");
    expect(consoleError).toHaveBeenCalledWith("Ctx");
  });
});
