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
import TournamentActions from "../TournamentActions";

const mockRefresh = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ refresh: mockRefresh }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

const ORG_ID = "11111111-1111-4111-8111-111111111111";
const TOUR_ID = "22222222-2222-4222-8222-222222222222";

function renderActions(status: string) {
  return render(
    <TournamentActions
      orgId={ORG_ID}
      tournamentId={TOUR_ID}
      status={status}
      startDate="2099-09-01"
      endDate="2099-09-02"
      timeZone="Asia/Kuala_Lumpur"
      registrationClosedAt={null}
      registrationDeadline="2099-08-25T15:59:00Z"
      cancellationPending={false}
    />,
  );
}

function jsonResponse(status: number, body: unknown): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

function startPublish() {
  renderActions("draft");
  fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));
  fireEvent.click(screen.getByRole("button", { name: /yes, publish/i }));
}

beforeEach(() => {
  mockRefresh.mockReset();
  mockFetch.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("TournamentActions — draft", () => {
  // The bug this covers (#479): actions rendered only for published
  // tournaments, so a draft's manage page offered no way to publish it.
  it("offers Publish and none of the published-only actions", () => {
    renderActions("draft");

    expect(screen.getByRole("button", { name: /^publish$/i })).toBeTruthy();
    expect(
      screen.queryByRole("button", { name: /close registration/i }),
    ).toBeNull();
    expect(
      screen.queryByRole("button", { name: /request cancellation/i }),
    ).toBeNull();
  });

  it("asks for confirmation before publishing", () => {
    renderActions("draft");
    fireEvent.click(screen.getByRole("button", { name: /^publish$/i }));

    expect(mockFetch).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: /yes, publish/i })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /not yet/i }));
    expect(screen.queryByRole("button", { name: /yes, publish/i })).toBeNull();
    expect(mockFetch).not.toHaveBeenCalled();
  });

  it("publishes and refreshes the page on success", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(200, { data: { id: TOUR_ID, status: "published" } }),
    );

    startPublish();

    await waitFor(() => expect(mockRefresh).toHaveBeenCalled());
    const [url, init] = mockFetch.mock.calls[0];
    expect(url).toBe(
      `/api/v1/organizations/${ORG_ID}/tournaments/${TOUR_ID}/publish`,
    );
    expect(init.method).toBe("POST");
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("lists every reason an incomplete draft can't be published", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(422, {
        error: {
          code: "VALIDATION_ERROR",
          message: "Venue address is required",
          details: [
            "Venue address is required",
            "Start date must be a future date",
          ],
        },
      }),
    );

    startPublish();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain("Venue address is required");
    expect(alert.textContent).toContain("Start date must be a future date");
    expect(alert.textContent).toContain("Edit Tournament");
    expect(mockRefresh).not.toHaveBeenCalled();
  });

  it("doesn't point to the edit wizard for a failure it can't fix", async () => {
    mockFetch.mockResolvedValueOnce(
      jsonResponse(403, {
        error: {
          code: "FORBIDDEN",
          message: "Admin or owner role required to publish tournaments",
        },
      }),
    );

    startPublish();

    const alert = await screen.findByRole("alert");
    expect(alert.textContent).toContain(
      "Admin or owner role required to publish tournaments",
    );
    expect(alert.textContent).not.toContain("Edit Tournament");
  });
});

describe("TournamentActions — other statuses", () => {
  it("renders nothing for a cancelled tournament", () => {
    const { container } = renderActions("cancelled");
    expect(container.innerHTML).toBe("");
  });

  it("does not offer Publish once published", () => {
    renderActions("published");
    expect(screen.queryByRole("button", { name: /^publish$/i })).toBeNull();
    expect(
      screen.getByRole("button", { name: /close registration/i }),
    ).toBeTruthy();
  });
});
