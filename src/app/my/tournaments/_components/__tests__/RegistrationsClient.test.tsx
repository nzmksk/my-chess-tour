// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import RegistrationsClient from "../RegistrationsClient";
import type { PlayerRegistration } from "../../types";

afterEach(cleanup);

function registration(
  overrides: Partial<PlayerRegistration> & {
    tournamentStatus?: string;
  } = {},
): PlayerRegistration {
  const { tournamentStatus = "published", ...rest } = overrides;
  return {
    id: "reg-1",
    tournament: {
      id: "t1",
      slug: "kl-open",
      name: "KL Open",
      start_date: "2099-03-15",
      end_date: "2099-03-15",
      timezone: "Asia/Kuala_Lumpur",
      venue_name: "KLCC",
      venue_state: "Kuala Lumpur",
      format: { type: "rapid", system: "swiss", rounds: 7 } as PlayerRegistration["tournament"]["format"],
      time_control: { base_minutes: 10, increment_seconds: 5 } as PlayerRegistration["tournament"]["time_control"],
      status: tournamentStatus,
    },
    fee_tier: "standard",
    entry_fee_cents: 5000,
    status: "confirmed",
    registered_at: "2026-02-22T12:00:00Z",
    confirmed_at: "2026-02-22T12:01:30Z",
    refund: null,
    ...rest,
  };
}

function openCancelledTab() {
  fireEvent.click(screen.getByRole("button", { name: /Cancelled/ }));
}

describe("RegistrationsClient", () => {
  it("files a confirmed entry in a cancelled tournament under Cancelled, not Upcoming", () => {
    render(
      <RegistrationsClient
        registrations={[registration({ tournamentStatus: "cancelled" })]}
      />,
    );

    expect(screen.queryByText("KL Open")).toBeNull();
    openCancelledTab();
    expect(screen.getByText("KL Open")).toBeTruthy();
    expect(screen.getByText("Tournament Cancelled")).toBeTruthy();
    expect(screen.queryByText("Confirmed")).toBeNull();
  });

  it("shows a refund that is still processing", () => {
    render(
      <RegistrationsClient
        registrations={[
          registration({
            tournamentStatus: "cancelled",
            refund: {
              state: "processing",
              amount_cents: 5500,
              requested_at: "2026-03-10T00:00:00Z",
              processed_at: null,
            },
          }),
        ]}
      />,
    );
    openCancelledTab();

    expect(screen.getByText("Refund of RM 55.00 processing")).toBeTruthy();
  });

  it("shows a completed refund with its amount and date", () => {
    render(
      <RegistrationsClient
        registrations={[
          registration({
            tournamentStatus: "cancelled",
            refund: {
              state: "refunded",
              amount_cents: 5500,
              requested_at: "2026-03-10T00:00:00Z",
              processed_at: "2026-03-11T02:00:00Z",
            },
          }),
        ]}
      />,
    );
    openCancelledTab();

    expect(screen.getByText("Refunded RM 55.00 on 11 Mar 2026 (MYT)")).toBeTruthy();
  });

  it("tells the player who to contact when the refund failed", () => {
    render(
      <RegistrationsClient
        registrations={[
          registration({
            tournamentStatus: "cancelled",
            refund: {
              state: "failed",
              amount_cents: 5500,
              requested_at: "2026-03-10T00:00:00Z",
              processed_at: null,
            },
          }),
        ]}
      />,
    );
    openCancelledTab();

    expect(screen.getByText(/could not be completed/).textContent).toContain(
      "support@mychesstour.com",
    );
  });

  it("lists Past by most recent end_date, not start_date", () => {
    const pastEvent = (
      id: string,
      name: string,
      start: string,
      end: string,
    ) => {
      const reg = registration({ id });
      const tournament = { ...reg.tournament, name, start_date: start };
      return { ...reg, tournament: { ...tournament, end_date: end } };
    };
    render(
      <RegistrationsClient
        registrations={[
          pastEvent("r1", "Weekend Blitz", "2020-01-05", "2020-01-05"),
          pastEvent("r2", "Ten-Day Classical", "2020-01-01", "2020-01-10"),
        ]}
      />,
    );
    fireEvent.click(screen.getByRole("button", { name: /Past/ }));

    const names = screen
      .getAllByRole("heading", { level: 4 })
      .map((h) => h.textContent);
    expect(names).toEqual(["Ten-Day Classical", "Weekend Blitz"]);
  });

  it("files an event being played today under Ongoing, finishing soonest first", () => {
    const today = new Intl.DateTimeFormat("en-CA", {
      timeZone: "Asia/Kuala_Lumpur",
    }).format(new Date());
    const running = (id: string, name: string, end: string) => {
      const reg = registration({ id });
      const tournament = { ...reg.tournament, name, start_date: "2020-01-01" };
      return { ...reg, tournament: { ...tournament, end_date: end } };
    };
    render(
      <RegistrationsClient
        registrations={[
          running("r1", "Long Classical", "2099-12-31"),
          running("r2", "Final Day Rapid", today),
          registration({ id: "r3" }),
        ]}
      />,
    );
    // Opens on Ongoing without a click, since the player has one running.
    const names = screen
      .getAllByRole("heading", { level: 4 })
      .map((h) => h.textContent);
    expect(names).toEqual(["Final Day Rapid", "Long Classical"]);
  });

  it("opens on Upcoming when nothing is running", () => {
    render(<RegistrationsClient registrations={[registration()]} />);

    expect(screen.getByText("KL Open")).toBeTruthy();
  });
});
