"use client";

import Link from "next/link";
import { useActionState, useState } from "react";
import { login } from "../actions";
import { INITIAL_LOGIN_STATE } from "../types";

export default function LoginForm() {
  const [state, formAction, pending] = useActionState(
    login,
    INITIAL_LOGIN_STATE,
  );
  const [showPassword, setShowPassword] = useState(false);

  // Screen 2C — Account Locked
  if (state.locked) {
    const minutes = state.lockedSeconds
      ? Math.ceil(state.lockedSeconds / 60)
      : 15;
    return (
      <div className="auth-page">
        <div className="centered-col">
          <div className="auth-card card text-center max-w-100 mx-0 my-auto">
            <div
              className="confirm-icon confirm-icon--danger"
              role="img"
              aria-label="Account locked"
            >
              🔒
            </div>
            <h1 className="confirm-title">Account Locked</h1>
            <p className="confirm-body">
              Too many failed sign-in attempts. Your account has been
              temporarily locked.
              <br />
              <br />
              <strong className="font-(--font-cinzel) text-(--color-gold-muted) tracking-wider">
                Unlocks in ~{minutes} minute{minutes !== 1 ? "s" : ""}
              </strong>
            </p>
            <div className="confirm-actions">
              <Link href="/auth/forgot-password" className="btn-primary">
                Reset Password
              </Link>
              <a
                href="mailto:mychesstour@gmail.com"
                className="btn-secondary mt-2 block text-center"
              >
                Contact Support
              </a>
            </div>
          </div>
        </div>
      </div>
    );
  }

  // Screen 2A / 2B — Login form (clean or with errors)
  return (
    <div className="auth-page">
      <div className="centered-col">
        <div className="auth-card card card--featured">
          <div className="auth-card-header">
            <span className="auth-logo">MY Chess Tour</span>
            <h1 className="auth-heading">Welcome Back</h1>
            <p className="auth-subheading">Sign in to your account</p>
            <hr className="divider-gold" />
          </div>

          {state.error && (
            <div className="error-banner" role="alert">
              <span className="text-sm shrink-0 mt-px" aria-hidden="true">
                ⚠
              </span>
              <p className="error-text">
                {state.error}
                {state.attemptsRemaining !== null &&
                  state.attemptsRemaining > 0 && (
                    <>
                      {" "}
                      <strong>
                        {state.attemptsRemaining} attempt
                        {state.attemptsRemaining !== 1 ? "s" : ""} remaining
                      </strong>{" "}
                      before your account is temporarily locked.
                    </>
                  )}
              </p>
            </div>
          )}

          <form action={formAction}>
            {/* Email */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="email">
                  Email Address
                </label>
              </div>
              <input
                id="email"
                name="email"
                className="input"
                type="email"
                placeholder="you@example.com"
                autoComplete="email"
                required
              />
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
                  name="password"
                  className={`input input--icon${state.error ? " input-error" : ""}`}
                  type={showPassword ? "text" : "password"}
                  placeholder="Your password"
                  autoComplete="current-password"
                  required
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
            </div>

            {/* Remember me + Forgot password */}
            <div className="remember-forgot-row">
              <div className="check-row mb-0">
                <input
                  id="keepSignedIn"
                  name="keepSignedIn"
                  type="checkbox"
                  className="checkbox"
                  defaultChecked
                />
                <label
                  htmlFor="keepSignedIn"
                  className="check-label font-[0.75rem]"
                >
                  Keep me signed in
                </label>
              </div>
              <Link href="/auth/forgot-password" className="forgot-link">
                Forgot password?
              </Link>
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={pending}
              aria-disabled={pending}
            >
              {pending ? "Signing In\u2026" : "Sign In"}
            </button>
          </form>

          <p className="auth-footer mt-lg">
            Don&apos;t have an account? <Link href="/sign-up">Create one</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
