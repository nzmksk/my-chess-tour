"use client";

import Link from "next/link";
import { useState } from "react";
import {
  checkPasswordRequirements,
  getPasswordStrength,
  isRegistrationFormSubmittable,
  validateRegistrationForm,
  type RegistrationErrors,
} from "@/lib/auth-validation";
import StepTracker from "./StepTracker";

const EyeIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4"
    aria-hidden="true"
  >
    <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
    <circle cx="12" cy="12" r="3" />
  </svg>
);

const EyeOffIcon = () => (
  <svg
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="1.8"
    strokeLinecap="round"
    strokeLinejoin="round"
    className="w-4 h-4"
    aria-hidden="true"
  >
    <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19m-6.72-1.07a3 3 0 1 1-4.24-4.24" />
    <line x1="1" y1="1" x2="23" y2="23" />
  </svg>
);

export default function RegisterForm() {
  const [firstName, setFirstName] = useState("");
  const [lastName, setLastName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [confirmPassword, setConfirmPassword] = useState("");
  const [termsAccepted, setTermsAccepted] = useState(false);
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const passwordReqs = checkPasswordRequirements(password);
  const passwordStrength = getPasswordStrength(password);
  const strengthPercent = (passwordStrength / 5) * 100;

  const submittable = isRegistrationFormSubmittable({
    firstName,
    lastName,
    email,
    password,
    confirmPassword,
    termsAccepted,
  });

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitted(true);
    const { errors: validationErrors, isValid } = validateRegistrationForm({
      firstName,
      lastName,
      email,
      password,
      confirmPassword,
      termsAccepted,
    });
    setErrors(validationErrors);
    if (isValid) {
      // Navigate to next step
      window.location.href = "/register/profile";
    }
  }

  const hasErrors = submitted && Object.keys(errors).length > 0;

  return (
    <div className="auth-page">
      <div className="centered-col">
        <div className="auth-card card card--featured">
          <StepTracker
            steps={[
              { label: "Account", state: "current" },
              { label: "Profile", state: "pending" },
              { label: "Verify", state: "pending" },
            ]}
          />

          <div className="auth-card-header">
            <span className="auth-logo">MY Chess Tour</span>
            <h1 className="auth-heading">Create Account</h1>
            <p className="auth-subheading">
              Join Malaysia&apos;s premier competitive chess circuit
            </p>
            <hr className="divider-gold" />
          </div>

          {hasErrors && (
            <div className="error-banner" role="alert">
              <span className="text-sm shrink-0 mt-px">&#9888;</span>
              <p className="error-text">
                Please correct the errors below before continuing.
              </p>
            </div>
          )}

          <form onSubmit={handleSubmit} noValidate>
            {/* Name row */}
            <div className="input-row">
              <div className="form-group">
                <div className="label-row">
                  <label className="input-label" htmlFor="firstName">
                    First Name
                  </label>
                  <span className="help-icon" tabIndex={0} aria-label="First name help">
                    ?
                    <div className="tooltip" role="tooltip">
                      Enter your legal first name as it appears on your IC or
                      passport. This is used for tournament registration and FIDE
                      records.
                    </div>
                  </span>
                </div>
                <input
                  id="firstName"
                  className={`input${errors.firstName ? " input-error" : ""}`}
                  type="text"
                  placeholder="Ahmad"
                  value={firstName}
                  onChange={(e) => setFirstName(e.target.value)}
                  autoComplete="given-name"
                  aria-invalid={!!errors.firstName}
                  aria-describedby={errors.firstName ? "firstName-error" : undefined}
                />
                {errors.firstName && (
                  <p id="firstName-error" className="input-hint error">
                    {errors.firstName}
                  </p>
                )}
              </div>

              <div className="form-group">
                <div className="label-row">
                  <label className="input-label" htmlFor="lastName">
                    Last Name
                  </label>
                  <span className="help-icon" tabIndex={0} aria-label="Last name help">
                    ?
                    <div className="tooltip" role="tooltip">
                      Enter your legal last name or family name. For names
                      without a surname (e.g. bin/binti), you may repeat your
                      first name.
                    </div>
                  </span>
                </div>
                <input
                  id="lastName"
                  className={`input${errors.lastName ? " input-error" : ""}`}
                  type="text"
                  placeholder="Razif"
                  value={lastName}
                  onChange={(e) => setLastName(e.target.value)}
                  autoComplete="family-name"
                  aria-invalid={!!errors.lastName}
                  aria-describedby={errors.lastName ? "lastName-error" : undefined}
                />
                {errors.lastName && (
                  <p id="lastName-error" className="input-hint error">
                    {errors.lastName}
                  </p>
                )}
              </div>
            </div>

            {/* Email */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="email">
                  Email Address
                </label>
              </div>
              <input
                id="email"
                className={`input${errors.email ? " input-error" : ""}`}
                type="email"
                placeholder="you@example.com"
                value={email}
                onChange={(e) => setEmail(e.target.value)}
                autoComplete="email"
                aria-invalid={!!errors.email}
                aria-describedby={errors.email ? "email-error" : undefined}
              />
              {errors.email && (
                <p id="email-error" className="input-hint error">
                  {errors.email}
                </p>
              )}
            </div>

            {/* Password */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="password">
                  Password
                </label>
              </div>
              <div className="input-wrap">
                <input
                  id="password"
                  className={`input input--icon${errors.password ? " input-error" : ""}`}
                  type={showPassword ? "text" : "password"}
                  placeholder="Create a password"
                  value={password}
                  onChange={(e) => setPassword(e.target.value)}
                  autoComplete="new-password"
                  aria-invalid={!!errors.password}
                  aria-describedby="password-requirements"
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowPassword((v) => !v)}
                  aria-label={showPassword ? "Hide password" : "Show password"}
                >
                  {showPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>

              {/* Strength bar */}
              <div
                className="strength-bar"
                role="meter"
                aria-label="Password strength"
                aria-valuenow={passwordStrength}
                aria-valuemin={0}
                aria-valuemax={5}
              >
                <div
                  className="strength-fill"
                  style={{ width: `${strengthPercent}%` }}
                />
              </div>

              {/* Requirements */}
              <div
                id="password-requirements"
                className={`pw-requirements${submitted && errors.password ? " pw-requirements--error" : ""}`}
              >
                <p className="pw-req-title">Password must contain</p>
                <div className="pw-req-grid">
                  <div className={`pw-req${passwordReqs.minLength ? " pw-req--met" : ""}`}>
                    <div className="pw-req-dot" />
                    8+ characters
                  </div>
                  <div className={`pw-req${passwordReqs.hasUppercase ? " pw-req--met" : ""}`}>
                    <div className="pw-req-dot" />
                    1 uppercase letter
                  </div>
                  <div className={`pw-req${passwordReqs.hasNumber ? " pw-req--met" : ""}`}>
                    <div className="pw-req-dot" />
                    1 number
                  </div>
                  <div className={`pw-req${passwordReqs.hasLowercase ? " pw-req--met" : ""}`}>
                    <div className="pw-req-dot" />
                    1 lowercase letter
                  </div>
                  <div className={`pw-req${passwordReqs.hasSymbol ? " pw-req--met" : ""}`}>
                    <div className="pw-req-dot" />
                    1 symbol (!@#$…)
                  </div>
                </div>
              </div>
            </div>

            {/* Confirm Password */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="confirmPassword">
                  Confirm Password
                </label>
              </div>
              <div className="input-wrap">
                <input
                  id="confirmPassword"
                  className={`input input--icon${errors.confirmPassword ? " input-error" : ""}`}
                  type={showConfirmPassword ? "text" : "password"}
                  placeholder="Repeat password"
                  value={confirmPassword}
                  onChange={(e) => setConfirmPassword(e.target.value)}
                  autoComplete="new-password"
                  aria-invalid={!!errors.confirmPassword}
                  aria-describedby={errors.confirmPassword ? "confirmPassword-error" : undefined}
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={showConfirmPassword ? "Hide confirm password" : "Show confirm password"}
                >
                  {showConfirmPassword ? <EyeOffIcon /> : <EyeIcon />}
                </button>
              </div>
              {errors.confirmPassword && (
                <p id="confirmPassword-error" className="input-hint error">
                  {errors.confirmPassword}
                </p>
              )}
            </div>

            {/* Terms */}
            <div className="check-row" style={{ marginBottom: "var(--space-lg)" }}>
              <input
                id="terms"
                type="checkbox"
                className="checkbox"
                checked={termsAccepted}
                onChange={(e) => setTermsAccepted(e.target.checked)}
                aria-describedby={errors.terms ? "terms-error" : undefined}
              />
              <label className="check-label" htmlFor="terms">
                I agree to the{" "}
                <Link href="/terms">Terms of Service</Link> and{" "}
                <Link href="/privacy">Privacy Policy</Link>
              </label>
            </div>
            {errors.terms && (
              <p id="terms-error" className="input-hint error mb-4">
                {errors.terms}
              </p>
            )}

            <button
              type="submit"
              className="btn-primary"
              disabled={submitted && !submittable}
              aria-disabled={submitted && !submittable}
            >
              Create Account
            </button>
          </form>

          <div className="divider-text">already have an account?</div>
          <p className="auth-footer" style={{ marginTop: 0 }}>
            <Link href="/login">Sign in instead</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
