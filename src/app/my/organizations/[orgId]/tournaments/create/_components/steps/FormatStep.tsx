"use client";

import { useCallback, useEffect, useId, useState } from "react";
import type { FormatData, Restriction, RestrictionKind } from "../../types";
import { useTournamentWizard } from "../TournamentWizardContext";
import { newRowId } from "../rowId";
import { RESTRICTION_KINDS, RESTRICTION_LABELS } from "../restrictions";
import { CountryDropdown } from "@/components/ui/country-dropdown";
import { nameToAlpha3 } from "@/lib/countries";

const FORMAT_TYPES = ["Rapid", "Blitz", "Classical"];
const SYSTEMS = ["Swiss", "Round Robin", "Knockout"];

type FieldErrors = Partial<
  Record<
    | "formatType"
    | "system"
    | "rounds"
    | "baseTime"
    | "startDate"
    | "endDate"
    | "registrationDeadline"
    | "maxParticipants",
    string
  > & { restrictions: Record<string, string> }
>;

const NO_ERRORS: FieldErrors = {};

function validate(data: FormatData): FieldErrors {
  const errors: FieldErrors = {};

  if (!data.formatType) errors.formatType = "Format type is required.";
  if (!data.system) errors.system = "System is required.";

  if (data.rounds === "") {
    errors.rounds = "Number of rounds is required.";
  } else if (Number(data.rounds) < 1 || Number(data.rounds) > 20) {
    errors.rounds = "Rounds must be between 1 and 20.";
  }

  if (data.baseTime === "") {
    errors.baseTime = "Base time is required.";
  } else if (Number(data.baseTime) < 1) {
    errors.baseTime = "Base time must be at least 1 minute.";
  }

  if (!data.startDate) errors.startDate = "Start date is required.";
  if (!data.endDate) {
    errors.endDate = "End date is required.";
  } else if (data.startDate && data.endDate < data.startDate) {
    errors.endDate = "End date must be on or after the start date.";
  }

  if (!data.registrationDeadline) {
    errors.registrationDeadline = "Registration deadline is required.";
  } else if (
    data.startDate &&
    data.registrationDeadline.slice(0, 10) > data.startDate
  ) {
    errors.registrationDeadline =
      "Registration deadline must be before the start date.";
  }

  if (data.maxParticipants === "") {
    errors.maxParticipants = "Maximum participants is required.";
  } else if (Number(data.maxParticipants) < 2) {
    errors.maxParticipants = "Must allow at least 2 participants.";
  }

  const restrictionErrors: Record<string, string> = {};
  data.restrictions.forEach((r) => {
    if (!r.value.trim()) {
      restrictionErrors[r.id] = "Value is required.";
    }
  });
  if (Object.keys(restrictionErrors).length > 0) {
    errors.restrictions = restrictionErrors;
  }

  return errors;
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-cinzel text-gold-muted border-border mt-6 mb-3 border-t pt-5 text-xs font-bold tracking-widest uppercase">
      {children}
    </h3>
  );
}

export default function FormatStep() {
  const { formatData, setFormatData, goNext, registerStepHandler } =
    useTournamentWizard();

  // WizardShell only mounts steps after the context has hydrated, so the
  // context value is already the restored one here.
  const [form, setForm] = useState<FormatData>(formatData);
  const [showErrors, setShowErrors] = useState(false);
  const uid = useId();

  // Errors are derived from the form — no need to mirror them into state.
  const errors = showErrors ? validate(form) : NO_ERRORS;

  const field = <K extends keyof FormatData>(key: K, value: FormatData[K]) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  const addRestriction = () => {
    const newRow: Restriction = {
      id: newRowId(),
      kind: "max_rating",
      value: "",
    };
    setForm((f) => ({ ...f, restrictions: [...f.restrictions, newRow] }));
  };

  const removeRestriction = (id: string) => {
    setForm((f) => ({
      ...f,
      restrictions: f.restrictions.filter((r) => r.id !== id),
    }));
  };

  const updateRestrictionValue = (id: string, value: string) => {
    setForm((f) => ({
      ...f,
      restrictions: f.restrictions.map((r) =>
        r.id === id ? { ...r, value } : r,
      ),
    }));
  };

  // Changing the kind clears the value — a value entered for one kind (e.g. a
  // rating number) is meaningless for another (e.g. a country), and the
  // Nationality dropdown needs a clean slate rather than stale free text.
  const changeRestrictionKind = (id: string, kind: RestrictionKind) => {
    setForm((f) => ({
      ...f,
      restrictions: f.restrictions.map((r) =>
        r.id === id ? { ...r, kind, value: "" } : r,
      ),
    }));
  };

  const attemptNext = useCallback(async () => {
    setShowErrors(true);
    const fieldErrors = validate(form);
    const hasErrors =
      Object.keys(fieldErrors).filter((k) => k !== "restrictions").length > 0 ||
      Object.keys(fieldErrors.restrictions ?? {}).length > 0;
    if (hasErrors) return;
    setFormatData(form);
    goNext();
  }, [form, setFormatData, goNext]);

  useEffect(() => {
    registerStepHandler(1, attemptNext);
  }, [registerStepHandler, attemptNext]);

  return (
    <div>
      <h2 className="font-cinzel text-text-primary mb-1 text-lg font-bold tracking-wide">
        Format &amp; Schedule
      </h2>
      <p className="font-lato text-text-muted mb-6 text-sm">
        Define the tournament format, time control, and schedule.
      </p>

      {/* Format Type + System */}
      <div className="input-row">
        <div className="form-group">
          <div className="label-row">
            <label htmlFor={`${uid}-format-type`} className="input-label">
              Format Type
            </label>
            <span aria-hidden="true" className="text-danger ml-0.5 text-sm">
              *
            </span>
          </div>
          <select
            id={`${uid}-format-type`}
            className={`input ${showErrors && errors.formatType ? "input-error" : ""}`}
            value={form.formatType}
            onChange={(e) => field("formatType", e.target.value)}
          >
            <option value="">Select format…</option>
            {FORMAT_TYPES.map((t) => (
              <option key={t} value={t}>
                {t}
              </option>
            ))}
          </select>
          {showErrors && errors.formatType && (
            <p className="input-hint error">{errors.formatType}</p>
          )}
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor={`${uid}-system`} className="input-label">
              System
            </label>
            <span aria-hidden="true" className="text-danger ml-0.5 text-sm">
              *
            </span>
          </div>
          <select
            id={`${uid}-system`}
            className={`input ${showErrors && errors.system ? "input-error" : ""}`}
            value={form.system}
            onChange={(e) => field("system", e.target.value)}
          >
            <option value="">Select system…</option>
            {SYSTEMS.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {showErrors && errors.system && (
            <p className="input-hint error">{errors.system}</p>
          )}
        </div>
      </div>

      {/* Number of Rounds */}
      <div className="form-group">
        <div className="label-row">
          <label htmlFor={`${uid}-rounds`} className="input-label">
            Number of Rounds
          </label>
          <span aria-hidden="true" className="text-danger ml-0.5 text-sm">
            *
          </span>
        </div>
        <input
          id={`${uid}-rounds`}
          type="number"
          className={`input w-32 ${showErrors && errors.rounds ? "input-error" : ""}`}
          value={form.rounds === "" ? "" : String(form.rounds)}
          min={1}
          max={20}
          onChange={(e) => {
            const raw = e.target.value;
            field("rounds", raw === "" ? "" : Number(raw));
          }}
        />
        {showErrors && errors.rounds && (
          <p className="input-hint error">{errors.rounds}</p>
        )}
      </div>

      <SectionHeader>Time Control</SectionHeader>

      <div className="input-row">
        <div className="form-group">
          <div className="label-row">
            <label htmlFor={`${uid}-base-time`} className="input-label">
              Base Time (min)
            </label>
            <span aria-hidden="true" className="text-danger ml-0.5 text-sm">
              *
            </span>
          </div>
          <input
            id={`${uid}-base-time`}
            type="number"
            className={`input w-32 ${showErrors && errors.baseTime ? "input-error" : ""}`}
            value={form.baseTime === "" ? "" : String(form.baseTime)}
            min={1}
            onChange={(e) => {
              const raw = e.target.value;
              field("baseTime", raw === "" ? "" : Number(raw));
            }}
          />
          {showErrors && errors.baseTime && (
            <p className="input-hint error">{errors.baseTime}</p>
          )}
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor={`${uid}-increment`} className="input-label">
              Increment (sec)
            </label>
            <span className="label-optional">(optional)</span>
          </div>
          <input
            id={`${uid}-increment`}
            type="number"
            className="input w-32"
            value={form.increment === "" ? "" : String(form.increment)}
            min={0}
            onChange={(e) => {
              const raw = e.target.value;
              field("increment", raw === "" ? "" : Number(raw));
            }}
          />
        </div>
      </div>

      <div className="form-group">
        <div className="label-row">
          <label htmlFor={`${uid}-delay`} className="input-label">
            Delay (sec)
          </label>
          <span className="label-optional">(optional)</span>
        </div>
        <input
          id={`${uid}-delay`}
          type="number"
          className="input w-32"
          value={form.delay === "" ? "" : String(form.delay)}
          min={0}
          onChange={(e) => {
            const raw = e.target.value;
            field("delay", raw === "" ? "" : Number(raw));
          }}
        />
        <p className="input-hint">Most rapid tournaments use increment only.</p>
      </div>

      <SectionHeader>Schedule &amp; Capacity</SectionHeader>

      <div className="input-row">
        <div className="form-group">
          <div className="label-row">
            <label htmlFor={`${uid}-start-date`} className="input-label">
              Start Date
            </label>
            <span aria-hidden="true" className="text-danger ml-0.5 text-sm">
              *
            </span>
          </div>
          <input
            id={`${uid}-start-date`}
            type="date"
            className={`input ${showErrors && errors.startDate ? "input-error" : ""}`}
            value={form.startDate}
            onChange={(e) => field("startDate", e.target.value)}
          />
          {showErrors && errors.startDate && (
            <p className="input-hint error">{errors.startDate}</p>
          )}
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor={`${uid}-end-date`} className="input-label">
              End Date
            </label>
            <span aria-hidden="true" className="text-danger ml-0.5 text-sm">
              *
            </span>
          </div>
          <input
            id={`${uid}-end-date`}
            type="date"
            className={`input ${showErrors && errors.endDate ? "input-error" : ""}`}
            value={form.endDate}
            onChange={(e) => field("endDate", e.target.value)}
          />
          {showErrors && errors.endDate && (
            <p className="input-hint error">{errors.endDate}</p>
          )}
        </div>
      </div>

      <div className="input-row">
        <div className="form-group">
          <div className="label-row">
            <label htmlFor={`${uid}-reg-deadline`} className="input-label">
              Registration Deadline
            </label>
            <span aria-hidden="true" className="text-danger ml-0.5 text-sm">
              *
            </span>
          </div>
          <input
            id={`${uid}-reg-deadline`}
            type="datetime-local"
            className={`input ${showErrors && errors.registrationDeadline ? "input-error" : ""}`}
            value={form.registrationDeadline}
            onChange={(e) => field("registrationDeadline", e.target.value)}
          />
          {showErrors && errors.registrationDeadline && (
            <p className="input-hint error">{errors.registrationDeadline}</p>
          )}
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor={`${uid}-max-participants`} className="input-label">
              Max Participants
            </label>
            <span aria-hidden="true" className="text-danger ml-0.5 text-sm">
              *
            </span>
          </div>
          <input
            id={`${uid}-max-participants`}
            type="number"
            className={`input w-32 ${showErrors && errors.maxParticipants ? "input-error" : ""}`}
            value={
              form.maxParticipants === "" ? "" : String(form.maxParticipants)
            }
            min={2}
            onChange={(e) => {
              const raw = e.target.value;
              field("maxParticipants", raw === "" ? "" : Number(raw));
            }}
          />
          {showErrors && errors.maxParticipants && (
            <p className="input-hint error">{errors.maxParticipants}</p>
          )}
        </div>
      </div>

      <SectionHeader>Rating</SectionHeader>

      <div className="mb-2 flex gap-6">
        <label className="font-lato text-text-body flex cursor-pointer items-center gap-2 text-sm select-none">
          <input
            type="checkbox"
            className="accent-gold-bright h-4 w-4 cursor-pointer"
            checked={form.fideRated}
            onChange={(e) => field("fideRated", e.target.checked)}
          />
          FIDE Rated
        </label>
        <label className="font-lato text-text-body flex cursor-pointer items-center gap-2 text-sm select-none">
          <input
            type="checkbox"
            className="accent-gold-bright h-4 w-4 cursor-pointer"
            checked={form.mcfRated}
            onChange={(e) => field("mcfRated", e.target.checked)}
          />
          MCF Rated
        </label>
      </div>

      <SectionHeader>Restrictions</SectionHeader>

      <p className="font-lato text-text-muted -mt-1 mb-3 text-xs">
        Optional. Leave empty if the tournament is open to all players.
      </p>

      {form.restrictions.length > 0 && (
        <div className="mb-3 flex flex-col gap-2">
          {form.restrictions.map((r) => (
            <div key={r.id} className="flex items-start gap-2">
              <select
                className="input"
                style={{ width: "175px", flexShrink: 0 }}
                value={r.kind}
                onChange={(e) =>
                  changeRestrictionKind(r.id, e.target.value as RestrictionKind)
                }
                aria-label="Restriction type"
              >
                {RESTRICTION_KINDS.map((k) => (
                  <option key={k} value={k}>
                    {RESTRICTION_LABELS[k]}
                  </option>
                ))}
              </select>
              <div className="min-w-0 flex-1">
                {r.kind === "nationality" ? (
                  <CountryDropdown
                    placeholder="Select country"
                    defaultValue={nameToAlpha3(r.value)}
                    onChange={(c) => updateRestrictionValue(r.id, c.name)}
                  />
                ) : r.kind === "gender" ? (
                  <select
                    className={`input ${
                      showErrors && errors.restrictions?.[r.id]
                        ? "input-error"
                        : ""
                    }`}
                    value={r.value}
                    aria-label="Restriction value"
                    onChange={(e) =>
                      updateRestrictionValue(r.id, e.target.value)
                    }
                  >
                    <option value="">Select…</option>
                    <option value="male">Male</option>
                    <option value="female">Female</option>
                  </select>
                ) : (
                  <input
                    type="text"
                    className={`input ${
                      showErrors && errors.restrictions?.[r.id]
                        ? "input-error"
                        : ""
                    }`}
                    placeholder="Value"
                    value={r.value}
                    aria-label="Restriction value"
                    onChange={(e) =>
                      updateRestrictionValue(r.id, e.target.value)
                    }
                  />
                )}
                {showErrors && errors.restrictions?.[r.id] && (
                  <p className="input-hint error">
                    {errors.restrictions[r.id]}
                  </p>
                )}
              </div>
              <button
                type="button"
                aria-label="Remove restriction"
                className="font-lato border-border text-text-muted hover:text-danger hover:border-danger-border flex cursor-pointer items-center justify-center rounded-md border bg-transparent transition duration-200"
                style={{ width: "36px", height: "38px", flexShrink: 0 }}
                onClick={() => removeRestriction(r.id)}
              >
                ×
              </button>
            </div>
          ))}
        </div>
      )}

      <button
        type="button"
        className="font-cinzel border-border text-text-secondary hover:border-gold-muted hover:text-text-primary cursor-pointer rounded-md border bg-transparent px-4 py-2 text-xs font-bold tracking-widest uppercase transition duration-200"
        onClick={addRestriction}
      >
        + Add Restriction
      </button>
    </div>
  );
}
