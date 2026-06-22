"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPassword } from "../_actions/forgotPassword";
import { INITIAL_FORGOT_PASSWORD_STATE } from "../types";

export default function ForgotPasswordForm({
  initialError = null,
}: {
  initialError?: string | null;
}) {
  const [state, formAction, pending] = useActionState(
    forgotPassword,
    INITIAL_FORGOT_PASSWORD_STATE,
  );

  // Surface the action error if present, otherwise fall back to an error
  // passed via the URL (e.g. an expired link redirected here by the callback).
  const errorMessage = state.error ?? initialError;

  // Success screen
  if (state.submitted) {
    return (
      <div className="auth-page">
        <div className="centered-col">
          <div className="auth-card card card--featured text-center">
            <div
              className="text-gold-bright mb-4 text-3xl"
              role="img"
              aria-label="Email sent"
            >
              ♖
            </div>
            <h1 className="auth-heading mb-2">Check Your Email</h1>
            <p className="auth-subheading mb-10">
              If an account with that email exists, we&apos;ve sent a password
              reset link. It expires in 1 hour.
            </p>
            <Link href="/auth/login" className="btn-primary">
              Back to Sign In
            </Link>
          </div>
        </div>
      </div>
    );
  }

  // Default form screen
  return (
    <div className="auth-page">
      <div className="centered-col">
        <div className="auth-card card card--featured">
          <div className="auth-card-header">
            <span className="auth-logo">MY Chess Tour</span>
            <h1 className="auth-heading">Reset Password</h1>
            <p className="auth-subheading">
              Enter your email to receive a reset link
            </p>
            <hr className="divider-gold" />
          </div>

          {errorMessage && (
            <div className="error-banner" role="alert">
              <span className="mt-px shrink-0 text-sm" aria-hidden="true">
                ⚠
              </span>
              <p className="error-text">{errorMessage}</p>
            </div>
          )}

          <form action={formAction}>
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
              <p className="input-hint">
                A secure reset link will be sent — valid for 1 hour
              </p>
            </div>

            <button
              type="submit"
              className="btn-primary mt-4"
              disabled={pending}
              aria-disabled={pending}
            >
              {pending ? "Sending\u2026" : "Send Reset Link"}
            </button>
          </form>

          <p className="auth-footer mt-lg">
            <Link href="/auth/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
