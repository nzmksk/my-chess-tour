"use client";

import { useEffect, useRef, useState } from "react";
import { CountryDropdown } from "@/components/ui/country-dropdown";
import { formatCalendarDate } from "@/lib/tournaments/datetime";
import {
  CONTACT_EMAIL_RE,
  RELATIONSHIP_LABELS,
} from "@/lib/guardianship/dependent-options";
import type { DependentView } from "@/services/guardianship/dependents";
import {
  revokeDependent,
  updateDependent,
  type RevokeResult,
} from "./dependents-api";

type Mode = "view" | "edit" | "remove";

function fullName(dependent: DependentView): string {
  return `${dependent.first_name} ${dependent.last_name}`;
}

function genderLabel(gender: DependentView["gender"]): string {
  return gender ? gender.charAt(0).toUpperCase() + gender.slice(1) : "";
}

function Detail({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="font-cinzel text-gold-muted text-xs font-semibold tracking-widest uppercase">
        {label}
      </dt>
      <dd className="font-lato text-text-body text-sm">
        {value || <span className="text-text-disabled">Not set</span>}
      </dd>
    </div>
  );
}

function LockedValue({ label, value }: { label: string; value: string }) {
  return (
    <div className="form-group">
      <p className="input-label mb-1.5">{label}</p>
      <p className="font-lato text-text-body text-sm">{value}</p>
      <p className="input-hint">Contact support to change.</p>
    </div>
  );
}

function parseId(value: string): number | null | "invalid" {
  const trimmed = value.trim();
  if (!trimmed) return null;
  return /^\d{1,10}$/.test(trimmed) && Number(trimmed) > 0
    ? Number(trimmed)
    : "invalid";
}

function EditForm({
  dependent,
  onSaved,
  onCancel,
}: {
  dependent: DependentView;
  onSaved: (updated: DependentView) => void;
  onCancel: () => void;
}) {
  const [gender, setGender] = useState("");
  const [nationality, setNationality] = useState("");
  const [fideId, setFideId] = useState("");
  const [mcfId, setMcfId] = useState("");
  const [contactEmail, setContactEmail] = useState(
    dependent.contact_email ?? "",
  );
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const firstFieldRef = useRef<HTMLHeadingElement>(null);
  const name = fullName(dependent);
  const adultWithoutLogin =
    dependent.account_type === "managed" && dependent.basis !== "minor";

  useEffect(() => {
    firstFieldRef.current?.focus();
  }, []);

  function buildBody(): Record<string, unknown> | string {
    const body: Record<string, unknown> = {};
    if (dependent.gender == null && gender) body.gender = gender;
    if (dependent.nationality == null && nationality)
      body.nationality = nationality;
    for (const [key, raw, label] of [
      ["fide_id", fideId, "FIDE ID"],
      ["mcf_id", mcfId, "MCF ID"],
    ] as const) {
      if (dependent[key] != null) continue;
      const parsed = parseId(raw);
      if (parsed === "invalid") return `The ${label} must be a number.`;
      if (parsed !== null) body[key] = parsed;
    }
    if (adultWithoutLogin) {
      const email = contactEmail.trim().toLowerCase();
      if (email && !CONTACT_EMAIL_RE.test(email)) {
        return "Enter a valid email address, or leave it empty.";
      }
      if (email !== (dependent.contact_email ?? "")) {
        body.contact_email = email || null;
      }
    }
    return body;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const body = buildBody();
    if (typeof body === "string") {
      setError(body);
      return;
    }
    if (Object.keys(body).length === 0) {
      onCancel();
      return;
    }
    setSaving(true);
    setError(null);
    const result = await updateDependent(dependent.id, body);
    setSaving(false);
    if (result.ok) onSaved(result.data);
    else setError(result.error);
  }

  const idPrefix = `dep-${dependent.id}`;

  return (
    <form onSubmit={handleSubmit} noValidate className="mt-4">
      <h4
        ref={firstFieldRef}
        tabIndex={-1}
        className="font-cinzel text-text-secondary mb-3 text-sm font-semibold tracking-wider outline-none"
      >
        Edit {name}
      </h4>
      {error && (
        <div className="error-banner" role="alert">
          <p className="error-text">{error}</p>
        </div>
      )}
      <p className="font-lato text-text-muted mb-4 text-xs">
        Each detail can be set once. To correct one that is already set, contact
        support.
      </p>

      <div className="input-row">
        {dependent.gender == null ? (
          <div className="form-group">
            <label
              className="input-label mb-1.5 block"
              htmlFor={`${idPrefix}-gender`}
            >
              Gender
            </label>
            <select
              id={`${idPrefix}-gender`}
              className="input"
              value={gender}
              onChange={(e) => setGender(e.target.value)}
            >
              <option value="">Select…</option>
              <option value="male">Male</option>
              <option value="female">Female</option>
            </select>
          </div>
        ) : (
          <LockedValue label="Gender" value={genderLabel(dependent.gender)} />
        )}

        {dependent.nationality == null ? (
          <div className="form-group">
            <label
              className="input-label mb-1.5 block"
              htmlFor={`${idPrefix}-nationality`}
            >
              Nationality
            </label>
            <CountryDropdown
              id={`${idPrefix}-nationality`}
              placeholder="Select country"
              onChange={(c) => setNationality(c.name)}
            />
          </div>
        ) : (
          <LockedValue label="Nationality" value={dependent.nationality} />
        )}
      </div>

      <div className="input-row">
        {dependent.fide_id == null ? (
          <div className="form-group">
            <label
              className="input-label mb-1.5 block"
              htmlFor={`${idPrefix}-fide`}
            >
              FIDE ID
            </label>
            <input
              id={`${idPrefix}-fide`}
              className="input"
              inputMode="numeric"
              value={fideId}
              onChange={(e) => setFideId(e.target.value)}
            />
          </div>
        ) : (
          <LockedValue label="FIDE ID" value={String(dependent.fide_id)} />
        )}

        {dependent.mcf_id == null ? (
          <div className="form-group">
            <label
              className="input-label mb-1.5 block"
              htmlFor={`${idPrefix}-mcf`}
            >
              MCF ID
            </label>
            <input
              id={`${idPrefix}-mcf`}
              className="input"
              inputMode="numeric"
              value={mcfId}
              onChange={(e) => setMcfId(e.target.value)}
            />
          </div>
        ) : (
          <LockedValue label="MCF ID" value={String(dependent.mcf_id)} />
        )}
      </div>

      {adultWithoutLogin && (
        <div className="form-group">
          <label
            className="input-label mb-1.5 block"
            htmlFor={`${idPrefix}-contact-email`}
          >
            Their email
          </label>
          <input
            id={`${idPrefix}-contact-email`}
            type="email"
            className="input"
            value={contactEmail}
            onChange={(e) => setContactEmail(e.target.value)}
            autoComplete="off"
            aria-describedby={`${idPrefix}-contact-email-hint`}
          />
          <p id={`${idPrefix}-contact-email-hint`} className="input-hint">
            Optional. We copy them on emails about their entries. Leave it empty
            to stop.
          </p>
        </div>
      )}

      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          className="btn-secondary px-6"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        <button
          type="submit"
          className="btn-primary px-6 sm:w-fit"
          disabled={saving}
        >
          {saving ? "Saving…" : "Save Changes"}
        </button>
      </div>
    </form>
  );
}

function RemovePanel({
  dependent,
  onRemoved,
  onCancel,
}: {
  dependent: DependentView;
  onRemoved: (result: RevokeResult) => void;
  onCancel: () => void;
}) {
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const promptRef = useRef<HTMLParagraphElement>(null);
  const name = fullName(dependent);

  useEffect(() => {
    promptRef.current?.focus();
  }, []);

  async function confirm() {
    setBusy(true);
    setError(null);
    const result = await revokeDependent(dependent.id);
    setBusy(false);
    if (result.ok) onRemoved(result.data);
    else setError(result.error);
  }

  return (
    <div className="border-border mt-4 border-t pt-4">
      <p
        ref={promptRef}
        tabIndex={-1}
        className="font-lato text-text-secondary mb-3 text-sm outline-none"
      >
        Remove {name} from your account? You will no longer be able to register
        them or edit their profile. Their registrations and payment history stay
        as they are.
      </p>
      {error && (
        <div className="error-banner" role="alert">
          <p className="error-text">{error}</p>
        </div>
      )}
      <div className="flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          className="btn-secondary px-6"
          onClick={onCancel}
          disabled={busy}
        >
          Keep {dependent.first_name}
        </button>
        <button
          type="button"
          className="btn-danger px-6 sm:w-fit"
          onClick={confirm}
          disabled={busy}
        >
          {busy ? "Removing…" : "Remove Dependent"}
        </button>
      </div>
    </div>
  );
}

export default function DependentCard({
  dependent,
  onUpdated,
  onRemoved,
}: {
  dependent: DependentView;
  onUpdated: (updated: DependentView) => void;
  onRemoved: (dependent: DependentView, result: RevokeResult) => void;
}) {
  const [mode, setMode] = useState<Mode>("view");
  const editButtonRef = useRef<HTMLButtonElement>(null);
  const name = fullName(dependent);
  const isMinor = dependent.basis === "minor";

  const returnFocus = useRef(false);

  useEffect(() => {
    if (mode === "view" && returnFocus.current) {
      returnFocus.current = false;
      editButtonRef.current?.focus();
    }
  }, [mode]);

  function backToView() {
    returnFocus.current = true;
    setMode("view");
  }

  return (
    <li className="card p-6">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3
            id={`dep-${dependent.id}-name`}
            className="font-cinzel text-text-primary text-base font-semibold tracking-wide"
          >
            {name}
          </h3>
          <p className="font-lato text-text-muted mt-0.5 text-xs">
            {RELATIONSHIP_LABELS[dependent.relationship]} ·{" "}
            {isMinor ? "Under 18" : "Adult, with their permission"}
          </p>
        </div>
        {mode === "view" && (
          <div className="flex gap-4">
            <button
              ref={editButtonRef}
              type="button"
              className="font-lato text-gold-muted hover:text-gold-bright text-sm underline"
              onClick={() => setMode("edit")}
              aria-label={`Edit ${name}`}
            >
              Edit
            </button>
            <button
              type="button"
              className="font-lato text-text-muted hover:text-danger text-sm underline"
              onClick={() => setMode("remove")}
              aria-label={`Remove ${name}`}
            >
              Remove
            </button>
          </div>
        )}
      </div>

      {mode !== "edit" && (
        <dl className="mt-4 grid grid-cols-1 gap-3 sm:grid-cols-2">
          <Detail
            label="Date of birth"
            value={
              dependent.date_of_birth
                ? formatCalendarDate(dependent.date_of_birth)
                : ""
            }
          />
          <Detail label="Gender" value={genderLabel(dependent.gender)} />
          <Detail label="Nationality" value={dependent.nationality ?? ""} />
          <Detail
            label="FIDE ID"
            value={dependent.fide_id != null ? String(dependent.fide_id) : ""}
          />
          <Detail
            label="MCF ID"
            value={dependent.mcf_id != null ? String(dependent.mcf_id) : ""}
          />
          {!isMinor && (
            <Detail label="Their email" value={dependent.contact_email ?? ""} />
          )}
        </dl>
      )}

      {mode === "edit" && (
        <EditForm
          dependent={dependent}
          onSaved={(updated) => {
            onUpdated(updated);
            backToView();
          }}
          onCancel={backToView}
        />
      )}

      {mode === "remove" && (
        <RemovePanel
          dependent={dependent}
          onRemoved={(result) => onRemoved(dependent, result)}
          onCancel={backToView}
        />
      )}
    </li>
  );
}
