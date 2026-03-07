"use client";

import { useState } from "react";
import StepTracker from "./StepTracker";

const GENDERS = ["Male", "Female", "Prefer not to say"] as const;
const STATES = [
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
  "Kuala Lumpur",
  "Labuan",
  "Putrajaya",
] as const;

export default function ProfileForm() {
  const [gender, setGender] = useState("");
  const [nationality, setNationality] = useState("Malaysian");
  const [dateOfBirth, setDateOfBirth] = useState("");
  const [state, setState] = useState("");
  const [fideId, setFideId] = useState("");
  const [mcfId, setMcfId] = useState("");
  const [isOku, setIsOku] = useState(false);
  const [avatarInitials] = useState("AR"); // Will be derived from user data in real impl

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    window.location.href = "/sign-up/verify";
  }

  function handleBack() {
    window.location.href = "/sign-up";
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
            <p className="auth-subheading">Help us set up your chess identity</p>
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
                <span className="avatar-overlay-text">Upload<br />Photo</span>
              </div>
            </div>
            <p className="avatar-hint">
              Tap to upload a profile photo
            </p>
            <p className="avatar-hint">
              JPG or PNG, max 2 MB
            </p>
          </div>

          <form onSubmit={handleSubmit} noValidate>
            {/* Gender + Nationality */}
            <div className="input-row" style={{ marginBottom: "var(--space-lg)" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <div className="label-row">
                  <label className="input-label" htmlFor="gender">Gender</label>
                </div>
                <select
                  id="gender"
                  className="input"
                  value={gender}
                  onChange={(e) => setGender(e.target.value)}
                  required
                  aria-required="true"
                >
                  <option value="">Select…</option>
                  {GENDERS.map((g) => (
                    <option key={g} value={g}>{g}</option>
                  ))}
                </select>
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <div className="label-row">
                  <label className="input-label" htmlFor="nationality">Nationality</label>
                </div>
                <input
                  id="nationality"
                  className="input"
                  type="text"
                  placeholder="Malaysian"
                  value={nationality}
                  onChange={(e) => setNationality(e.target.value)}
                  required
                  aria-required="true"
                />
              </div>
            </div>

            {/* Date of Birth + State */}
            <div className="input-row" style={{ marginBottom: "var(--space-lg)" }}>
              <div className="form-group" style={{ marginBottom: 0 }}>
                <div className="label-row">
                  <label className="input-label" htmlFor="dateOfBirth">Date of Birth</label>
                </div>
                <input
                  id="dateOfBirth"
                  className="input"
                  type="date"
                  placeholder="DD / MM / YYYY"
                  value={dateOfBirth}
                  onChange={(e) => setDateOfBirth(e.target.value)}
                />
              </div>

              <div className="form-group" style={{ marginBottom: 0 }}>
                <div className="label-row">
                  <label className="input-label" htmlFor="state">State</label>
                </div>
                <select
                  id="state"
                  className="input"
                  value={state}
                  onChange={(e) => setState(e.target.value)}
                >
                  <option value="">Select…</option>
                  {STATES.map((s) => (
                    <option key={s} value={s}>{s}</option>
                  ))}
                </select>
              </div>
            </div>

            {/* FIDE ID */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="fideId">FIDE ID</label>
                <span className="label-optional">(Optional)</span>
                <span className="help-icon" tabIndex={0} aria-label="FIDE ID help">
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
                placeholder="e.g. 36095765"
                value={fideId}
                onChange={(e) => setFideId(e.target.value)}
              />
              <p className="input-hint">
                Ratings will be auto-fetched from FIDE&apos;s database
              </p>
            </div>

            {/* MCF ID */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="mcfId">MCF ID</label>
                <span className="label-optional">(Optional)</span>
                <span className="help-icon" tabIndex={0} aria-label="MCF ID help">
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
                placeholder="e.g. MCF-2024-001234"
                value={mcfId}
                onChange={(e) => setMcfId(e.target.value)}
              />
            </div>

            {/* OKU checkbox */}
            <div className="check-row" style={{ marginBottom: "var(--space-xl)" }}>
              <input
                id="oku"
                type="checkbox"
                className="checkbox"
                checked={isOku}
                onChange={(e) => setIsOku(e.target.checked)}
              />
              <label className="check-label" htmlFor="oku">
                I am an OKU (Orang Kurang Upaya) card holder{" "}
                <span className="help-icon" style={{ verticalAlign: "middle", marginLeft: 4 }} tabIndex={0} aria-label="OKU help">
                  ?
                  <div className="tooltip" style={{ top: "auto", bottom: 20 }} role="tooltip">
                    Check this if you hold a valid OKU card issued by Jabatan
                    Kebajikan Masyarakat. This may qualify you for special
                    categories in tournaments.
                  </div>
                </span>
              </label>
            </div>

            <div style={{ display: "flex", gap: "var(--space-sm)" }}>
              <button type="button" className="btn-secondary" onClick={handleBack}>
                Back
              </button>
              <button type="submit" className="btn-primary w-full">
                Continue
              </button>
            </div>
          </form>

          <p className="auth-footer" style={{ fontSize: 12 }}>
            All fields except gender and nationality are optional — editable
            later in settings
          </p>
        </div>
      </div>
    </div>
  );
}
