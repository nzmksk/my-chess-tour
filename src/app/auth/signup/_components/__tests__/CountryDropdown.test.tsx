// @vitest-environment jsdom
import React from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";

import CountryDropdown from "../CountryDropdown";

afterEach(cleanup);

function setup(value = "", onChange = vi.fn()) {
  render(<CountryDropdown id="nationality" value={value} onChange={onChange} />);
  return { onChange };
}

describe("CountryDropdown", () => {
  it("renders the trigger button associated with the id", () => {
    setup();
    expect(screen.getByRole("button")).toBeDefined();
  });

  it("shows placeholder text when no value is selected", () => {
    setup();
    expect(screen.getByRole("button").textContent).toContain("Select country");
  });

  it("shows selected country name in the trigger", () => {
    setup("Malaysia");
    expect(screen.getByRole("button").textContent).toContain("Malaysia");
  });

  it("opens dropdown on trigger click", async () => {
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    expect(screen.getByRole("listbox")).toBeDefined();
    expect(screen.getByPlaceholderText("Search countries…")).toBeDefined();
  });

  it("filters countries based on search query", async () => {
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Search countries…"), {
        target: { value: "malay" },
      });
    });
    const options = screen.getAllByRole("option");
    expect(options.length).toBe(1);
    expect(options[0].textContent).toBe("Malaysia");
  });

  it("shows no-results message for unmatched query", async () => {
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Search countries…"), {
        target: { value: "xyznotacountry" },
      });
    });
    expect(screen.getByText("No countries found")).toBeDefined();
  });

  it("calls onChange and closes dropdown when a country is selected", async () => {
    const onChange = vi.fn();
    render(<CountryDropdown id="nationality" value="" onChange={onChange} />);

    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Search countries…"), {
        target: { value: "singapore" },
      });
    });
    await act(async () => {
      fireEvent.click(screen.getByRole("option", { name: "Singapore" }));
    });

    expect(onChange).toHaveBeenCalledWith("Singapore");
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("closes dropdown on Escape key in search input", async () => {
    setup();
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    await act(async () => {
      fireEvent.keyDown(screen.getByPlaceholderText("Search countries…"), {
        key: "Escape",
      });
    });
    expect(screen.queryByRole("listbox")).toBeNull();
  });

  it("marks the currently selected country as aria-selected", async () => {
    setup("Malaysia");
    await act(async () => {
      fireEvent.click(screen.getByRole("button"));
    });
    await act(async () => {
      fireEvent.change(screen.getByPlaceholderText("Search countries…"), {
        target: { value: "malay" },
      });
    });
    const selected = screen.getByRole("option", { name: "Malaysia" });
    expect(selected.getAttribute("aria-selected")).toBe("true");
  });
});
