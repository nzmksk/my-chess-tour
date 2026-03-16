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
        : [...selected, value],
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
    <div ref={ref} className="relative">
      <button
        onClick={() => setOpen(!open)}
        className={
          hasSelection ? "filter-btn filter-btn--active" : "filter-btn"
        }
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
                className="accent-(--color-gold-bright) size-3.75 shrink-0"
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
    <div className="bg-(--color-bg-surface) border-b border-(--color-border) py-4">
      <div className="max-w-300 mx-auto px-10">
        {/* Search */}
        <input
          type="text"
          placeholder="Search tournaments..."
          value={search}
          onChange={(e) => onSearchChange(e.target.value)}
          className="search-input"
        />

        {/* Filter row */}
        <div className="flex items-center gap-2.5 flex-wrap mt-3">
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
          >
            {DATE_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>

          <div className="flex-1" />

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
