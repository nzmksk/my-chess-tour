"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";
import StepTracker from "./StepTracker";
import { useSignUpForm } from "./SignUpContext";
import { createClient } from "@/services/supabase/client";

const GENDERS = ["Male", "Female"] as const;

export default function ProfileForm() {
  const { form, setForm, clearForm } = useSignUpForm();
  const router = useRouter();
  const avatarInitials =
    `${form.firstName[0]}${form.lastName[0]}`.toUpperCase() || "CT";
  // Date-of-birth bounds for the native picker (UTC date string, so it matches
  // between server and client render). Server-side validation is authoritative.
  const maxDob = new Date().toISOString().slice(0, 10);
  const minDob = `${new Date().getUTCFullYear() - 120}-01-01`;
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [avatarPreview, setAvatarPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

  function handleAvatarClick() {
    fileInputRef.current?.click();
  }

  function handleFileChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (!file) return;

    if (!["image/jpeg", "image/png"].includes(file.type)) {
      setSubmitError("Please upload a JPG or PNG image.");
      e.target.value = "";
      return;
    }
    if (file.size > 2 * 1024 * 1024) {
      setSubmitError("Image must be under 2 MB.");
      e.target.value = "";
      return;
    }

    setSubmitError(null);
    setAvatarFile(file);
    const reader = new FileReader();
    reader.onload = (ev) => {
      const result = ev.target?.result;
      if (typeof result === "string") setAvatarPreview(result);
    };
    reader.readAsDataURL(file);
    e.target.value = "";
  }

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);
    setIsSubmitting(true);

    try {
      let avatarUrl: string | undefined;

      if (avatarFile) {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();

        if (user) {
          const ext = avatarFile.name.split(".").pop();
          const path = `users/${user.id}/${Date.now()}.${ext}`;
          const { error: uploadError } = await supabase.storage
            .from("avatars")
            .upload(path, avatarFile, { upsert: true });

          if (uploadError) {
            setSubmitError("Failed to upload photo. Please try again.");
            return;
          }

          const {
            data: { publicUrl },
          } = supabase.storage.from("avatars").getPublicUrl(path);
          avatarUrl = publicUrl;
        }
      }

      const res = await fetch("/api/v1/auth/signup/complete-profile", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          gender: form.gender,
          nationality: form.nationality,
          dateOfBirth: form.dateOfBirth,
          fideId: form.fideId,
          mcfId: form.mcfId,
          isOku: form.isOku,
          ...(avatarUrl ? { avatarUrl } : {}),
        }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSubmitError(
          data.error?.message ?? "Something went wrong. Please try again.",
        );
        return;
      }

      clearForm();
      router.push("/tournaments");
    } catch {
      setSubmitError("Network error. Please try again.");
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleSkip() {
    clearForm();
    router.push("/tournaments");
  }

  return (
    <div className="auth-page">
      <div className="centered-col">
        <div className="auth-card card card--featured">
          <StepTracker
            steps={[
              { label: "Account", state: "done" },
              { label: "Verify", state: "done" },
              { label: "Profile", state: "current" },
            ]}
          />

          <div className="auth-card-header">
            <h1 className="auth-heading">Player Profile</h1>
            <p className="auth-subheading">
              Help us set up your chess identity
            </p>
            <hr className="divider-gold" />
          </div>

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
              {avatarPreview ? (
                <Image
                  src={avatarPreview}
                  alt="Profile photo preview"
                  fill
                  unoptimized
                  className="rounded-full object-cover"
                />
              ) : (
                avatarInitials
              )}
              <div className="avatar-overlay">
                <span className="avatar-overlay-text">
                  {avatarPreview ? "Change" : "Upload"}
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
            <p className="avatar-hint">Tap to upload a profile photo</p>
            <p className="avatar-hint">JPG or PNG, max 2 MB</p>
          </div>

          {submitError && (
            <div className="error-banner" role="alert">
              <span className="mt-px shrink-0 text-sm">&#9888;</span>
              <p className="error-text">{submitError}</p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {/* Gender */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="gender">
                  Gender
                </label>
              </div>
              <select
                id="gender"
                className="input"
                value={form.gender ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, gender: e.target.value }))
                }
              >
                <option value="">Select…</option>
                {GENDERS.map((g) => (
                  <option key={g} value={g}>
                    {g}
                  </option>
                ))}
              </select>
            </div>

            {/* Date of Birth */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="dateOfBirth">
                  Date of Birth
                </label>
              </div>
              <input
                id="dateOfBirth"
                className="input"
                type="date"
                placeholder="DD / MM / YYYY"
                value={form.dateOfBirth ?? ""}
                min={minDob}
                max={maxDob}
                onChange={(e) =>
                  setForm((f) => ({ ...f, dateOfBirth: e.target.value }))
                }
              />
            </div>

            {/* Nationality */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="nationality">
                  Nationality
                </label>
              </div>
              <input
                id="nationality"
                className="input"
                type="text"
                placeholder="Malaysian"
                value={form.nationality ?? ""}
                onChange={(e) =>
                  setForm((f) => ({ ...f, nationality: e.target.value }))
                }
              />
            </div>

            {/* FIDE ID */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="fideId">
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
                    Your FIDE player ID number. Once entered, your current
                    standard, rapid, and blitz ratings will be fetched
                    automatically.
                  </div>
                </span>
              </div>
              <input
                id="fideId"
                className="input"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 36095765"
                value={form.fideId ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    fideId: e.target.value.replace(/\D/g, ""),
                  }))
                }
              />
              <p className="input-hint">
                Ratings will be auto-fetched from FIDE&apos;s database
              </p>
            </div>

            {/* MCF ID */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="mcfId">
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
                id="mcfId"
                className="input"
                type="text"
                inputMode="numeric"
                placeholder="e.g. 1234567"
                value={form.mcfId ?? ""}
                onChange={(e) =>
                  setForm((f) => ({
                    ...f,
                    mcfId: e.target.value.replace(/\D/g, ""),
                  }))
                }
              />
            </div>

            {/* OKU checkbox */}
            <div className="check-row">
              <input
                id="oku"
                type="checkbox"
                className="checkbox"
                checked={form.isOku ?? false}
                onChange={(e) =>
                  setForm((f) => ({ ...f, isOku: e.target.checked }))
                }
              />
              <label className="check-label" htmlFor="oku">
                I am an OKU (Orang Kurang Upaya) card holder{" "}
                <span
                  className="help-icon ml-1 align-middle"
                  tabIndex={0}
                  aria-label="OKU help"
                >
                  ?
                  <div className="tooltip top-auto bottom-5" role="tooltip">
                    Check this if you hold a valid OKU card issued by Jabatan
                    Kebajikan Masyarakat. This may qualify you for special
                    categories in tournaments.
                  </div>
                </span>
              </label>
            </div>

            <div className="flex flex-col gap-2 sm:flex-row">
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={handleSkip}
                disabled={isSubmitting}
              >
                Skip
              </button>
              <button
                type="submit"
                className="btn-primary w-full"
                disabled={isSubmitting}
                aria-disabled={isSubmitting}
              >
                {isSubmitting ? "Saving…" : "Complete Profile"}
              </button>
            </div>
          </form>

          <p className="auth-footer text-xs">
            All fields are optional — editable later in settings
          </p>
        </div>
      </div>
    </div>
  );
}
