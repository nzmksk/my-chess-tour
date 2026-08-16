// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  cleanup,
  fireEvent,
  render,
  screen,
  act,
} from "@testing-library/react";
import ApplyForm from "../ApplyForm";

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

const mockPush = vi.fn();
vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: mockPush }),
}));

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

// KYB documents go browser→storage before the POST, so the form now needs a
// Supabase browser client. Uploads succeed by default; the tests that care
// about failure override it.
const mockUpload = vi.fn();
const mockGetUser = vi.fn();
vi.mock("@/services/supabase/client", () => ({
  createClient: () => ({
    auth: { getUser: mockGetUser },
    storage: { from: () => ({ upload: mockUpload }) },
  }),
}));

const APP_USER_ID = "aaaaaaaa-0000-0000-0000-000000000001";

beforeEach(() => {
  mockGetUser.mockResolvedValue({ data: { user: { id: APP_USER_ID } } });
  mockUpload.mockResolvedValue({ error: null });
});

afterEach(() => {
  cleanup();
  vi.resetAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeSuccessFetch(name = "KL Chess Association") {
  return {
    ok: true,
    json: vi.fn().mockResolvedValue({ data: { name } }),
  };
}

function makeErrorFetch(message: string) {
  return {
    ok: false,
    json: vi.fn().mockResolvedValue({ error: { message } }),
  };
}

function getAddLinkButton() {
  return screen.getByRole("button", { name: "+ Add Link" });
}

function getRemoveLinkButtons() {
  return screen.getAllByRole("button", { name: "Remove link" });
}

function getSubmitButton() {
  return screen.getByRole("button", {
    name: "Submit Application",
  }) as HTMLButtonElement;
}

function getAgreementCheckbox() {
  return screen.getByLabelText(
    "I have read and accept the Organizer Agreement",
  ) as HTMLInputElement;
}

function acceptAgreement() {
  fireEvent.click(getAgreementCheckbox());
}

/**
 * Fill everything the form now refuses to submit without: the payout bank
 * account, the entity registration number, and one verification document of the
 * type the selected entity requires. Defaults to the 'company' entity, which is
 * what the form opens on.
 */
function fillPayoutAndKyb() {
  fireEvent.change(screen.getByLabelText("Bank"), {
    target: { value: "MBBEMYKL" },
  });
  fireEvent.change(screen.getByLabelText("Account Holder Name"), {
    target: { value: "Test Org" },
  });
  fireEvent.change(screen.getByLabelText("Account Number"), {
    target: { value: "5140 1234-5678" },
  });
  fireEvent.change(screen.getByLabelText(/SSM Registration Number/), {
    target: { value: "202001234567" },
  });
  fireEvent.change(screen.getByLabelText("Verification documents"), {
    target: {
      files: [
        new File(["%PDF-1.4"], "ssm.pdf", { type: "application/pdf" }),
      ],
    },
  });
}

function fillOrgBasics(name = "Test Org") {
  fireEvent.change(screen.getByPlaceholderText("e.g., KL Chess Association"), {
    target: { value: name },
  });
  fireEvent.change(screen.getByPlaceholderText("chess@org.com"), {
    target: { value: "test@org.com" },
  });
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApplyForm", () => {
  describe("initial render", () => {
    it("renders the form heading", () => {
      render(<ApplyForm />);
      expect(screen.getByText("Apply as Tournament Organizer")).toBeDefined();
    });

    it("cannot be submitted until the Organizer Agreement is accepted", () => {
      // The agreement is what makes the payout terms and the claw-back binding,
      // so it is a precondition of applying, not a footnote.
      render(<ApplyForm />);
      expect(getSubmitButton().disabled).toBe(true);

      acceptAgreement();
      expect(getSubmitButton().disabled).toBe(false);
    });

    it("links to the agreement so it can be read before accepting", () => {
      render(<ApplyForm />);
      const link = screen.getByRole("link", { name: "Organizer Agreement" });
      expect(link.getAttribute("href")).toBe("/organizer-agreement");
      expect(link.getAttribute("target")).toBe("_blank");
    });

    it("renders no link rows initially", () => {
      render(<ApplyForm />);
      expect(screen.queryByRole("button", { name: "Remove link" })).toBeNull();
    });
  });

  describe("addLink", () => {
    it("adds a link row when clicking '+ Add Link'", () => {
      render(<ApplyForm />);
      fireEvent.click(getAddLinkButton());
      expect(getRemoveLinkButtons()).toHaveLength(1);
    });

    it("adds multiple link rows on repeated clicks", () => {
      render(<ApplyForm />);
      fireEvent.click(getAddLinkButton());
      fireEvent.click(getAddLinkButton());
      expect(getRemoveLinkButtons()).toHaveLength(2);
    });
  });

  describe("removeLink", () => {
    it("removes a link row when clicking the remove button", () => {
      render(<ApplyForm />);
      fireEvent.click(getAddLinkButton());
      fireEvent.click(getAddLinkButton());
      const [firstRemove] = getRemoveLinkButtons();
      fireEvent.click(firstRemove);
      expect(getRemoveLinkButtons()).toHaveLength(1);
    });

    it("removes all link rows when each is deleted", () => {
      render(<ApplyForm />);
      fireEvent.click(getAddLinkButton());
      fireEvent.click(getRemoveLinkButtons()[0]);
      expect(screen.queryByRole("button", { name: "Remove link" })).toBeNull();
    });
  });

  describe("updateLink", () => {
    it("updates the URL field of a link row", () => {
      render(<ApplyForm />);
      fireEvent.click(getAddLinkButton());
      const urlInput = screen.getByPlaceholderText(
        "https://...",
      ) as HTMLInputElement;
      fireEvent.change(urlInput, { target: { value: "https://example.com" } });
      expect(urlInput.value).toBe("https://example.com");
    });

    it("updates the type (select) of a link row", () => {
      render(<ApplyForm />);
      fireEvent.click(getAddLinkButton());
      const select = screen.getByLabelText("Link type 1") as HTMLSelectElement;
      fireEvent.change(select, { target: { value: "facebook" } });
      expect(select.value).toBe("facebook");
    });
  });

  describe("handleSubmit — success", () => {
    beforeEach(() => {
      mockFetch.mockResolvedValueOnce(makeSuccessFetch("Test Org"));
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    async function submitForm() {
      render(<ApplyForm />);
      fillOrgBasics();
      fillPayoutAndKyb();
      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });
    }

    it("shows the success state after a successful API response", async () => {
      await submitForm();
      expect(screen.getByText("Application Submitted")).toBeDefined();
      expect(screen.getByText(/Test Org/)).toBeDefined();
    });

    it("shows navigation buttons after successful submission", async () => {
      await submitForm();
      expect(
        screen.getByRole("button", { name: /View My Organizations/ }),
      ).toBeDefined();
      expect(
        screen.getByRole("button", { name: "Back to Tournaments" }),
      ).toBeDefined();
    });

    it("redirects to /my/organizations/applications when primary button is clicked", async () => {
      await submitForm();
      fireEvent.click(
        screen.getByRole("button", { name: /View My Organizations/ }),
      );
      expect(mockPush).toHaveBeenCalledWith("/my/organizations/applications");
    });

    it("redirects to /tournaments when secondary button is clicked", async () => {
      await submitForm();
      fireEvent.click(
        screen.getByRole("button", { name: "Back to Tournaments" }),
      );
      expect(mockPush).toHaveBeenCalledWith("/tournaments");
    });

    it("auto-redirects to /my/organizations/applications after 5 seconds", async () => {
      await submitForm();
      for (let i = 0; i < 5; i++) {
        await act(async () => {
          vi.advanceTimersByTime(1000);
        });
      }
      expect(mockPush).toHaveBeenCalledWith("/my/organizations/applications");
    });

    it("passes filtered links (non-empty URLs only) in the request body", async () => {
      render(<ApplyForm />);
      fireEvent.click(getAddLinkButton()); // add a link row
      const urlInput = screen.getByPlaceholderText(
        "https://...",
      ) as HTMLInputElement;
      fireEvent.change(urlInput, { target: { value: "https://fb.com/chess" } });

      fireEvent.click(getAddLinkButton()); // add a second (empty) link row
      fillOrgBasics();
      fillPayoutAndKyb();

      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.links).toHaveLength(1);
      expect(body.links[0].url).toBe("https://fb.com/chess");
    });

    it("sends null for links when all link rows have empty URLs", async () => {
      render(<ApplyForm />);
      fireEvent.click(getAddLinkButton());
      // leave URL empty
      fillOrgBasics();
      fillPayoutAndKyb();

      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.links).toBeNull();
    });

    it("sends the acceptance but never a version — the server decides that", async () => {
      render(<ApplyForm />);
      acceptAgreement();
      fillOrgBasics();
      fillPayoutAndKyb();

      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.agreement_accepted).toBe(true);
      expect(body).not.toHaveProperty("agreement_version");
    });

    it("sends a SWIFT code and a normalized account number, never a bank name", async () => {
      // The server derives the display name from the code, so the two cannot
      // disagree about which bank the money is going to.
      await submitForm();

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.bank_code).toBe("MBBEMYKL");
      expect(body.bank_account_number).toBe("514012345678");
      expect(body).not.toHaveProperty("bank_name");
    });

    it("uploads each document to the user's own folder and submits its path", async () => {
      await submitForm();

      expect(mockUpload).toHaveBeenCalledTimes(1);
      const uploadedPath = mockUpload.mock.calls[0][0] as string;
      expect(uploadedPath.startsWith(`users/${APP_USER_ID}/org-kyb/`)).toBe(
        true,
      );

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.documents).toHaveLength(1);
      expect(body.documents[0]).toMatchObject({
        doc_type: "ssm",
        storage_path: uploadedPath,
        original_filename: "ssm.pdf",
      });
    });
  });

  // The API and the RPC both enforce these; checking them here saves an upload
  // and a round trip, and names the missing piece.
  describe("client-side preconditions", () => {
    async function submitWith(setup: () => void) {
      render(<ApplyForm />);
      fillOrgBasics();
      setup();
      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });
    }

    it("refuses to submit without a bank chosen", async () => {
      await submitWith(() => {});
      expect(mockFetch).not.toHaveBeenCalled();
      expect(screen.getByText("Please choose your bank.")).toBeDefined();
    });

    it("refuses to submit without a registration number", async () => {
      await submitWith(() => {
        fireEvent.change(screen.getByLabelText("Bank"), {
          target: { value: "MBBEMYKL" },
        });
        fireEvent.change(screen.getByLabelText("Account Holder Name"), {
          target: { value: "Test Org" },
        });
        fireEvent.change(screen.getByLabelText("Account Number"), {
          target: { value: "514012345678" },
        });
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(
        screen.getByText("Please enter your SSM Registration Number."),
      ).toBeDefined();
    });

    it("refuses to submit without the document the entity type requires", async () => {
      await submitWith(() => {
        fireEvent.change(screen.getByLabelText("Bank"), {
          target: { value: "MBBEMYKL" },
        });
        fireEvent.change(screen.getByLabelText("Account Holder Name"), {
          target: { value: "Test Org" },
        });
        fireEvent.change(screen.getByLabelText("Account Number"), {
          target: { value: "514012345678" },
        });
        fireEvent.change(screen.getByLabelText(/SSM Registration Number/), {
          target: { value: "202001234567" },
        });
      });
      expect(mockFetch).not.toHaveBeenCalled();
      expect(mockUpload).not.toHaveBeenCalled();
    });

    it("drops the registration number field for an individual organizer", async () => {
      render(<ApplyForm />);
      fireEvent.click(screen.getByLabelText(/Individual organizer/));
      expect(screen.queryByLabelText(/Registration Number/)).toBeNull();
    });
  });

  describe("handleSubmit — error", () => {
    async function submitReady() {
      render(<ApplyForm />);
      fillOrgBasics();
      fillPayoutAndKyb();
      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });
    }

    it("shows the API error message on a failed response", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorFetch("Already applied"));
      await submitReady();
      expect(screen.getByText("Already applied")).toBeDefined();
    });

    it("shows a generic error when the API returns no message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      });
      await submitReady();
      expect(
        screen.getByText("Submission failed. Please try again."),
      ).toBeDefined();
    });

    it("shows a network error when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network failure"));
      await submitReady();
      expect(
        screen.getByText("A network error occurred. Please try again."),
      ).toBeDefined();
    });

    it("stops and reports when a document upload fails", async () => {
      mockUpload.mockResolvedValue({ error: { message: "storage down" } });
      await submitReady();
      expect(screen.getByText(/Failed to upload ssm.pdf/)).toBeDefined();
      expect(mockFetch).not.toHaveBeenCalled();
    });

    it("re-enables the submit button after an error", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorFetch("Bad request"));
      render(<ApplyForm />);
      acceptAgreement();
      fillOrgBasics();
      fillPayoutAndKyb();

      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });

      const btn = document.querySelector(
        "button[type='submit']",
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(false);
    });
  });

  describe("handleSubmit — submitting state", () => {
    it("disables the submit button while submitting", async () => {
      let resolveFetch!: (v: unknown) => void;
      mockFetch.mockReturnValueOnce(
        new Promise((resolve) => {
          resolveFetch = resolve;
        }),
      );
      render(<ApplyForm />);
      fillOrgBasics();
      fillPayoutAndKyb();

      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });

      const btn = document.querySelector(
        "button[type='submit']",
      ) as HTMLButtonElement;
      expect(btn.disabled).toBe(true);

      // Resolve to avoid hanging
      await act(async () => {
        resolveFetch({ ok: true, json: async () => ({ data: { name: "X" } }) });
      });
    });
  });
});
