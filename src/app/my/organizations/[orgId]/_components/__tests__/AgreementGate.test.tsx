// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";
import AgreementGate from "../AgreementGate";
import {
  ORGANIZER_AGREEMENT_HISTORY,
  ORGANIZER_AGREEMENT_VERSION,
  changesSince,
} from "@/lib/legal";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

const ORG_ID = "bbbbbbbb-0000-0000-0000-000000000001";

function renderGate(agreementVersion: string | null) {
  return render(
    <AgreementGate
      organizationId={ORG_ID}
      agreementVersion={agreementVersion}
    />,
  );
}

function getAcceptButton() {
  return screen.getByRole("button", {
    name: "Accept Agreement",
  }) as HTMLButtonElement;
}

function tickCheckbox() {
  fireEvent.click(
    screen.getByLabelText("I have read and accept the Organizer Agreement"),
  );
}

describe("AgreementGate", () => {
  it("renders nothing when the current version is already accepted", () => {
    const { container } = renderGate(ORGANIZER_AGREEMENT_VERSION);
    expect(container.innerHTML).toBe("");
  });

  it("blocks when the stored version is stale", () => {
    renderGate("2025-01-01");
    expect(screen.getByText(/has been updated/i)).toBeDefined();
  });

  it("blocks when nothing has ever been accepted", () => {
    // An organization that predates the agreement has accepted nothing, which
    // is not the same message as "we changed it".
    renderGate(null);
    expect(screen.getByText("Accept the Organizer Agreement")).toBeDefined();
  });

  it("cannot be accepted without ticking the box", () => {
    renderGate(null);
    expect(getAcceptButton().disabled).toBe(true);

    tickCheckbox();
    expect(getAcceptButton().disabled).toBe(false);
  });

  it("says plainly that payouts are held until it is accepted", () => {
    renderGate("2025-01-01");
    expect(
      screen.getByText(/Payouts are held until it is accepted/i),
    ).toBeDefined();
  });

  it("lists what changed since the version the org accepted", () => {
    // A re-acceptance prompt that doesn't say what moved buys a reflexive tick,
    // which is worth nothing when the claw-back clause is tested.
    renderGate("2025-01-01");

    const expected = changesSince(ORGANIZER_AGREEMENT_HISTORY, "2025-01-01");
    expect(expected.length).toBeGreaterThan(0);
    for (const change of expected) {
      expect(screen.getByText(change)).toBeDefined();
    }
    expect(
      screen.getByText("What changed since version 2025-01-01"),
    ).toBeDefined();
  });

  it("frames a first-time acceptance as 'what it covers'", () => {
    renderGate(null);

    expect(screen.getByText("What it covers")).toBeDefined();
    expect(screen.queryByText(/What changed since/)).toBeNull();
    const items = document.querySelectorAll("li");
    expect(items).toHaveLength(
      changesSince(ORGANIZER_AGREEMENT_HISTORY, null).length,
    );
  });

  it("posts the acceptance and refreshes on success", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: vi.fn() });
    renderGate("2025-01-01");
    tickCheckbox();

    await act(async () => {
      fireEvent.click(getAcceptButton());
    });

    expect(mockFetch).toHaveBeenCalledWith(
      `/api/v1/organizations/${ORG_ID}/agreement`,
      expect.objectContaining({ method: "POST" }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ agreement_accepted: true });
    expect(mockRefresh).toHaveBeenCalledOnce();
  });

  it("never sends a version — the server decides that", async () => {
    mockFetch.mockResolvedValueOnce({ ok: true, json: vi.fn() });
    renderGate("2025-01-01");
    tickCheckbox();

    await act(async () => {
      fireEvent.click(getAcceptButton());
    });

    expect(mockFetch.mock.calls[0][1].body).not.toContain("version");
  });

  it("surfaces the API error and does not refresh", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockResolvedValue({
        error: { message: "Insufficient permissions" },
      }),
    });
    renderGate("2025-01-01");
    tickCheckbox();

    await act(async () => {
      fireEvent.click(getAcceptButton());
    });

    expect(screen.getByRole("alert").textContent).toBe(
      "Insufficient permissions",
    );
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("surfaces a network failure", async () => {
    mockFetch.mockRejectedValueOnce(new Error("offline"));
    renderGate("2025-01-01");
    tickCheckbox();

    await act(async () => {
      fireEvent.click(getAcceptButton());
    });

    expect(screen.getByRole("alert").textContent).toMatch(/network error/i);
    expect(getAcceptButton().disabled).toBe(false);
  });

  it("links to the agreement so it can be read before accepting", () => {
    renderGate(null);
    const link = screen.getByRole("link", { name: "Organizer Agreement" });
    expect(link.getAttribute("href")).toBe("/organizer-agreement");
    expect(link.getAttribute("target")).toBe("_blank");
  });
});
