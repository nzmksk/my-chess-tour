// @vitest-environment jsdom
import * as React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import type { PlayerProfile } from "@/app/profile/types";

vi.mock("next/image", () => ({
  default: ({ alt }: { alt: string }) => <span>{alt}</span>,
}));

vi.mock("next/link", () => ({
  default: ({
    href,
    children,
    className,
  }: {
    href: string;
    children: React.ReactNode;
    className?: string;
  }) => (
    <a href={href} className={className}>
      {children}
    </a>
  ),
}));

vi.mock("@/services/supabase/client", () => ({ createClient: vi.fn() }));
vi.mock("@/components/ui/country-dropdown", () => ({
  CountryDropdown: () => null,
}));
vi.mock("../OkuVerificationCard", () => ({ default: () => null }));
vi.mock("../BankingCard", () => ({ default: () => null }));
vi.mock("../HelpersCard", () => ({ default: () => null }));

import ProfileClient from "../ProfileClient";

const PROFILE: PlayerProfile = {
  id: "user-1",
  email: "player@example.com",
  first_name: "Aina",
  last_name: "Rahman",
  avatar_url: null,
  date_of_birth: "1990-01-01",
  gender: "female",
  nationality: "Malaysia",
  oku_status: "none",
  oku_rejection_reason: null,
  fide_id: null,
  fide_rating: null,
  fide_rating_synced_at: null,
  fide_name_verified: null,
  fide_verified_name: null,
  title: null,
  mcf_id: null,
  national_rating: null,
  bank_name: null,
  bank_code: null,
  bank_account_holder: null,
  bank_account_number_last4: null,
  bank_account_status: null,
  bank_account_rejection_reason: null,
  bank_holder_name: null,
};

afterEach(() => {
  cleanup();
  window.history.replaceState(null, "", "/");
});

describe("ProfileClient edit mode", () => {
  it("opens on the read-only view by default", () => {
    render(<ProfileClient profile={PROFILE} />);

    expect(screen.getByRole("button", { name: "Edit Profile" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save Changes" })).toBeNull();
  });

  it("opens straight on the form when asked to start editing", () => {
    render(<ProfileClient profile={PROFILE} startEditing />);

    expect(screen.getByRole("button", { name: "Save Changes" })).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Edit Profile" })).toBeNull();
  });

  it("drops ?edit=1 from the URL on cancel so a reload shows the profile", () => {
    window.history.replaceState(null, "", "/settings?edit=1");
    render(<ProfileClient profile={PROFILE} startEditing />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(screen.getByRole("button", { name: "Edit Profile" })).toBeTruthy();
    expect(window.location.pathname).toBe("/settings");
    expect(window.location.search).toBe("");
  });

  it("keeps other query parameters when dropping edit", () => {
    window.history.replaceState(null, "", "/settings?edit=1&from=profile");
    render(<ProfileClient profile={PROFILE} startEditing />);

    fireEvent.click(screen.getByRole("button", { name: "Cancel" }));

    expect(window.location.search).toBe("?from=profile");
  });
});
