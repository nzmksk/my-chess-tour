// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  act,
  cleanup,
  fireEvent,
  render,
  screen,
} from "@testing-library/react";
import ClaimClient, { type ClaimSummary } from "../ClaimClient";

const mockFetch = vi.fn();
const TOKEN = "T".repeat(43);
const GOOD = "Password1!";

function claim(overrides: Partial<ClaimSummary> = {}): ClaimSummary {
  return {
    state: "pending",
    email: "ada@example.com",
    playerFirstName: "Ada",
    guardianName: "Gwen Guardian",
    ...overrides,
  };
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

function fill(password = GOOD, confirm = GOOD, agree = true) {
  fireEvent.change(screen.getByLabelText("Password"), {
    target: { value: password },
  });
  fireEvent.change(screen.getByLabelText("Confirm Password"), {
    target: { value: confirm },
  });
  if (agree) fireEvent.click(screen.getByLabelText(/I accept the/));
}

async function submit() {
  await act(async () => {
    fireEvent.click(screen.getByRole("button", { name: "Create My Account" }));
  });
}

describe("ClaimClient", () => {
  it("explains the handover and who will sign in", () => {
    render(<ClaimClient token={TOKEN} claim={claim()} loadFailed={false} />);
    expect(
      screen.getByRole("heading", { name: "Set Up Your Account" }),
    ).toBeDefined();
    expect(
      screen.getByText(/is handing your MY Chess Tour player record/),
    ).toBeDefined();
    expect(screen.getByText("ada@example.com")).toBeDefined();
    expect(screen.getByText(/can no longer manage your record/)).toBeDefined();
  });

  it("sets the password and then points to sign in", async () => {
    mockFetch.mockResolvedValue({
      ok: true,
      json: () => Promise.resolve({ data: { email: "ada@example.com" } }),
    });
    render(<ClaimClient token={TOKEN} claim={claim()} loadFailed={false} />);
    fill();
    await submit();

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/v1/account-claims/${TOKEN}/accept`,
      expect.objectContaining({
        method: "POST",
        body: JSON.stringify({ password: GOOD, accept_terms: true }),
      }),
    );
    expect(
      screen.getByRole("heading", { name: "Your Account Is Ready" }),
    ).toBeDefined();
    expect(
      screen.getByRole("link", { name: "Sign In" }).getAttribute("href"),
    ).toBe("/auth/login");
  });

  it.each([
    ["a weak password", "weak", "weak", true, /doesn't meet the requirements/],
    ["mismatched passwords", GOOD, `${GOOD}x`, true, /don't match/],
    ["no Terms acceptance", GOOD, GOOD, false, /accept the Terms/],
  ])(
    "stops %s before calling the API",
    async (_label, pw, confirm, agree, message) => {
      render(<ClaimClient token={TOKEN} claim={claim()} loadFailed={false} />);
      fill(pw, confirm, agree);
      await submit();

      expect(screen.getByRole("alert").textContent).toMatch(message);
      expect(mockFetch).not.toHaveBeenCalled();
    },
  );

  it("shows the server's refusal, such as an address that already has an account", async () => {
    mockFetch.mockResolvedValue({
      ok: false,
      json: () =>
        Promise.resolve({
          error: {
            message: "This email address already has a MY Chess Tour account.",
          },
        }),
    });
    render(<ClaimClient token={TOKEN} claim={claim()} loadFailed={false} />);
    fill();
    await submit();

    expect(screen.getByRole("alert").textContent).toMatch(
      /already has a MY Chess Tour account/,
    );
  });

  it("ticks off the password requirements for screen readers too", () => {
    render(<ClaimClient token={TOKEN} claim={claim()} loadFailed={false} />);
    fireEvent.change(screen.getByLabelText("Password"), {
      target: { value: "abcdefgh" },
    });
    expect(screen.getByText("8+ characters").textContent).toContain("(met)");
    expect(screen.getByText("1 number").textContent).toContain("(not met yet)");
    expect(
      screen.getByLabelText("Password").getAttribute("aria-describedby"),
    ).toBe("claim-password-requirements");
  });

  it.each([
    ["expired", "Link Expired"],
    ["closed", "Link No Longer Valid"],
    ["accepted", "Already Set Up"],
  ] as const)("shows a %s link without the form", (state, heading) => {
    render(
      <ClaimClient token={TOKEN} claim={claim({ state })} loadFailed={false} />,
    );
    expect(screen.getByRole("heading", { name: heading })).toBeDefined();
    expect(screen.queryByLabelText("Password")).toBeNull();
  });

  it("handles an unknown link and a failed load", () => {
    render(<ClaimClient token={TOKEN} claim={null} loadFailed={false} />);
    expect(
      screen.getByRole("heading", { name: "Link Not Found" }),
    ).toBeDefined();
    cleanup();
    render(<ClaimClient token={TOKEN} claim={null} loadFailed={true} />);
    expect(
      screen.getByRole("heading", { name: "Something Went Wrong" }),
    ).toBeDefined();
  });
});
