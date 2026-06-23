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

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe("ApplyForm", () => {
  describe("initial render", () => {
    it("renders the form heading", () => {
      render(<ApplyForm />);
      expect(screen.getByText("Apply as Tournament Organizer")).toBeDefined();
    });

    it("renders the submit button in idle state", () => {
      render(<ApplyForm />);
      expect(getSubmitButton()).toBeDefined();
      expect(getSubmitButton().disabled).toBe(false);
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
      const select = screen.getByRole("combobox") as HTMLSelectElement;
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
      const nameInput = screen.getByPlaceholderText(
        "e.g., KL Chess Association",
      );
      const emailInput = screen.getByPlaceholderText("chess@org.com");
      fireEvent.change(nameInput, { target: { value: "Test Org" } });
      fireEvent.change(emailInput, { target: { value: "test@org.com" } });
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
      const nameInput = screen.getByPlaceholderText(
        "e.g., KL Chess Association",
      );
      const emailInput = screen.getByPlaceholderText("chess@org.com");
      fireEvent.change(nameInput, { target: { value: "Test Org" } });
      fireEvent.change(emailInput, { target: { value: "test@org.com" } });

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
      const nameInput = screen.getByPlaceholderText(
        "e.g., KL Chess Association",
      );
      const emailInput = screen.getByPlaceholderText("chess@org.com");
      fireEvent.change(nameInput, { target: { value: "Test Org" } });
      fireEvent.change(emailInput, { target: { value: "test@org.com" } });

      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });

      const body = JSON.parse(mockFetch.mock.calls[0][1].body);
      expect(body.links).toBeNull();
    });
  });

  describe("handleSubmit — error", () => {
    it("shows the API error message on a failed response", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorFetch("Already applied"));
      render(<ApplyForm />);

      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });

      expect(screen.getByText("Already applied")).toBeDefined();
    });

    it("shows a generic error when the API returns no message", async () => {
      mockFetch.mockResolvedValueOnce({
        ok: false,
        json: vi.fn().mockResolvedValue({}),
      });
      render(<ApplyForm />);

      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });

      expect(
        screen.getByText("Submission failed. Please try again."),
      ).toBeDefined();
    });

    it("shows a network error when fetch throws", async () => {
      mockFetch.mockRejectedValueOnce(new Error("Network failure"));
      render(<ApplyForm />);

      await act(async () => {
        fireEvent.submit(document.querySelector("form")!);
      });

      expect(
        screen.getByText("A network error occurred. Please try again."),
      ).toBeDefined();
    });

    it("re-enables the submit button after an error", async () => {
      mockFetch.mockResolvedValueOnce(makeErrorFetch("Bad request"));
      render(<ApplyForm />);

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

      act(() => {
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
