"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import StepTracker from "./StepTracker";
import { useSignUpForm } from "./SignUpContext";
import { SIGNUP_STEP_COOKIE, SIGNUP_STEP_MAX_AGE } from "@/lib/signup-cookie";

const GENDERS = ["Male", "Female"] as const;

export default function ProfileForm() {
  const { form, setForm } = useSignUpForm();
  const router = useRouter();
  const avatarInitials =
    `${form.firstName[0]}${form.lastName[0]}`.toUpperCase() || "CT";
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [submitError, setSubmitError] = useState<{
    message: string;
    emailExists: boolean;
  } | null>(null);

  async function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitError(null);

    if (process.env.NEXT_PUBLIC_ENVIRONMENT !== "production") return;

    setIsSubmitting(true);

    try {
      const res = await fetch("/api/v1/auth/signup/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email: form.email }),
      });

      const data = await res.json();

      if (!res.ok) {
        setSubmitError({
          message: data.error?.message ?? "Something went wrong. Please try again.",
          emailExists: data.error?.code === "EMAIL_EXISTS",
        });
        return;
      }

      document.cookie = `${SIGNUP_STEP_COOKIE}=verify; path=/; max-age=${SIGNUP_STEP_MAX_AGE}; SameSite=Lax`;
      router.push("/auth/signup/verify");
    } catch {
      setSubmitError({
        message: "Network error. Please try again.",
        emailExists: false,
      });
    } finally {
      setIsSubmitting(false);
    }
  }

  function handleBack() {
    router.push("/auth/signup");
  }

  return (
    <div className="auth-page">
      <div className="centered-col">
        <div className="auth-card card card--featured">
          <StepTracker
            steps={[
              { label: "Account", state: "done" },
              { label: "Profile", state: "current" },
              { label: "Verify", state: "pending" },
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
            >
              {avatarInitials}
              <div className="avatar-overlay">
                <span className="avatar-overlay-text">
                  Upload
                  <br />
                  Photo
                </span>
              </div>
            </div>
            <p className="avatar-hint">Tap to upload a profile photo</p>
            <p className="avatar-hint">JPG or PNG, max 2 MB</p>
          </div>

          {submitError && (
            <div className="error-banner" role="alert">
              <span className="text-sm shrink-0 mt-px">&#9888;</span>
              <p className="error-text">
                {submitError.message}
                {submitError.emailExists && (
                  <>
                    {" "}
                    <Link href="/auth/login">Sign in instead</Link>
                  </>
                )}
              </p>
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
                required
                aria-required="true"
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
                required
                aria-required="true"
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
                  className="help-icon align-middle ml-1"
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

            <div className="flex flex-col sm:flex-row gap-2">
              <button
                type="button"
                className="btn-secondary w-full"
                onClick={handleBack}
                disabled={isSubmitting}
              >
                Back
              </button>
              <button
                type="submit"
                className="btn-primary w-full"
                disabled={isSubmitting}
                aria-disabled={isSubmitting}
              >
                {isSubmitting ? "Sending code…" : "Continue"}
              </button>
            </div>
          </form>

          <p className="auth-footer text-xs">
            All fields except gender and nationality are optional — editable
            later in settings
          </p>
        </div>
      </div>
    </div>
  );
}
