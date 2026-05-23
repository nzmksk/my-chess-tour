"use client";

import { useState } from "react";
import type {
  PlayerProfile,
  ChessTitle,
  Gender,
} from "@/app/profile/types";

const CHESS_TITLES: ChessTitle[] = [
  "GM",
  "WGM",
  "IM",
  "WIM",
  "FM",
  "WFM",
  "CM",
  "WCM",
];

const GENDERS: { value: Gender; label: string }[] = [
  { value: "male", label: "Male" },
  { value: "female", label: "Female" },
];

type EditForm = {
  date_of_birth: string;
  gender: Gender | "";
  nationality: string;
  is_oku: boolean;
  fide_id: string;
  title: ChessTitle | "";
  mcf_id: string;
  national_rating: string;
};

interface ProfileFieldProps {
  label: string;
  value: string;
}

function ProfileField({ label, value }: ProfileFieldProps) {
  return (
    <div className="flex flex-col gap-0.5 py-3 border-b border-border last:border-b-0">
      <span className="font-cinzel text-xs font-semibold tracking-widest uppercase text-gold-muted">
        {label}
      </span>
      <span className="font-lato text-sm text-text-body">
        {value || "—"}
      </span>
    </div>
  );
}

interface SectionCardProps {
  title: string;
  children: React.ReactNode;
}

function SectionCard({ title, children }: SectionCardProps) {
  return (
    <div className="card p-6">
      <h2 className="font-cinzel text-base font-semibold tracking-wider text-text-primary mb-4 pb-3 border-b border-border">
        {title}
      </h2>
      {children}
    </div>
  );
}

interface Props {
  profile: PlayerProfile;
}

export default function ProfileClient({ profile }: Props) {
  const [editing, setEditing] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saveSuccess, setSaveSuccess] = useState(false);
  const [current, setCurrent] = useState<PlayerProfile>(profile);

  const [form, setForm] = useState<EditForm>({
    date_of_birth: profile.date_of_birth ?? "",
    gender: profile.gender ?? "",
    nationality: profile.nationality ?? "",
    is_oku: profile.is_oku,
    fide_id: profile.fide_id != null ? String(profile.fide_id) : "",
    title: profile.title ?? "",
    mcf_id: profile.mcf_id != null ? String(profile.mcf_id) : "",
    national_rating:
      profile.national_rating != null ? String(profile.national_rating) : "",
  });

  function handleEdit() {
    setEditing(true);
    setSaveError(null);
    setSaveSuccess(false);
  }

  function handleCancel() {
    setEditing(false);
    setSaveError(null);
    setForm({
      date_of_birth: current.date_of_birth ?? "",
      gender: current.gender ?? "",
      nationality: current.nationality ?? "",
      is_oku: current.is_oku,
      fide_id: current.fide_id != null ? String(current.fide_id) : "",
      title: current.title ?? "",
      mcf_id: current.mcf_id != null ? String(current.mcf_id) : "",
      national_rating:
        current.national_rating != null ? String(current.national_rating) : "",
    });
  }

  async function handleSave(e: React.FormEvent) {
    e.preventDefault();
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    const payload: Record<string, unknown> = {
      date_of_birth: form.date_of_birth || null,
      gender: form.gender || null,
      nationality: form.nationality.trim() || null,
      is_oku: form.is_oku,
      fide_id: form.fide_id ? parseInt(form.fide_id, 10) : null,
      title: form.title || null,
      mcf_id: form.mcf_id ? parseInt(form.mcf_id, 10) : null,
      national_rating: form.national_rating
        ? parseInt(form.national_rating, 10)
        : null,
    };

    try {
      const res = await fetch("/api/v1/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setSaveError(data.error?.message ?? "Something went wrong. Please try again.");
        return;
      }

      setCurrent({
        ...current,
        date_of_birth: (payload.date_of_birth as string | null),
        gender: (payload.gender as Gender | null),
        nationality: (payload.nationality as string | null),
        is_oku: payload.is_oku as boolean,
        fide_id: payload.fide_id as number | null,
        title: (payload.title as ChessTitle | null),
        mcf_id: payload.mcf_id as number | null,
        national_rating: payload.national_rating as number | null,
      });

      setSaveSuccess(true);
      setEditing(false);
    } catch {
      setSaveError("Network error. Please try again.");
    } finally {
      setSaving(false);
    }
  }

  const initials =
    `${current.first_name[0] ?? ""}${current.last_name[0] ?? ""}`.toUpperCase() ||
    current.email[0]?.toUpperCase() ||
    "?";

  const fullName = [current.first_name, current.last_name]
    .filter(Boolean)
    .join(" ");

  return (
    <div className="max-w-2xl mx-auto px-6 py-8">
      {/* Header */}
      <div className="flex items-center gap-5 mb-8">
        <div className="bg-gold-ghost border-2 border-gold-muted font-cinzel text-gold-bright flex h-16 w-16 shrink-0 items-center justify-center rounded-full text-xl font-semibold">
          {initials}
        </div>
        <div className="flex-1 min-w-0">
          <h1 className="font-cinzel text-2xl font-bold text-text-primary tracking-wide leading-tight">
            {fullName}
          </h1>
          <p className="font-lato text-sm text-text-muted mt-0.5">
            {current.email}
          </p>
          {current.title && (
            <span className="inline-block mt-1.5 font-cinzel text-xs font-bold tracking-widest uppercase px-2 py-0.5 rounded bg-info-bg text-info border border-info-border">
              {current.title}
            </span>
          )}
        </div>
        {!editing && (
          <button
            onClick={handleEdit}
            className="btn-secondary px-4 py-2 text-xs shrink-0"
          >
            Edit Profile
          </button>
        )}
      </div>

      {saveSuccess && (
        <div className="mb-5 flex items-center gap-2 rounded-md border border-success-border bg-success-bg px-4 py-2.5">
          <span className="text-success text-sm">&#10003;</span>
          <p className="font-lato text-sm text-success">Profile updated successfully.</p>
        </div>
      )}

      {editing ? (
        <form onSubmit={handleSave} noValidate>
          {saveError && (
            <div className="error-banner mb-5" role="alert">
              <span className="text-sm shrink-0 mt-px">&#9888;</span>
              <p className="error-text">{saveError}</p>
            </div>
          )}

          {/* Personal Info */}
          <div className="card p-6 mb-4">
            <h2 className="font-cinzel text-base font-semibold tracking-wider text-text-primary mb-4 pb-3 border-b border-border">
              Personal Information
            </h2>

            {/* Read-only name + email */}
            <div className="mb-4 rounded-md bg-bg-sunken border border-border px-4 py-3">
              <p className="font-cinzel text-xs font-semibold tracking-widest uppercase text-gold-dim mb-1">
                Name &amp; Email
              </p>
              <p className="font-lato text-sm text-text-secondary">
                {fullName} · {current.email}
              </p>
              <p className="font-lato text-xs text-text-muted mt-1">
                Contact support to change your name or email.
              </p>
            </div>

            {/* Date of Birth */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="dob">
                  Date of Birth
                </label>
                <span className="label-optional">(Optional)</span>
              </div>
              <input
                id="dob"
                className="input"
                type="date"
                value={form.date_of_birth}
                onChange={(e) =>
                  setForm((f) => ({ ...f, date_of_birth: e.target.value }))
                }
              />
            </div>

            {/* Gender */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="gender">
                  Gender
                </label>
                <span className="label-optional">(Optional)</span>
              </div>
              <select
                id="gender"
                className="input"
                value={form.gender}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    gender: e.target.value as Gender | "",
                  }))
                }
              >
                <option value="">Select…</option>
                {GENDERS.map(({ value, label }) => (
                  <option key={value} value={value}>
                    {label}
                  </option>
                ))}
              </select>
            </div>

            {/* Nationality */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="nationality">
                  Nationality
                </label>
                <span className="label-optional">(Optional)</span>
              </div>
              <input
                id="nationality"
                className="input"
                type="text"
                placeholder="Malaysian"
                value={form.nationality}
                onChange={(e) =>
                  setForm((f) => ({ ...f, nationality: e.target.value }))
                }
              />
            </div>

            {/* OKU */}
            <div className="check-row mt-2">
              <input
                id="is_oku"
                type="checkbox"
                className="checkbox"
                checked={form.is_oku}
                onChange={(e) =>
                  setForm((f) => ({ ...f, is_oku: e.target.checked }))
                }
              />
              <label className="check-label" htmlFor="is_oku">
                I am an OKU (Orang Kurang Upaya) card holder
              </label>
            </div>
          </div>

          {/* Chess Details */}
          <div className="card p-6 mb-6">
            <h2 className="font-cinzel text-base font-semibold tracking-wider text-text-primary mb-4 pb-3 border-b border-border">
              Chess Details
            </h2>

            {/* Chess Title */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="title">
                  Chess Title
                </label>
                <span className="label-optional">(Optional)</span>
              </div>
              <select
                id="title"
                className="input"
                value={form.title}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    title: e.target.value as ChessTitle | "",
                  }))
                }
              >
                <option value="">No title</option>
                {CHESS_TITLES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </select>
            </div>

            {/* FIDE ID */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="fide_id">
                  FIDE ID
                </label>
                <span className="label-optional">(Optional)</span>
                <span
                  className="help-icon"
                  tabIndex={0}
                  aria-label="FIDE ID help"
                >
                  ?
                  <div className="tooltip" role="tooltip">
                    Your FIDE player ID number. Your standard, rapid, and blitz
                    ratings are stored from when your profile was created.
                  </div>
                </span>
              </div>
              <input
                id="fide_id"
                className="input"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 36095765"
                value={form.fide_id}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    fide_id: e.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </div>

            {/* MCF ID */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="mcf_id">
                  MCF ID
                </label>
                <span className="label-optional">(Optional)</span>
                <span
                  className="help-icon"
                  tabIndex={0}
                  aria-label="MCF ID help"
                >
                  ?
                  <div className="tooltip" role="tooltip">
                    Your Malaysian Chess Federation membership ID. Used for
                    MCF-rated tournaments.
                  </div>
                </span>
              </div>
              <input
                id="mcf_id"
                className="input"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 1234567"
                value={form.mcf_id}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    mcf_id: e.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </div>

            {/* National Rating */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="national_rating">
                  National Rating
                </label>
                <span className="label-optional">(Optional)</span>
              </div>
              <input
                id="national_rating"
                className="input"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 1850"
                value={form.national_rating}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    national_rating: e.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </div>
          </div>

          {/* Actions */}
          <div className="flex flex-col sm:flex-row gap-2">
            <button
              type="button"
              className="btn-secondary w-full"
              onClick={handleCancel}
              disabled={saving}
            >
              Cancel
            </button>
            <button
              type="submit"
              className="btn-primary w-full"
              disabled={saving}
              aria-disabled={saving}
            >
              {saving ? "Saving…" : "Save Changes"}
            </button>
          </div>
        </form>
      ) : (
        <div className="flex flex-col gap-4">
          {/* Personal Info */}
          <SectionCard title="Personal Information">
            <ProfileField label="Full Name" value={fullName} />
            <ProfileField label="Email" value={current.email} />
            <ProfileField
              label="Date of Birth"
              value={
                current.date_of_birth
                  ? new Date(current.date_of_birth + "T00:00:00").toLocaleDateString(
                      "en-MY",
                      { day: "numeric", month: "long", year: "numeric" },
                    )
                  : ""
              }
            />
            <ProfileField
              label="Gender"
              value={
                current.gender
                  ? current.gender.charAt(0).toUpperCase() +
                    current.gender.slice(1)
                  : ""
              }
            />
            <ProfileField
              label="Nationality"
              value={current.nationality ?? ""}
            />
            <ProfileField
              label="OKU Status"
              value={current.is_oku ? "OKU card holder" : "Not applicable"}
            />
          </SectionCard>

          {/* Chess Details */}
          <SectionCard title="Chess Details">
            <ProfileField
              label="Chess Title"
              value={current.title ?? ""}
            />
            <ProfileField
              label="FIDE ID"
              value={current.fide_id != null ? String(current.fide_id) : ""}
            />
            <div className="flex flex-col gap-0.5 py-3 border-b border-border">
              <span className="font-cinzel text-xs font-semibold tracking-widest uppercase text-gold-muted">
                FIDE Rating
              </span>
              {current.fide_rating ? (
                <div className="flex flex-wrap gap-3 mt-1">
                  {current.fide_rating.standard != null && (
                    <div className="flex flex-col items-center bg-bg-raised border border-border rounded-md px-4 py-2 min-w-16">
                      <span className="font-cinzel text-xs tracking-widest uppercase text-text-muted">
                        Std
                      </span>
                      <span className="font-lato text-lg font-semibold text-text-primary">
                        {current.fide_rating.standard}
                      </span>
                    </div>
                  )}
                  {current.fide_rating.rapid != null && (
                    <div className="flex flex-col items-center bg-bg-raised border border-border rounded-md px-4 py-2 min-w-16">
                      <span className="font-cinzel text-xs tracking-widest uppercase text-text-muted">
                        Rpd
                      </span>
                      <span className="font-lato text-lg font-semibold text-text-primary">
                        {current.fide_rating.rapid}
                      </span>
                    </div>
                  )}
                  {current.fide_rating.blitz != null && (
                    <div className="flex flex-col items-center bg-bg-raised border border-border rounded-md px-4 py-2 min-w-16">
                      <span className="font-cinzel text-xs tracking-widest uppercase text-text-muted">
                        Blz
                      </span>
                      <span className="font-lato text-lg font-semibold text-text-primary">
                        {current.fide_rating.blitz}
                      </span>
                    </div>
                  )}
                  {current.fide_rating.standard == null &&
                    current.fide_rating.rapid == null &&
                    current.fide_rating.blitz == null && (
                      <span className="font-lato text-sm text-text-body">—</span>
                    )}
                </div>
              ) : (
                <span className="font-lato text-sm text-text-body">—</span>
              )}
            </div>
            <ProfileField
              label="MCF ID"
              value={current.mcf_id != null ? String(current.mcf_id) : ""}
            />
            <ProfileField
              label="National Rating"
              value={
                current.national_rating != null
                  ? String(current.national_rating)
                  : ""
              }
            />
          </SectionCard>
        </div>
      )}
    </div>
  );
}

