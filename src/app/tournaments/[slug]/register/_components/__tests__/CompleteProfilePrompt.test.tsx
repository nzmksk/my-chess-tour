// @vitest-environment jsdom
import React from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

const mockFetch = vi.fn();
vi.stubGlobal("fetch", mockFetch);

import CompleteProfilePrompt from "../CompleteProfilePrompt";

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

beforeEach(() => {
  mockFetch.mockResolvedValue({
    ok: true,
    json: vi.fn().mockResolvedValue({ success: true }),
  });
});

describe("CompleteProfilePrompt", () => {
  it("renders only the requested fields", () => {
    render(<CompleteProfilePrompt missing={["fide_id"]} onSaved={vi.fn()} />);
    expect(screen.getByText("FIDE ID")).toBeDefined();
    expect(screen.queryByText("Gender")).toBeNull();
    expect(screen.queryByText("Date of Birth")).toBeNull();
  });

  it("shows a validation error and does not call the API when gender is unset", async () => {
    const onSaved = vi.fn();
    render(<CompleteProfilePrompt missing={["gender"]} onSaved={onSaved} />);
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));
    });
    expect(screen.getByText("Please select your gender.")).toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("requires a nationality to be selected when requested", async () => {
    const onSaved = vi.fn();
    render(
      <CompleteProfilePrompt missing={["nationality"]} onSaved={onSaved} />,
    );
    expect(screen.getByText("Nationality")).toBeDefined();
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));
    });
    expect(screen.getByText("Please select your nationality.")).toBeDefined();
    expect(mockFetch).not.toHaveBeenCalled();
    expect(onSaved).not.toHaveBeenCalled();
  });

  it("strips non-digits from ID inputs", async () => {
    render(<CompleteProfilePrompt missing={["fide_id"]} onSaved={vi.fn()} />);
    const input = screen.getByPlaceholderText(
      "e.g. 5834567",
    ) as HTMLInputElement;
    await act(async () => {
      fireEvent.change(input, { target: { value: "58a34!567" } });
    });
    expect(input.value).toBe("5834567");
  });

  it("PATCHes only the completed fields and reports them via onSaved", async () => {
    const onSaved = vi.fn();
    render(
      <CompleteProfilePrompt
        missing={["gender", "fide_id"]}
        onSaved={onSaved}
      />,
    );

    await act(async () => {
      fireEvent.change(screen.getByRole("combobox"), {
        target: { value: "female" },
      });
      fireEvent.change(screen.getByPlaceholderText("e.g. 5834567"), {
        target: { value: "5834567" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));
    });

    expect(mockFetch).toHaveBeenCalledWith(
      "/api/v1/profile",
      expect.objectContaining({ method: "PATCH" }),
    );
    const body = JSON.parse(mockFetch.mock.calls[0][1].body);
    expect(body).toEqual({ gender: "female", fide_id: 5834567 });
    expect(onSaved).toHaveBeenCalledWith({
      gender: "female",
      fide_id: 5834567,
    });
  });

  it("surfaces the API error message when the PATCH fails", async () => {
    mockFetch.mockResolvedValueOnce({
      ok: false,
      json: vi.fn().mockResolvedValue({
        error: { message: "fide_id can only be set once; contact support" },
      }),
    });
    const onSaved = vi.fn();
    render(<CompleteProfilePrompt missing={["fide_id"]} onSaved={onSaved} />);

    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("e.g. 5834567"), {
        target: { value: "5834567" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("button", { name: "Save & Continue" }));
    });

    expect(
      screen.getByText("fide_id can only be set once; contact support"),
    ).toBeDefined();
    expect(onSaved).not.toHaveBeenCalled();
  });
});
