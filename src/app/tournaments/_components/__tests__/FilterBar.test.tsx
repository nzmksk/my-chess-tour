// @vitest-environment jsdom
import { describe, it, expect, vi, afterEach, beforeEach } from "vitest";
import { render, screen, fireEvent, cleanup, act } from "@testing-library/react";
import FilterBar from "../FilterBar";

afterEach(cleanup);

// ── Helper ────────────────────────────────────────────────────

function defaultProps() {
  return {
    search: "",
    onSearchChange: vi.fn(),
    formats: [] as string[],
    onFormatsChange: vi.fn(),
    states: [] as string[],
    onStatesChange: vi.fn(),
    ratings: [] as string[],
    onRatingsChange: vi.fn(),
    dateFilter: "any",
    onDateFilterChange: vi.fn(),
    allStates: ["Selangor", "Johor", "Perak"],
  };
}

// ── displayLabel branches ─────────────────────────────────────

describe("displayLabel — Format dropdown", () => {
  it("shows 'Format' label when nothing is selected", () => {
    render(<FilterBar {...defaultProps()} />);
    const btn = screen.getAllByRole("button")[0];
    expect(btn.textContent).toBe("Format");
  });

  it("shows item label when 1 item is selected", () => {
    render(<FilterBar {...defaultProps()} formats={["rapid"]} />);
    const btn = screen.getAllByRole("button")[0];
    expect(btn.textContent).toBe("Rapid");
  });

  it("shows both labels joined with ', ' when 2 items are selected", () => {
    render(<FilterBar {...defaultProps()} formats={["rapid", "blitz"]} />);
    const btn = screen.getAllByRole("button")[0];
    expect(btn.textContent).toBe("Rapid, Blitz");
  });

  it("shows 'Format (3)' when 3 or more items are selected", () => {
    render(
      <FilterBar
        {...defaultProps()}
        formats={["rapid", "blitz", "classical"]}
      />,
    );
    const btn = screen.getAllByRole("button")[0];
    expect(btn.textContent).toBe("Format (3)");
  });
});

// ── hasSelection → active button class ───────────────────────

describe("hasSelection — active class", () => {
  it("does not apply filter-btn--active when nothing is selected", () => {
    render(<FilterBar {...defaultProps()} />);
    const btn = screen.getAllByRole("button")[0];
    expect(btn.className).not.toContain("filter-btn--active");
  });

  it("applies filter-btn--active when at least one item is selected", () => {
    render(<FilterBar {...defaultProps()} formats={["rapid"]} />);
    const btn = screen.getAllByRole("button")[0];
    expect(btn.className).toContain("filter-btn--active");
  });
});

// ── hasActiveFilters ──────────────────────────────────────────

describe("hasActiveFilters", () => {
  it("does not render Clear filters button when no filters are active", () => {
    render(<FilterBar {...defaultProps()} />);
    expect(screen.queryByText("Clear filters")).toBeNull();
  });

  it("renders Clear filters button when search is set", () => {
    render(<FilterBar {...defaultProps()} search="test" />);
    expect(screen.getByText("Clear filters")).toBeDefined();
  });

  it("renders Clear filters button when formats are selected", () => {
    render(<FilterBar {...defaultProps()} formats={["rapid"]} />);
    expect(screen.getByText("Clear filters")).toBeDefined();
  });

  it("renders Clear filters button when states are selected", () => {
    render(<FilterBar {...defaultProps()} states={["Selangor"]} />);
    expect(screen.getByText("Clear filters")).toBeDefined();
  });

  it("renders Clear filters button when ratings are selected", () => {
    render(<FilterBar {...defaultProps()} ratings={["fide"]} />);
    expect(screen.getByText("Clear filters")).toBeDefined();
  });

  it("renders Clear filters button when dateFilter is not 'any'", () => {
    render(<FilterBar {...defaultProps()} dateFilter="this-week" />);
    expect(screen.getByText("Clear filters")).toBeDefined();
  });
});

// ── handleReset ───────────────────────────────────────────────

describe("handleReset", () => {
  it("calls all 5 reset callbacks with correct values when Clear filters is clicked", async () => {
    const props = {
      ...defaultProps(),
      search: "foo",
      formats: ["rapid"],
      states: ["Selangor"],
      ratings: ["fide"],
      dateFilter: "this-week",
    };
    render(<FilterBar {...props} />);

    await act(async () => {
      fireEvent.click(screen.getByText("Clear filters"));
    });

    expect(props.onSearchChange).toHaveBeenCalledWith("");
    expect(props.onFormatsChange).toHaveBeenCalledWith([]);
    expect(props.onStatesChange).toHaveBeenCalledWith([]);
    expect(props.onRatingsChange).toHaveBeenCalledWith([]);
    expect(props.onDateFilterChange).toHaveBeenCalledWith("any");
  });
});

// ── date select ───────────────────────────────────────────────

describe("date select", () => {
  it("does not apply filter-btn--active when dateFilter is 'any'", () => {
    render(<FilterBar {...defaultProps()} dateFilter="any" />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.className).not.toContain("filter-btn--active");
  });

  it("applies filter-btn--active when dateFilter is 'this-week'", () => {
    render(<FilterBar {...defaultProps()} dateFilter="this-week" />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    expect(select.className).toContain("filter-btn--active");
  });

  it("calls onDateFilterChange when select value changes", async () => {
    const props = defaultProps();
    render(<FilterBar {...props} />);
    const select = screen.getByRole("combobox");

    await act(async () => {
      fireEvent.change(select, { target: { value: "this-month" } });
    });

    expect(props.onDateFilterChange).toHaveBeenCalledWith("this-month");
  });

  it("renders all 4 date options", () => {
    render(<FilterBar {...defaultProps()} />);
    const select = screen.getByRole("combobox") as HTMLSelectElement;
    const options = Array.from(select.options).map((o) => o.value);
    expect(options).toEqual(["any", "this-week", "this-month", "next-month"]);
  });
});

// ── search input ──────────────────────────────────────────────

describe("search input", () => {
  it("renders with the current search value", () => {
    render(<FilterBar {...defaultProps()} search="Selangor Open" />);
    const input = screen.getByPlaceholderText(
      "Search tournaments...",
    ) as HTMLInputElement;
    expect(input.value).toBe("Selangor Open");
  });

  it("calls onSearchChange when the input changes", async () => {
    const props = defaultProps();
    render(<FilterBar {...props} />);
    const input = screen.getByPlaceholderText("Search tournaments...");

    await act(async () => {
      fireEvent.change(input, { target: { value: "KL" } });
    });

    expect(props.onSearchChange).toHaveBeenCalledWith("KL");
  });
});

// ── dropdown open/close ───────────────────────────────────────

describe("dropdown open/close", () => {
  it("does not show checkboxes when dropdown is closed initially", () => {
    render(<FilterBar {...defaultProps()} />);
    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });

  it("shows checkboxes after clicking the Format button", async () => {
    render(<FilterBar {...defaultProps()} />);
    const btn = screen.getAllByRole("button")[0];

    await act(async () => {
      fireEvent.click(btn);
    });

    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);
  });

  it("closes the dropdown when clicking outside (mousedown on document.body)", async () => {
    render(<FilterBar {...defaultProps()} />);
    const btn = screen.getAllByRole("button")[0];

    await act(async () => {
      fireEvent.click(btn);
    });

    // Dropdown is open — checkboxes should be visible
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThan(0);

    await act(async () => {
      fireEvent.mouseDown(document.body);
    });

    expect(screen.queryAllByRole("checkbox")).toHaveLength(0);
  });
});

// ── toggle (add/remove selection) ────────────────────────────

describe("toggle — add/remove selection", () => {
  it("calls onChange with value added when an unchecked checkbox is clicked", async () => {
    const props = defaultProps();
    render(<FilterBar {...props} />);
    const formatBtn = screen.getAllByRole("button")[0];

    await act(async () => {
      fireEvent.click(formatBtn);
    });

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    // "Rapid" is the first FORMAT_OPTIONS item
    const rapidCheckbox = checkboxes.find(
      (cb) => !cb.checked && cb.closest("label")?.textContent?.includes("Rapid"),
    )!;

    await act(async () => {
      fireEvent.click(rapidCheckbox);
    });

    expect(props.onFormatsChange).toHaveBeenCalledWith(["rapid"]);
  });

  it("calls onChange with value removed when a checked checkbox is clicked", async () => {
    const props = { ...defaultProps(), formats: ["rapid"] };
    render(<FilterBar {...props} />);
    const formatBtn = screen.getAllByRole("button")[0];

    await act(async () => {
      fireEvent.click(formatBtn);
    });

    const checkboxes = screen.getAllByRole("checkbox") as HTMLInputElement[];
    const rapidCheckbox = checkboxes.find((cb) =>
      cb.closest("label")?.textContent?.includes("Rapid"),
    )!;

    await act(async () => {
      fireEvent.click(rapidCheckbox);
    });

    expect(props.onFormatsChange).toHaveBeenCalledWith([]);
  });
});
