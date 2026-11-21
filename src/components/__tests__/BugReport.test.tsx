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

vi.mock("@sentry/nextjs", () => ({
  lastEventId: () => "0123456789abcdef0123456789abcdef",
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import { BugReport } from "../BugReport";

function respond(status: number, body: unknown) {
  mockFetch.mockResolvedValue({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  });
}

function openForm() {
  fireEvent.click(screen.getByRole("button", { name: /report a bug/i }));
}

function typeDescription(text: string) {
  fireEvent.change(screen.getByLabelText(/what happened/i), {
    target: { value: text },
  });
}

function submit() {
  fireEvent.click(screen.getByRole("button", { name: /send report/i }));
}

describe("BugReport", () => {
  beforeEach(() => {
    mockFetch.mockReset();
  });

  afterEach(() => {
    cleanup();
  });

  it("opens the form and tells the reporter the report is public", () => {
    render(<BugReport />);
    openForm();
    expect(screen.getByRole("dialog")).toBeTruthy();
    expect(screen.getByText(/posted publicly/i)).toBeTruthy();
    expect(screen.getByText(/don't type personal details/i)).toBeTruthy();
  });

  it("requires a description before sending", () => {
    render(<BugReport />);
    openForm();
    submit();
    expect(screen.getByRole("alert").textContent).toMatch(/what happened/i);
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("sends the report with its context and shows the reference", async () => {
    respond(201, { reference: "BR-1A2B3C4D" });
    render(<BugReport />);
    openForm();
    typeDescription("Checkout spins forever");
    fireEvent.change(screen.getByLabelText(/steps/i), {
      target: { value: "Click pay" },
    });
    submit();

    await screen.findByText("BR-1A2B3C4D");
    expect(screen.getByText(/thanks for the report/i)).toBeTruthy();

    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe("/api/v1/feedback");
    const body = JSON.parse(init.body);
    expect(body).toMatchObject({
      description: "Checkout spins forever",
      details: "Click pay",
      path: window.location.pathname,
      viewport: { width: window.innerWidth, height: window.innerHeight },
      sentryEventId: "0123456789abcdef0123456789abcdef",
      website: "",
    });
    expect(document.body.textContent).not.toMatch(/github\.com/);
  });

  it("treats a saved-but-unfiled report as done", async () => {
    respond(502, {
      reference: "BR-1A2B3C4D",
      error: { code: "FILING_FAILED", message: "..." },
    });
    render(<BugReport />);
    openForm();
    typeDescription("Broken");
    submit();

    await screen.findByText("BR-1A2B3C4D");
    expect(screen.getByText(/we've saved it/i)).toBeTruthy();
  });

  it("shows the rate limit message and keeps the draft", async () => {
    respond(429, {
      error: {
        code: "RATE_LIMITED",
        message:
          "You've sent several reports in a short time. Please try again later.",
      },
    });
    render(<BugReport />);
    openForm();
    typeDescription("Broken again");
    submit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/several reports/i);
    expect(
      (screen.getByLabelText(/what happened/i) as HTMLTextAreaElement).value,
    ).toBe("Broken again");
  });

  it("shows a generic error on a server failure and keeps the draft", async () => {
    respond(500, {
      error: { code: "INTERNAL_ERROR", message: "Something went wrong" },
    });
    render(<BugReport />);
    openForm();
    typeDescription("Broken");
    submit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't send your report/i);
    expect(
      (screen.getByLabelText(/what happened/i) as HTMLTextAreaElement).value,
    ).toBe("Broken");
  });

  it("shows a generic error when the network fails", async () => {
    mockFetch.mockRejectedValue(new TypeError("Failed to fetch"));
    render(<BugReport />);
    openForm();
    typeDescription("Broken");
    submit();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toMatch(/couldn't send your report/i);
  });

  it("starts a fresh form after a sent report is closed", async () => {
    respond(201, { reference: "BR-1A2B3C4D" });
    render(<BugReport />);
    openForm();
    typeDescription("Broken");
    submit();
    await screen.findByText("BR-1A2B3C4D");

    fireEvent.click(screen.getByRole("button", { name: /done/i }));
    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());

    openForm();
    expect(
      (screen.getByLabelText(/what happened/i) as HTMLTextAreaElement).value,
    ).toBe("");
  });
});
