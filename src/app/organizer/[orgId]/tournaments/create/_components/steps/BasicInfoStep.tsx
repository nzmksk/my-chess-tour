"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BasicInfoData } from "../TournamentWizardContext";
import { useTournamentWizard } from "../TournamentWizardContext";

const MALAYSIAN_STATES = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Pulau Pinang",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
  "W.P. Kuala Lumpur",
  "W.P. Labuan",
  "W.P. Putrajaya",
];

type NameStatus = "idle" | "checking" | "available" | "taken" | "error";

type FieldErrors = {
  name?: string;
  venueName?: string;
  venueState?: string;
  venueAddress?: string;
};

async function checkNameAvailability(name: string, excludeId?: string | null): Promise<NameStatus> {
  try {
    const url = new URL("/api/v1/tournaments/name-check", window.location.origin);
    url.searchParams.set("name", name);
    if (excludeId) url.searchParams.set("excludeId", excludeId);
    const res = await fetch(url.toString());
    if (!res.ok) return "error";
    const json = await res.json();
    return json.available ? "available" : "taken";
  } catch {
    return "error";
  }
}

function validate(
  data: BasicInfoData,
  nameStatus: NameStatus,
): FieldErrors {
  const errors: FieldErrors = {};

  if (!data.name.trim()) {
    errors.name = "Tournament name is required.";
  } else if (nameStatus === "taken") {
    errors.name = "A tournament with this name already exists.";
  } else if (nameStatus === "error") {
    errors.name = "Could not verify name uniqueness. Please try again.";
  }

  if (!data.venueName.trim()) {
    errors.venueName = "Venue name is required.";
  }
  if (!data.venueState) {
    errors.venueState = "State is required.";
  }
  if (!data.venueAddress.trim()) {
    errors.venueAddress = "Venue address is required.";
  }

  return errors;
}

export default function BasicInfoStep() {
  const { setBasicInfoData, basicInfoData, goNext, registerStepHandler, excludeId, isHydrated } =
    useTournamentWizard();

  const [form, setForm] = useState<BasicInfoData>(basicInfoData);

  useEffect(() => {
    if (isHydrated) setForm(basicInfoData);
    // intentionally runs once when context finishes hydrating
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);
  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const nameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const handleNameChange = (value: string) => {
    setForm((f) => ({ ...f, name: value }));
    setNameStatus("idle");

    if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current);

    if (!value.trim()) return;

    nameCheckTimer.current = setTimeout(async () => {
      setNameStatus("checking");
      const status = await checkNameAvailability(value.trim(), excludeId);
      setNameStatus(status);
    }, 600);
  };

  const attemptNext = useCallback(async () => {
    setShowErrors(true);

    let currentNameStatus = nameStatus;

    if (form.name.trim() && (nameStatus === "idle" || nameStatus === "checking")) {
      setNameStatus("checking");
      currentNameStatus = await checkNameAvailability(form.name.trim(), excludeId);
      setNameStatus(currentNameStatus);
    }

    const fieldErrors = validate(form, currentNameStatus);
    setErrors((e) => ({ ...e, ...fieldErrors }));

    if (Object.keys(fieldErrors).length > 0) return;

    setBasicInfoData(form);
    goNext();
  }, [form, nameStatus, setBasicInfoData, goNext]);

  useEffect(() => {
    registerStepHandler(0, attemptNext);
  }, [registerStepHandler, attemptNext]);

  useEffect(() => {
    if (showErrors) {
      setErrors(validate(form, nameStatus));
    }
  }, [form, nameStatus, showErrors]);

  const field = (key: keyof BasicInfoData, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <div>
      <h2 className="font-cinzel mb-1 text-lg font-bold text-text-primary tracking-wide">
        Basic Information
      </h2>
      <p className="font-lato mb-6 text-sm text-text-muted">
        Tell players what your tournament is about and where it&apos;s held.
      </p>

      {/* Tournament Name */}
      <div className="form-group">
        <div className="label-row">
          <label htmlFor="tournament-name" className="input-label">
            Tournament Name
          </label>
          <span aria-hidden="true" className="text-danger text-sm ml-0.5">*</span>
        </div>
        <div className="relative">
          <input
            id="tournament-name"
            type="text"
            className={`input pr-8 ${showErrors && errors.name ? "input-error" : ""}`}
            placeholder="e.g., KL Open Rapid Championship 2026"
            value={form.name}
            onChange={(e) => handleNameChange(e.target.value)}
            maxLength={255}
            autoComplete="off"
          />
          {nameStatus === "checking" && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs">
              …
            </span>
          )}
          {nameStatus === "available" && form.name.trim() && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-success text-sm">
              ✓
            </span>
          )}
        </div>
        {showErrors && errors.name && (
          <p className="input-hint error">{errors.name}</p>
        )}
        {nameStatus === "available" && form.name.trim() && !errors.name && (
          <p className="input-hint" style={{ color: "var(--color-success)" }}>
            Name is available.
          </p>
        )}
      </div>

      {/* Description */}
      <div className="form-group">
        <div className="label-row">
          <label htmlFor="tournament-description" className="input-label">
            Description
          </label>
          <span className="label-optional">(optional)</span>
        </div>
        <textarea
          id="tournament-description"
          className="input min-h-24 resize-y"
          placeholder="Full description, rules, what to bring, parking info, etc."
          value={form.description}
          onChange={(e) => field("description", e.target.value)}
          rows={3}
        />
      </div>

      {/* Venue Name + State row */}
      <div className="input-row">
        <div className="form-group">
          <div className="label-row">
            <label htmlFor="venue-name" className="input-label">
              Venue Name
            </label>
            <span aria-hidden="true" className="text-danger text-sm ml-0.5">*</span>
          </div>
          <input
            id="venue-name"
            type="text"
            className={`input ${showErrors && errors.venueName ? "input-error" : ""}`}
            placeholder="e.g., Dewan Bandaraya KL"
            value={form.venueName}
            onChange={(e) => field("venueName", e.target.value)}
            maxLength={255}
          />
          {showErrors && errors.venueName && (
            <p className="input-hint error">{errors.venueName}</p>
          )}
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor="venue-state" className="input-label">
              State
            </label>
            <span aria-hidden="true" className="text-danger text-sm ml-0.5">*</span>
          </div>
          <select
            id="venue-state"
            className={`input ${showErrors && errors.venueState ? "input-error" : ""}`}
            value={form.venueState}
            onChange={(e) => field("venueState", e.target.value)}
          >
            <option value="">Select state…</option>
            {MALAYSIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {showErrors && errors.venueState && (
            <p className="input-hint error">{errors.venueState}</p>
          )}
        </div>
      </div>

      {/* Venue Address */}
      <div className="form-group">
        <div className="label-row">
          <label htmlFor="venue-address" className="input-label">
            Venue Address
          </label>
          <span aria-hidden="true" className="text-danger text-sm ml-0.5">*</span>
        </div>
        <input
          id="venue-address"
          type="text"
          className={`input ${showErrors && errors.venueAddress ? "input-error" : ""}`}
          placeholder="Full address"
          value={form.venueAddress}
          onChange={(e) => field("venueAddress", e.target.value)}
        />
        {showErrors && errors.venueAddress && (
          <p className="input-hint error">{errors.venueAddress}</p>
        )}
      </div>
    </div>
  );
}
