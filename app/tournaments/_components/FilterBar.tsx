"use client";

import { useRef, useEffect, useState } from "react";

interface MultiSelectProps {
  label: string;
  options: Array<{ value: string; label: string }>;
  selected: string[];
  onChange: (values: string[]) => void;
}

function MultiSelectDropdown({
  label,
  options,
  selected,
  onChange,
}: MultiSelectProps) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function onClickOutside(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) {
        setOpen(false);
      }
    }
    document.addEventListener("mousedown", onClickOutside);
    return () => document.removeEventListener("mousedown", onClickOutside);
  }, []);

  function toggle(value: string) {
    onChange(
      selected.includes(value)
        ? selected.filter((v) => v !== value)
        : [...selected, value]
    );
  }

  const hasSelection = selected.length > 0;
  const displayLabel = hasSelection
    ? selected.length <= 2
      ? options
          .filter((o) => selected.includes(o.value))
          .map((o) => o.label)
          .join(", ")
      : `${label} (${selected.length})`
    : label;

  return (
    <div ref={ref} style={{ position: "relative" }}>
      <button
        onClick={() => setOpen(!open)}
        className={hasSelection ? "filter-btn filter-btn--active" : "filter-btn"}
      >
        {displayLabel}
      </button>

      {open && (
        <div className="filter-panel">
          {options.map((opt) => (
            <label key={opt.value} className="filter-checkbox-item">
              <input
                type="checkbox"
                checked={selected.includes(opt.value)}
                onChange={() => toggle(opt.value)}
                style={{
                  accentColor: "var(--color-gold-bright)",
                  width: "15px",
                  height: "15px",
                  flexShrink: 0,
                }}
              />
              {opt.label}
            </label>
          ))}
        </div>
      )}
    </div>
  );
}

// ─────────────────────────────────────────────────────────────

const FORMAT_OPTIONS = [
  { value: "rapid", label: "Rapid" },
  { value: "blitz", label: "Blitz" },
  { value: "classical", label: "Classical" },
];

const RATING_OPTIONS = [
  { value: "fide", label: "FIDE Rated" },
  { value: "mcf", label: "MCF Rated" },
  { value: "unrated", label: "Unrated" },
];

const DATE_OPTIONS = [
  { value: "any", label: "Any Date" },
  { value: "this-week", label: "This Week" },
  { value: "this-month", label: "This Month" },
  { value: "next-month", label: "Next Month" },
];

interface FilterBarProps {
  search: string;
  onSearchChange: (v: string) => void;
  formats: string[];
  onFormatsChange: (v: string[]) => void;
  states: string[];
  onStatesChange: (v: string[]) => void;
  ratings: string[];
  onRatingsChange: (v: string[]) => void;
  dateFilter: string;
  onDateFilterChange: (v: string) => void;
  allStates: string[];
}

export default function FilterBar({
  search,
  onSearchChange,
  formats,
  onFormatsChange,
  states,
  onStatesChange,
  ratings,
  onRatingsChange,
  dateFilter,
  onDateFilterChange,
  allStates,
}: FilterBarProps) {
  const stateOptions = allStates.map((s) => ({ value: s, label: s }));
  const hasActiveFilters =
    !!search ||
    formats.length > 0 ||
    states.length > 0 ||
    ratings.length > 0 ||
    dateFilter !== "any";

  function handleReset() {
    onSearchChange("");
    onFormatsChange([]);
    onStatesChange([]);
    onRatingsChange([]);
    onDateFilterChange("any");
  }

  return (
    <div
      style={{
        background: "var(--color-bg-surface)",
        borderBottom: "1px solid var(--color-border)",
        padding: "16px 0",
      }}
    >
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "0 40px",
        }}
      >
        {/* Search */}
        <input
          type="text"
          placeholder="Search tournaments..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="search-input"
        />

        {/* Filter row */}
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: "10px",
            flexWrap: "wrap",
            marginTop: "12px",
          }}
        >
          <MultiSelectDropdown
            label="Format"
            options={FORMAT_OPTIONS}
            selected={formats}
            onChange={onFormatsChange}
          />
          <MultiSelectDropdown
            label="State"
            options={stateOptions}
            selected={states}
            onChange={onStatesChange}
          />
          <MultiSelectDropdown
            label="Rating"
            options={RATING_OPTIONS}
            selected={ratings}
            onChange={onRatingsChange}
          />

          <select
            value={dateFilter}
            onChange={(e) => onDateFilterChange(e.target.value)}
            className={
              dateFilter !== "any"
                ? "filter-btn filter-btn--active"
                : "filter-btn"
            }
            style={{ appearance: "none", cursor: "pointer" }}
          >
            {DATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <div style={{ flex: 1 }} />

          {hasActiveFilters && (
            <button onClick={handleReset} className="filter-clear-btn">
              Clear filters
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
