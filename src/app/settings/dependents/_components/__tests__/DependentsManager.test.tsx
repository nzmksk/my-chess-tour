// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
  within,
} from "@testing-library/react";
import type { DependentView } from "@/services/guardianship/dependents";
import DependentsManager from "../DependentsManager";

const mockFetch = vi.fn();

const MINOR_DOB = "2015-05-01";
const ADULT_DOB = "1990-01-01";

function dependent(overrides: Partial<DependentView> = {}): DependentView {
  return {
    id: "d1000000-0000-4000-8000-000000000001",
    guardianship_id: "g1000000-0000-4000-8000-000000000001",
    first_name: "Aina",
    last_name: "Rahman",
    account_type: "managed",
    contact_email: null,
    relationship: "parent",
    basis: "minor",
    authorisation_method: null,
    terms_version: "2026-11-24",
    terms_accepted_at: "2026-11-24T00:00:00.000Z",
    added_at: "2026-11-24T00:00:00.000Z",
    date_of_birth: MINOR_DOB,
    gender: "female",
    nationality: null,
    fide_id: null,
    mcf_id: 12345,
    title: null,
    national_rating: null,
    oku_status: "none",
    ...overrides,
  };
}

function reply(status: number, body: unknown) {
  return Promise.resolve({
    ok: status >= 200 && status < 300,
    status,
    json: () => Promise.resolve(body),
  });
}

function lastCall(method: string) {
  const calls = mockFetch.mock.calls.filter(
    ([, init]) => (init?.method ?? "GET") === method,
  );
  const [url, init] = calls[calls.length - 1];
  return { url, body: init?.body ? JSON.parse(init.body) : undefined };
}

beforeEach(() => {
  vi.stubGlobal("fetch", mockFetch);
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
  vi.unstubAllGlobals();
});

async function renderWith(list: DependentView[]) {
  mockFetch.mockImplementationOnce(() => reply(200, { data: list }));
  render(<DependentsManager />);
  await screen.findByRole("button", { name: "Add a Dependent" });
}

function openAddForm() {
  fireEvent.click(screen.getByRole("button", { name: "Add a Dependent" }));
}

function fillMinor() {
  fireEvent.click(screen.getByLabelText(/My child under 18/));
  fireEvent.change(screen.getByLabelText("They are your"), {
    target: { value: "parent" },
  });
  fireEvent.change(screen.getByLabelText("First name"), {
    target: { value: " Aina " },
  });
  fireEvent.change(screen.getByLabelText("Last name"), {
    target: { value: "Rahman" },
  });
  fireEvent.change(screen.getByLabelText("Date of birth"), {
    target: { value: MINOR_DOB },
  });
}

function fillAdult() {
  fireEvent.click(screen.getByLabelText(/An adult I help/));
  fireEvent.change(screen.getByLabelText("They are your"), {
    target: { value: "carer" },
  });
  fireEvent.change(screen.getByLabelText("First name"), {
    target: { value: "Badrul" },
  });
  fireEvent.change(screen.getByLabelText("Last name"), {
    target: { value: "Hisham" },
  });
  fireEvent.change(screen.getByLabelText("Date of birth"), {
    target: { value: ADULT_DOB },
  });
}

function submitAdd() {
  fireEvent.click(screen.getByRole("button", { name: "Add Dependent" }));
}

describe("DependentsManager", () => {
  describe("list", () => {
    it("lists the guardian's dependents with their details", async () => {
      await renderWith([dependent()]);
      const card = screen.getByRole("listitem");
      expect(within(card).getByText("Aina Rahman")).toBeDefined();
      expect(within(card).getByText("Parent · Under 18")).toBeDefined();
      expect(within(card).getByText("12345")).toBeDefined();
      expect(within(card).queryByText("Their email")).toBeNull();
    });

    it("explains what dependents are when there are none", async () => {
      await renderWith([]);
      expect(screen.getByText(/You haven't added anyone yet/)).toBeDefined();
    });

    it("says so when the list can't be loaded", async () => {
      mockFetch.mockImplementationOnce(() =>
        reply(500, { error: { message: "Something went wrong." } }),
      );
      render(<DependentsManager />);
      expect((await screen.findByRole("alert")).textContent).toMatch(
        /Something went wrong\. Refresh the page/,
      );
    });
  });

  describe("adding", () => {
    it("asks who the player is in plain words before anything else", async () => {
      await renderWith([]);
      openAddForm();
      const group = screen.getByRole("group", {
        name: "Who is the player to you?",
      });
      expect(within(group).getAllByRole("radio")).toHaveLength(3);
      expect(screen.queryByLabelText("First name")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Add Dependent" }),
      ).toBeNull();
    });

    it("adds a child with the guardian's acceptance of the Terms", async () => {
      await renderWith([]);
      openAddForm();
      fillMinor();
      expect(screen.queryByLabelText("Their email")).toBeNull();
      expect(screen.queryByLabelText(/has authorised me/)).toBeNull();
      fireEvent.click(
        screen.getByLabelText(/parent or legal guardian, I accept/),
      );

      mockFetch.mockImplementationOnce(() =>
        reply(201, { data: { ...dependent(), reactivated: false } }),
      );
      submitAdd();

      expect(await screen.findByText(/Aina Rahman was added/)).toBeDefined();
      const { url, body } = lastCall("POST");
      expect(url).toBe("/api/v1/me/dependents");
      expect(body).toEqual({
        basis: "minor",
        relationship: "parent",
        first_name: "Aina",
        last_name: "Rahman",
        date_of_birth: MINOR_DOB,
        gender: null,
        nationality: null,
        contact_email: null,
        accept_terms: true,
      });
      expect(screen.getByRole("listitem")).toBeDefined();
    });

    it("offers only parent or legal guardian for a child", async () => {
      await renderWith([]);
      openAddForm();
      fireEvent.click(screen.getByLabelText(/My child under 18/));
      const options = within(screen.getByLabelText("They are your"))
        .getAllByRole("option")
        .map((o) => o.textContent);
      expect(options).toEqual(["Select…", "Parent", "Legal guardian"]);
    });

    it("needs the player's authorisation and the Terms for an adult", async () => {
      await renderWith([]);
      openAddForm();
      fillAdult();
      fireEvent.change(screen.getByLabelText("Their email"), {
        target: { value: "badrul@example.com" },
      });
      submitAdd();

      expect(screen.getByRole("alert").textContent).toMatch(
        /fix the highlighted fields/,
      );
      expect(
        screen.getByText(/Confirm that the player has authorised you/),
      ).toBeDefined();
      expect(screen.getByText("Accept the Terms to continue.")).toBeDefined();
      expect(
        screen.getByLabelText(/has authorised me/).getAttribute("aria-invalid"),
      ).toBe("true");
      expect(mockFetch).toHaveBeenCalledTimes(1);

      fireEvent.click(screen.getByLabelText(/Badrul has authorised me/));
      fireEvent.click(screen.getByLabelText(/act for Badrul under the/));
      mockFetch.mockImplementationOnce(() =>
        reply(201, {
          data: {
            ...dependent({
              first_name: "Badrul",
              last_name: "Hisham",
              basis: "authorised",
              relationship: "carer",
              date_of_birth: ADULT_DOB,
            }),
            reactivated: false,
          },
        }),
      );
      submitAdd();

      await screen.findByText(/Badrul Hisham was added/);
      expect(lastCall("POST").body).toMatchObject({
        basis: "authorised",
        relationship: "carer",
        contact_email: "badrul@example.com",
        accept_terms: true,
        authorised_by_player: true,
      });
    });

    it("catches a date of birth that doesn't match the choice", async () => {
      await renderWith([]);
      openAddForm();
      fillMinor();
      fireEvent.change(screen.getByLabelText("Date of birth"), {
        target: { value: ADULT_DOB },
      });
      fireEvent.click(
        screen.getByLabelText(/parent or legal guardian, I accept/),
      );
      submitAdd();

      expect(screen.getByText(/makes them 18 or over/)).toBeDefined();
      expect(
        screen.getByLabelText("Date of birth").getAttribute("aria-describedby"),
      ).toContain("dateOfBirth-error");
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });

    it("sends an appointed guardian to support instead of a form", async () => {
      await renderWith([]);
      openAddForm();
      fireEvent.click(screen.getByLabelText(/legally appointed for/));
      expect(screen.getByText(/needs proof of the appointment/)).toBeDefined();
      expect(screen.queryByLabelText("First name")).toBeNull();
      expect(
        screen.queryByRole("button", { name: "Add Dependent" }),
      ).toBeNull();
    });

    it("shows the server's refusal", async () => {
      await renderWith([]);
      openAddForm();
      fillMinor();
      fireEvent.click(
        screen.getByLabelText(/parent or legal guardian, I accept/),
      );
      mockFetch.mockImplementationOnce(() =>
        reply(409, {
          error: { message: "This dependent is already on your account." },
        }),
      );
      submitAdd();

      expect((await screen.findByRole("alert")).textContent).toBe(
        "This dependent is already on your account.",
      );
    });

    it("says when an earlier record was brought back", async () => {
      await renderWith([]);
      openAddForm();
      fillMinor();
      fireEvent.click(
        screen.getByLabelText(/parent or legal guardian, I accept/),
      );
      mockFetch.mockImplementationOnce(() =>
        reply(200, { data: { ...dependent(), reactivated: true } }),
      );
      submitAdd();

      expect(
        await screen.findByText(/back on your account, with their earlier/),
      ).toBeDefined();
    });

    it("returns focus to the add button on cancel", async () => {
      await renderWith([]);
      openAddForm();
      fireEvent.click(screen.getByRole("button", { name: "Cancel" }));
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Add a Dependent" }),
      );
    });
  });

  describe("editing", () => {
    it("edits only the details that aren't set yet", async () => {
      await renderWith([dependent()]);
      fireEvent.click(screen.getByRole("button", { name: "Edit Aina Rahman" }));

      expect(screen.queryByLabelText("Gender")).toBeNull();
      expect(screen.queryByLabelText("MCF ID")).toBeNull();
      expect(screen.getAllByText("Contact support to change.")).toHaveLength(2);
      expect(screen.getByLabelText("Nationality")).toBeDefined();

      fireEvent.change(screen.getByLabelText("FIDE ID"), {
        target: { value: "36095765" },
      });
      mockFetch.mockImplementationOnce(() =>
        reply(200, { data: dependent({ fide_id: 36095765 }) }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

      expect(await screen.findByText("36095765")).toBeDefined();
      const { url, body } = lastCall("PATCH");
      expect(url).toBe(
        "/api/v1/me/dependents/d1000000-0000-4000-8000-000000000001",
      );
      expect(body).toEqual({ fide_id: 36095765 });
    });

    it("lets an adult's contact email be changed or cleared", async () => {
      await renderWith([
        dependent({
          basis: "authorised",
          relationship: "carer",
          date_of_birth: ADULT_DOB,
          contact_email: "old@example.com",
        }),
      ]);
      fireEvent.click(screen.getByRole("button", { name: "Edit Aina Rahman" }));
      fireEvent.change(screen.getByLabelText("Their email"), {
        target: { value: "" },
      });
      mockFetch.mockImplementationOnce(() =>
        reply(200, { data: dependent({ basis: "authorised" }) }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));

      await waitFor(() =>
        expect(lastCall("PATCH").body).toEqual({ contact_email: null }),
      );
    });

    it("rejects an ID that isn't a number without calling the API", async () => {
      await renderWith([dependent()]);
      fireEvent.click(screen.getByRole("button", { name: "Edit Aina Rahman" }));
      fireEvent.change(screen.getByLabelText("FIDE ID"), {
        target: { value: "abc" },
      });
      fireEvent.click(screen.getByRole("button", { name: "Save Changes" }));
      expect(screen.getByRole("alert").textContent).toBe(
        "The FIDE ID must be a number.",
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });

  describe("removing", () => {
    it("asks for confirmation, then removes", async () => {
      await renderWith([dependent()]);
      fireEvent.click(
        screen.getByRole("button", { name: "Remove Aina Rahman" }),
      );
      expect(
        screen.getByText(/Remove Aina Rahman from your account\?/),
      ).toBeDefined();

      mockFetch.mockImplementationOnce(() =>
        reply(200, {
          data: { revoked: true, upcoming_registrations: [], warning: null },
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Remove Dependent" }));

      expect(
        await screen.findByText("Aina Rahman was removed from your account."),
      ).toBeDefined();
      expect(screen.queryByRole("listitem")).toBeNull();
      expect(lastCall("DELETE").url).toBe(
        "/api/v1/me/dependents/d1000000-0000-4000-8000-000000000001",
      );
    });

    it("explains that a pending payment blocks removal", async () => {
      await renderWith([dependent()]);
      fireEvent.click(
        screen.getByRole("button", { name: "Remove Aina Rahman" }),
      );
      mockFetch.mockImplementationOnce(() =>
        reply(422, {
          error: {
            code: "PENDING_PAYMENT",
            message:
              "This dependent has a registration waiting for payment. Finish or cancel that checkout before removing them.",
          },
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Remove Dependent" }));

      expect((await screen.findByRole("alert")).textContent).toMatch(
        /waiting for payment/,
      );
      expect(screen.getByRole("listitem")).toBeDefined();
    });

    it("lists the upcoming registrations that stay in place", async () => {
      await renderWith([dependent()]);
      fireEvent.click(
        screen.getByRole("button", { name: "Remove Aina Rahman" }),
      );
      mockFetch.mockImplementationOnce(() =>
        reply(200, {
          data: {
            revoked: true,
            upcoming_registrations: [
              {
                registration_id: "r1",
                tournament_id: "t1",
                tournament_name: "KL Junior Open",
                start_date: "2026-12-20",
              },
            ],
            warning:
              "Aina is still registered for 1 upcoming tournament. Those registrations stay in place; you can no longer manage them.",
          },
        }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Remove Dependent" }));

      const status = await screen.findByText(/still registered for 1 upcoming/);
      expect(status).toBeDefined();
      expect(screen.getByText(/KL Junior Open, starting/)).toBeDefined();
    });

    it("keeps the dependent when the guardian changes their mind", async () => {
      await renderWith([dependent()]);
      fireEvent.click(
        screen.getByRole("button", { name: "Remove Aina Rahman" }),
      );
      fireEvent.click(screen.getByRole("button", { name: "Keep Aina" }));
      expect(document.activeElement).toBe(
        screen.getByRole("button", { name: "Edit Aina Rahman" }),
      );
      expect(mockFetch).toHaveBeenCalledTimes(1);
    });
  });
});
