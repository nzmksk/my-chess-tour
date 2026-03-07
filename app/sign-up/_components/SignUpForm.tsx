"use client";

import Link from "next/link";
import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  checkPasswordRequirements,
  getPasswordStrength,
  isRegistrationFormSubmittable,
  validateRegistrationForm,
  type RegistrationErrors,
} from "@/lib/auth-validation";
import StepTracker from "./StepTracker";
import { useSignUpForm } from "./SignUpContext";

export default function SignUpForm() {
  const { form, setForm } = useSignUpForm();
  const router = useRouter();
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirmPassword, setShowConfirmPassword] = useState(false);
  const [errors, setErrors] = useState<RegistrationErrors>({});
  const [submitted, setSubmitted] = useState(false);

  const passwordReqs = checkPasswordRequirements(form.password);
  const passwordStrength = getPasswordStrength(form.password);
  const strengthPercent = (passwordStrength / 5) * 100;

  const submittable = isRegistrationFormSubmittable(form);

  function handleSubmit(e: React.SubmitEvent<HTMLFormElement>) {
    e.preventDefault();
    setSubmitted(true);
    const { errors: validationErrors, isValid } =
      validateRegistrationForm(form);
    setErrors(validationErrors);
    if (isValid) {
      router.push("/sign-up/profile");
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
                  <span
                    className="help-icon"
                    tabIndex={0}
                    aria-label="First name help"
                  >
                    ?
                    <div className="tooltip" role="tooltip">
                      Enter your legal first name as it appears on your IC or
                      passport. This is used for tournament registration and
                      FIDE records.
                    </div>
                  </span>
                </div>
                <input
                  id="firstName"
                  className={`input${errors.firstName ? " input-error" : ""}`}
                  type="text"
                  placeholder="Ahmad"
                  value={form.firstName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, firstName: e.target.value }))
                  }
                  autoComplete="given-name"
                  aria-invalid={!!errors.firstName}
                  aria-describedby={
                    errors.firstName ? "firstName-error" : undefined
                  }
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
                  <span
                    className="help-icon"
                    tabIndex={0}
                    aria-label="Last name help"
                  >
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
                  value={form.lastName}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, lastName: e.target.value }))
                  }
                  autoComplete="family-name"
                  aria-invalid={!!errors.lastName}
                  aria-describedby={
                    errors.lastName ? "lastName-error" : undefined
                  }
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
                value={form.email}
                onChange={(e) =>
                  setForm((f) => ({ ...f, email: e.target.value }))
                }
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
                  value={form.password}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, password: e.target.value }))
                  }
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
                  <span
                    className={showPassword ? "eye-off-icon" : "eye-icon"}
                    aria-hidden="true"
                  />
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
                  <div
                    className={`pw-req${passwordReqs.minLength ? " pw-req--met" : ""}`}
                  >
                    <div className="pw-req-dot" />
                    8+ characters
                  </div>
                  <div
                    className={`pw-req${passwordReqs.hasUppercase ? " pw-req--met" : ""}`}
                  >
                    <div className="pw-req-dot" />1 uppercase letter
                  </div>
                  <div
                    className={`pw-req${passwordReqs.hasNumber ? " pw-req--met" : ""}`}
                  >
                    <div className="pw-req-dot" />1 number
                  </div>
                  <div
                    className={`pw-req${passwordReqs.hasLowercase ? " pw-req--met" : ""}`}
                  >
                    <div className="pw-req-dot" />1 lowercase letter
                  </div>
                  <div
                    className={`pw-req${passwordReqs.hasSymbol ? " pw-req--met" : ""}`}
                  >
                    <div className="pw-req-dot" />1 symbol (!@#$…)
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
                  value={form.confirmPassword}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, confirmPassword: e.target.value }))
                  }
                  autoComplete="new-password"
                  aria-invalid={!!errors.confirmPassword}
                  aria-describedby={
                    errors.confirmPassword ? "confirmPassword-error" : undefined
                  }
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowConfirmPassword((v) => !v)}
                  aria-label={
                    showConfirmPassword
                      ? "Hide confirm password"
                      : "Show confirm password"
                  }
                >
                  <span
                    className={
                      showConfirmPassword ? "eye-off-icon" : "eye-icon"
                    }
                    aria-hidden="true"
                  />
                </button>
              </div>
              {errors.confirmPassword && (
                <p id="confirmPassword-error" className="input-hint error">
                  {errors.confirmPassword}
                </p>
              )}
            </div>

            {/* Terms */}
            <div
              className="check-row"
              style={{ marginBottom: "var(--space-lg)" }}
            >
              <input
                id="terms"
                type="checkbox"
                className="checkbox"
                checked={form.termsAccepted}
                onChange={(e) =>
                  setForm((f) => ({ ...f, termsAccepted: e.target.checked }))
                }
                aria-describedby={errors.terms ? "terms-error" : undefined}
              />
              <label className={`check-label ${errors.terms ? "" : "mb-2"}`} htmlFor="terms">
                I agree to the <Link href="/terms">Terms of Service</Link> and{" "}
                <Link href="/privacy">Privacy Policy</Link>
              </label>
            </div>
            {errors.terms && (
              <p id="terms-error" className="input-hint error mb-2">
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
            <Link href="/login">Log in instead</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
