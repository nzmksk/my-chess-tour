"use client";

import { useRef, useState } from "react";
import Image from "next/image";
import type { PlayerProfile, Gender } from "@/app/profile/types";
import { CountryDropdown } from "@/components/ui/country-dropdown";
import { nameToAlpha3 } from "@/lib/countries";
import { createClient } from "@/services/supabase/client";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";

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
  mcf_id: string;
};

interface ProfileFieldProps {
  label: string;
  value: string;
}

function ProfileField({ label, value }: ProfileFieldProps) {
  return (
    <div className="border-border flex flex-col gap-0.5 border-b py-3 last:border-b-0">
      <span className="font-cinzel text-gold-muted text-xs font-semibold tracking-widest uppercase">
        {label}
      </span>
      <span className="font-lato text-text-body text-sm">{value || "—"}</span>
    </div>
  );
}

interface LockedFieldProps {
  label: string;
  value: string;
}

function LockedField({ label, value }: LockedFieldProps) {
  return (
    <div className="bg-bg-sunken border-border mb-4 rounded-md border px-4 py-3">
      <p className="font-cinzel text-gold-dim mb-1 text-xs font-semibold tracking-widest uppercase">
        {label}
      </p>
      <p className="font-lato text-text-secondary text-sm">{value || "—"}</p>
      <p className="font-lato text-text-muted mt-1 text-xs">
        Contact support@mychesstour.com to change.
      </p>
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
      <h2 className="font-cinzel text-text-primary border-border mb-4 border-b pb-3 text-base font-semibold tracking-wider">
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
  const [confirmFields, setConfirmFields] = useState<string[] | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const [form, setForm] = useState<EditForm>({
    date_of_birth: profile.date_of_birth ?? "",
    gender: profile.gender ?? "",
    nationality: profile.nationality ?? "",
    is_oku: profile.is_oku,
    fide_id: profile.fide_id != null ? String(profile.fide_id) : "",
    mcf_id: profile.mcf_id != null ? String(profile.mcf_id) : "",
  });

  // Set-once fields are editable only while still null at load time; once a
  // value exists they are locked (changing requires support). Derived from the
  // original prop so a value set during this session stays consistent.
  const canEditDob = profile.date_of_birth == null;
  const canEditGender = profile.gender == null;
  const canEditNationality = profile.nationality == null;
  const canEditFideId = profile.fide_id == null;
  const canEditMcfId = profile.mcf_id == null;

  function handleEdit() {
    setEditing(true);
    setSaveError(null);
    setSaveSuccess(false);
  }

  function handleAvatarClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setSaveError("Please upload a JPG or PNG image.");
      e.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setSaveError("Image must be under 2 MB.");
      e.target.value = "";
      return;
    }

    setSaveError(null);
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === "string") setAvatarPreview(result);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  function handleCancel() {
    setEditing(false);
    setSaveError(null);
    setAvatarFile(null);
    setAvatarPreview(null);
    setForm({
      date_of_birth: current.date_of_birth ?? "",
      gender: current.gender ?? "",
      nationality: current.nationality ?? "",
      is_oku: current.is_oku,
      fide_id: current.fide_id != null ? String(current.fide_id) : "",
      mcf_id: current.mcf_id != null ? String(current.mcf_id) : "",
    });
  }

  // Set-once fields that the user is about to fill in for the first time —
  // once saved these become locked, so we ask for confirmation first.
  function getLockingFields() {
    const fields: string[] = [];
    if (canEditDob && form.date_of_birth) fields.push("Date of Birth");
    if (canEditGender && form.gender) fields.push("Gender");
    if (canEditNationality && form.nationality.trim())
      fields.push("Nationality");
    if (canEditFideId && form.fide_id) fields.push("FIDE ID");
    if (canEditMcfId && form.mcf_id) fields.push("MCF ID");
    return fields;
  }

  function handleSave(e: React.FormEvent) {
    e.preventDefault();
    const locking = getLockingFields();
    if (locking.length > 0) {
      setConfirmFields(locking);
      return;
    }
    void doSave();
  }

  async function doSave() {
    setConfirmFields(null);
    setSaving(true);
    setSaveError(null);
    setSaveSuccess(false);

    // Only send fields the user is actually allowed to edit: is_oku always,
    // plus each set-once field that was still null at load. title and
    // national_rating are never editable and are never sent.
    const payload: Record<string, unknown> = { is_oku: form.is_oku };
    if (canEditDob) payload.date_of_birth = form.date_of_birth || null;
    if (canEditGender) payload.gender = form.gender || null;
    if (canEditNationality)
      payload.nationality = form.nationality.trim() || null;
    if (canEditFideId)
      payload.fide_id = form.fide_id ? parseInt(form.fide_id, 10) : null;
    if (canEditMcfId)
      payload.mcf_id = form.mcf_id ? parseInt(form.mcf_id, 10) : null;

    let uploadedAvatarUrl: string | null = null;

    try {
      // Upload the new avatar to storage first; its public URL is what the
      // PATCH request persists on the user record.
      if (avatarFile) {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (!user) {
          setSaveError("Your session has expired. Please sign in again.");
          return;
        }

        const ext = avatarFile.name.split(".").pop();
        const path = `users/${user.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, { upsert: true });

        if (uploadError) {
          setSaveError("Failed to upload photo. Please try again.");
          return;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from("avatars").getPublicUrl(path);
        uploadedAvatarUrl = publicUrl;
        payload.avatar_url = publicUrl;
      }

      const res = await fetch("/api/v1/profile", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const data = await res.json();

      if (!res.ok) {
        setSaveError(
          data.error?.message ?? "Something went wrong. Please try again.",
        );
        return;
      }

      setCurrent({
        ...current,
        is_oku: payload.is_oku as boolean,
        ...(canEditDob && {
          date_of_birth: payload.date_of_birth as string | null,
        }),
        ...(canEditGender && { gender: payload.gender as Gender | null }),
        ...(canEditNationality && {
          nationality: payload.nationality as string | null,
        }),
        ...(canEditFideId && { fide_id: payload.fide_id as number | null }),
        ...(canEditMcfId && { mcf_id: payload.mcf_id as number | null }),
        ...(uploadedAvatarUrl !== null && { avatar_url: uploadedAvatarUrl }),
      });

      setAvatarFile(null);
      setAvatarPreview(null);
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
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center gap-5">
        <div className="bg-gold-ghost border-gold-muted font-cinzel text-gold-bright relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 text-xl font-semibold">
          {current.avatar_url ? (
            <Image
              src={current.avatar_url}
              alt={`${fullName || "Profile"} avatar`}
              fill
              unoptimized
              className="object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-cinzel text-text-primary text-2xl leading-tight font-bold tracking-wide">
            {fullName}
          </h1>
          <p className="font-lato text-text-muted mt-0.5 text-sm">
            {current.email}
          </p>
          {current.title && (
            <span className="font-cinzel bg-info-bg text-info border-info-border mt-1.5 inline-block rounded border px-2 py-0.5 text-xs font-bold tracking-widest uppercase">
              {current.title}
            </span>
          )}
        </div>
        {!editing && (
          <button
            onClick={handleEdit}
            className="btn-secondary shrink-0 px-4 py-2 text-xs"
          >
            Edit Profile
          </button>
        )}
      </div>

      {saveSuccess && (
        <div className="border-success-border bg-success-bg mb-5 flex items-center gap-2 rounded-md border px-4 py-2.5">
          <span className="text-success text-sm">&#10003;</span>
          <p className="font-lato text-success text-sm">
            Profile updated successfully.
          </p>
        </div>
      )}

      {editing ? (
        <form onSubmit={handleSave} noValidate>
          {saveError && (
            <div className="error-banner mb-5" role="alert">
              <span className="mt-px shrink-0 text-sm">&#9888;</span>
              <p className="error-text">{saveError}</p>
            </div>
          )}

          {/* Personal Info */}
          <div className="card mb-4 p-6">
            <h2 className="font-cinzel text-text-primary border-border mb-4 border-b pb-3 text-base font-semibold tracking-wider">
              Personal Information
            </h2>

            {/* Avatar upload */}
            <div className="avatar-upload-wrap">
              <div
                className="avatar-preview"
                role="button"
                tabIndex={0}
                aria-label="Upload profile photo"
                onClick={handleAvatarClick}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    handleAvatarClick();
                  }
                }}
              >
                {avatarPreview || current.avatar_url ? (
                  <Image
                    src={avatarPreview ?? current.avatar_url ?? ""}
                    alt="Profile photo preview"
                    fill
                    unoptimized
                    className="rounded-full object-cover"
                  />
                ) : (
                  initials
                )}
                <div className="avatar-overlay">
                  <span className="avatar-overlay-text">
                    {avatarPreview || current.avatar_url ? "Change" : "Upload"}
                    <br />
                    Photo
                  </span>
                </div>
              </div>
              <input
                ref={fileInputRef}
                type="file"
                accept="image/jpeg,image/png"
                className="sr-only"
                onChange={handleFileChange}
                aria-label="Profile photo file input"
              />
              <p className="avatar-hint">JPG or PNG, max 2 MB</p>
            </div>

            {/* Read-only name + email */}
            <div className="bg-bg-sunken border-border mb-4 rounded-md border px-4 py-3">
              <p className="font-cinzel text-gold-dim mb-1 text-xs font-semibold tracking-widest uppercase">
                Name &amp; Email
              </p>
              <p className="font-lato text-text-secondary text-sm">
                {fullName} · {current.email}
              </p>
              <p className="font-lato text-text-muted mt-1 text-xs">
                Contact support@mychesstour.com to change your name or email.
              </p>
            </div>

            {/* Date of Birth */}
            {canEditDob ? (
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
            ) : (
              <LockedField
                label="Date of Birth"
                value={
                  current.date_of_birth
                    ? new Date(
                        current.date_of_birth + "T00:00:00",
                      ).toLocaleDateString("en-MY", {
                        day: "numeric",
                        month: "long",
                        year: "numeric",
                      })
                    : ""
                }
              />
            )}

            {/* Gender */}
            {canEditGender ? (
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
            ) : (
              <LockedField
                label="Gender"
                value={
                  current.gender
                    ? current.gender.charAt(0).toUpperCase() +
                      current.gender.slice(1)
                    : ""
                }
              />
            )}

            {/* Nationality */}
            {canEditNationality ? (
              <div className="form-group">
                <div className="label-row">
                  <label className="input-label" htmlFor="nationality">
                    Nationality
                  </label>
                  <span className="label-optional">(Optional)</span>
                </div>
                <CountryDropdown
                  placeholder="Select country"
                  defaultValue={nameToAlpha3(form.nationality)}
                  onChange={(c) =>
                    setForm((f) => ({ ...f, nationality: c.name }))
                  }
                />
              </div>
            ) : (
              <LockedField
                label="Nationality"
                value={current.nationality ?? ""}
              />
            )}

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
          <div className="card mb-6 p-6">
            <h2 className="font-cinzel text-text-primary border-border mb-4 border-b pb-3 text-base font-semibold tracking-wider">
              Chess Details
            </h2>

            {/* FIDE ID */}
            {canEditFideId ? (
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
                      Your FIDE player ID number. Your standard, rapid, and
                      blitz ratings are stored from when your profile was
                      created.
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
            ) : (
              <LockedField
                label="FIDE ID"
                value={current.fide_id != null ? String(current.fide_id) : ""}
              />
            )}

            {/* MCF ID */}
            {canEditMcfId ? (
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
            ) : (
              <LockedField
                label="MCF ID"
                value={current.mcf_id != null ? String(current.mcf_id) : ""}
              />
            )}
          </div>

          {/* Actions */}
          <div className="flex flex-col gap-2 sm:flex-row">
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
                  ? new Date(
                      current.date_of_birth + "T00:00:00",
                    ).toLocaleDateString("en-MY", {
                      day: "numeric",
                      month: "long",
                      year: "numeric",
                    })
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
            <ProfileField label="Chess Title" value={current.title ?? ""} />
            <ProfileField
              label="FIDE ID"
              value={current.fide_id != null ? String(current.fide_id) : ""}
            />
            <div className="border-border flex flex-col gap-0.5 border-b py-3">
              <span className="font-cinzel text-gold-muted text-xs font-semibold tracking-widest uppercase">
                FIDE Rating
              </span>
              {current.fide_rating ? (
                <div className="mt-1 flex flex-wrap gap-3">
                  {current.fide_rating.standard != null && (
                    <div className="bg-bg-raised border-border flex min-w-16 flex-col items-center rounded-md border px-4 py-2">
                      <span className="font-cinzel text-text-muted text-xs tracking-widest uppercase">
                        Std
                      </span>
                      <span className="font-lato text-text-primary text-lg font-semibold">
                        {current.fide_rating.standard}
                      </span>
                    </div>
                  )}
                  {current.fide_rating.rapid != null && (
                    <div className="bg-bg-raised border-border flex min-w-16 flex-col items-center rounded-md border px-4 py-2">
                      <span className="font-cinzel text-text-muted text-xs tracking-widest uppercase">
                        Rpd
                      </span>
                      <span className="font-lato text-text-primary text-lg font-semibold">
                        {current.fide_rating.rapid}
                      </span>
                    </div>
                  )}
                  {current.fide_rating.blitz != null && (
                    <div className="bg-bg-raised border-border flex min-w-16 flex-col items-center rounded-md border px-4 py-2">
                      <span className="font-cinzel text-text-muted text-xs tracking-widest uppercase">
                        Blz
                      </span>
                      <span className="font-lato text-text-primary text-lg font-semibold">
                        {current.fide_rating.blitz}
                      </span>
                    </div>
                  )}
                  {current.fide_rating.standard == null &&
                    current.fide_rating.rapid == null &&
                    current.fide_rating.blitz == null && (
                      <span className="font-lato text-text-body text-sm">
                        —
                      </span>
                    )}
                </div>
              ) : (
                <span className="font-lato text-text-body text-sm">—</span>
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

      <Dialog
        open={confirmFields !== null}
        onOpenChange={(open) => {
          if (!open) setConfirmFields(null);
        }}
      >
        <DialogContent className="bg-bg-raised border-border">
          <DialogHeader>
            <DialogTitle className="font-cinzel text-text-primary">
              Confirm your details
            </DialogTitle>
            <DialogDescription className="font-lato text-text-secondary">
              The following can only be set ONCE. After saving, you won&apos;t
              be able to change them again - you&apos;ll need to contact
              support.
            </DialogDescription>
          </DialogHeader>
          <ul className="font-lato text-text-body list-disc space-y-1 pl-5 text-sm">
            {confirmFields?.map((field) => (
              <li key={field}>{field}</li>
            ))}
          </ul>
          <DialogFooter>
            <button
              type="button"
              className="btn-secondary w-full sm:w-auto"
              onClick={() => setConfirmFields(null)}
            >
              Go back
            </button>
            <button
              type="button"
              className="btn-primary w-full sm:w-auto"
              onClick={() => void doSave()}
            >
              Confirm &amp; Save
            </button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}
