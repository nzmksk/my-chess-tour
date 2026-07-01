"use client";

import { useState } from "react";
import { calculateAge } from "@/app/tournaments/utils";
import { CountryDropdown } from "@/components/ui/country-dropdown";
import type { PlayerProfile } from "../types";

/** Self-serviceable profile fields the registration prompt can collect inline. */
export type CompletableField =
  | "date_of_birth"
  | "gender"
  | "fide_id"
  | "mcf_id"
  | "nationality";

const FIELD_LABELS: Record<CompletableField, string> = {
  date_of_birth: "Date of Birth",
  gender: "Gender",
  fide_id: "FIDE ID",
  mcf_id: "MCF ID",
  nationality: "Nationality",
};

const inputClass =
  "border-border bg-bg-raised font-lato text-text-primary focus:border-gold-bright w-full rounded-md border px-3 py-2.5 text-sm transition-colors focus:outline-none";

interface Props {
  missing: CompletableField[];
  /** Receives the saved values so the parent can merge them into its profile. */
  onSaved: (updated: Partial<PlayerProfile>) => void;
}

export default function CompleteProfilePrompt({ missing, onSaved }: Props) {
  const [gender, setGender] = useState("");
  const [dob, setDob] = useState("");
  const [fideId, setFideId] = useState("");
  const [mcfId, setMcfId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const needs = (f: CompletableField) => missing.includes(f);
  const hasIdField = needs("fide_id") || needs("mcf_id");

  function validate(): string | null {
    if (needs("gender") && gender !== "male" && gender !== "female") {
      return "Please select your gender.";
    }
    if (needs("date_of_birth")) {
      if (!/^\d{4}-\d{2}-\d{2}$/.test(dob)) {
        return "Please enter a valid date of birth.";
      }
      const d = new Date(dob);
      const now = new Date();
      if (Number.isNaN(d.getTime()) || d > now) {
        return "Date of birth cannot be in the future.";
      }
      if (calculateAge(d, now) > 120) {
        return "Please enter a valid date of birth.";
      }
    }
    if (needs("fide_id") && !/^\d+$/.test(fideId)) {
      return "FIDE ID must contain digits only.";
    }
    if (needs("mcf_id") && !/^\d+$/.test(mcfId)) {
      return "MCF ID must contain digits only.";
    }
    return null;
  }

  async function handleSave() {
    const validationError = validate();
    if (validationError) {
      setError(validationError);
      return;
    }
    setSaving(true);
    setError(null);

    // Send only the fields being completed; the PATCH endpoint enforces set-once,
    // so these null→value writes are accepted exactly once.
    const payload: Record<string, unknown> = {};
    const updated: Partial<PlayerProfile> = {};
    if (needs("gender")) {
      payload.gender = gender;
      updated.gender = gender as "male" | "female";
    }
    if (needs("date_of_birth")) {
      payload.date_of_birth = dob;
      updated.date_of_birth = dob;
    }
    if (needs("fide_id")) {
      const n = parseInt(fideId, 10);
      payload.fide_id = n;
      updated.fide_id = n;
    }
    if (needs("mcf_id")) {
      const n = parseInt(mcfId, 10);
      payload.mcf_id = n;
      updated.mcf_id = n;
    }

    try {
      const res = await fetch("/api/v1/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const json = await res.json();
      if (!res.ok) {
        setError(json.error?.message ?? "Failed to save. Please try again.");
        return;
      }
      onSaved(updated);
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="card card--featured flex flex-col gap-3 p-6">
      <p className="font-cinzel text-text-muted text-xs font-semibold tracking-widest uppercase">
        A few details are needed for this tournament
      </p>

      {needs("gender") && (
        <label className="flex flex-col gap-1">
          <span className="font-lato text-text-secondary text-sm">
            {FIELD_LABELS.gender}
          </span>
          <select
            value={gender}
            onChange={(e) => setGender(e.target.value)}
            className={`${inputClass} cursor-pointer appearance-none`}
          >
            <option value="">Select…</option>
            <option value="male">Male</option>
            <option value="female">Female</option>
          </select>
        </label>
      )}

      {needs("date_of_birth") && (
        <label className="flex flex-col gap-1">
          <span className="font-lato text-text-secondary text-sm">
            {FIELD_LABELS.date_of_birth}
          </span>
          <input
            type="date"
            value={dob}
            onChange={(e) => setDob(e.target.value)}
            className={inputClass}
          />
        </label>
      )}

      {needs("fide_id") && (
        <label className="flex flex-col gap-1">
          <span className="font-lato text-text-secondary text-sm">
            {FIELD_LABELS.fide_id}
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={fideId}
            onChange={(e) =>
              setFideId(e.target.value.replace(/\D/g, "").slice(0, 10))
            }
            placeholder="e.g. 5834567"
            className={inputClass}
          />
        </label>
      )}

      {needs("mcf_id") && (
        <label className="flex flex-col gap-1">
          <span className="font-lato text-text-secondary text-sm">
            {FIELD_LABELS.mcf_id}
          </span>
          <input
            type="text"
            inputMode="numeric"
            value={mcfId}
            onChange={(e) =>
              setMcfId(e.target.value.replace(/\D/g, "").slice(0, 10))
            }
            placeholder="e.g. 12345"
            className={inputClass}
          />
        </label>
      )}

      {hasIdField && (
        <p className="font-lato text-text-muted text-xs">
          These IDs can only be set once — contact support if you need to change
          them later.
        </p>
      )}

      {error && <p className="font-lato text-sm text-red-400">{error}</p>}

      <button
        type="button"
        onClick={handleSave}
        disabled={saving}
        className="btn-primary w-full rounded-md"
      >
        {saving ? "Saving…" : "Save & Continue"}
      </button>
    </div>
  );
}
