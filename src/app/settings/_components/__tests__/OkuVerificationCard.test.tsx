// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { currentConsent } from "@/lib/reference/legal";

const { mockUpload } = vi.hoisted(() => ({ mockUpload: vi.fn() }));

vi.mock("@/services/supabase/client", () => ({
  createClient: () => ({
    storage: { from: () => ({ upload: mockUpload }) },
  }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import OkuVerificationCard from "../OkuVerificationCard";

const USER = "user-1";

function ok(body: unknown = {}) {
  return { ok: true, status: 200, json: async () => body };
}

const consentBox = () =>
  screen.getByRole("checkbox", {
    name: new RegExp(currentConsent("health").statement.slice(0, 40)),
  });
const submitButton = () =>
  screen.getByRole("button", {
    name: "Submit for verification",
  }) as HTMLButtonElement;

function chooseFile() {
  const file = new File(["card"], "card.png", { type: "image/png" });
  fireEvent.change(screen.getByLabelText("OKU card file"), {
    target: { files: [file] },
  });
}

describe("OkuVerificationCard — health data consent (#451)", () => {
  beforeEach(() => {
    mockFetch.mockReset();
    mockUpload.mockReset();
    mockUpload.mockResolvedValue({ error: null });
  });
  afterEach(cleanup);

  it("can't submit a card until consent is ticked", () => {
    render(
      <OkuVerificationCard
        userId={USER}
        status="none"
        rejectionReason={null}
      />,
    );
    chooseFile();
    expect((consentBox() as HTMLInputElement).checked).toBe(false);
    expect(submitButton().disabled).toBe(true);
    fireEvent.click(consentBox());
    expect(submitButton().disabled).toBe(false);
  });

  it("records consent before the card is uploaded", async () => {
    mockFetch.mockResolvedValue(ok());
    render(
      <OkuVerificationCard
        userId={USER}
        status="none"
        rejectionReason={null}
      />,
    );
    chooseFile();
    fireEvent.click(consentBox());
    fireEvent.click(submitButton());

    expect(
      await screen.findByText(/your oku card is under review/i),
    ).toBeTruthy();
    expect(mockFetch.mock.calls[0][0]).toBe("/api/v1/profile/consents");
    expect(JSON.parse(mockFetch.mock.calls[0][1].body)).toEqual({
      category: "health",
    });
    // The bucket refuses a card without consent, so the grant must come first.
    expect(mockFetch.mock.invocationCallOrder[0]).toBeLessThan(
      mockUpload.mock.invocationCallOrder[0],
    );
    expect(mockFetch.mock.calls[1][0]).toBe("/api/v1/profile/oku");
  });

  it("uploads nothing when consent can't be recorded", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      status: 500,
      json: async () => ({ error: { message: "Try again later." } }),
    });
    render(
      <OkuVerificationCard
        userId={USER}
        status="none"
        rejectionReason={null}
      />,
    );
    chooseFile();
    fireEvent.click(consentBox());
    fireEvent.click(submitButton());

    expect(await screen.findByText("Try again later.")).toBeTruthy();
    expect(mockUpload).not.toHaveBeenCalled();
  });

  it("offers no withdrawal when no card is on file", () => {
    render(
      <OkuVerificationCard
        userId={USER}
        status="none"
        rejectionReason={null}
      />,
    );
    expect(screen.queryByRole("button", { name: /withdraw consent/i })).toBe(
      null,
    );
  });

  it("withdraws consent after confirmation, deleting the card", async () => {
    mockFetch.mockResolvedValue(ok());
    render(
      <OkuVerificationCard
        userId={USER}
        status="verified"
        rejectionReason={null}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /withdraw consent and delete/i }),
    );
    // Nothing is sent until the player confirms.
    expect(mockFetch).not.toHaveBeenCalled();
    fireEvent.click(
      screen.getByRole("button", { name: "Withdraw and delete" }),
    );

    await waitFor(() =>
      expect(mockFetch).toHaveBeenCalledWith("/api/v1/profile/oku", {
        method: "DELETE",
      }),
    );
    // Back to the uploader, with an unticked consent box.
    expect(await screen.findByLabelText("OKU card file")).toBeTruthy();
    expect((consentBox() as HTMLInputElement).checked).toBe(false);
    expect(screen.queryByText(/you can register for oku fee categories/i)).toBe(
      null,
    );
  });

  it("keeps the card when the player backs out", () => {
    render(
      <OkuVerificationCard
        userId={USER}
        status="pending"
        rejectionReason={null}
      />,
    );
    fireEvent.click(
      screen.getByRole("button", { name: /withdraw consent and delete/i }),
    );
    fireEvent.click(screen.getByRole("button", { name: "Keep my OKU card" }));
    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByText(/your oku card is under review/i)).toBeTruthy();
  });
});
