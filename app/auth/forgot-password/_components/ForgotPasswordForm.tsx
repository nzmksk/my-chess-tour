"use client";

import Link from "next/link";
import { useActionState } from "react";
import { forgotPassword } from "../actions";
import { INITIAL_FORGOT_PASSWORD_STATE } from "../types";

export default function ForgotPasswordForm() {
  const [state, formAction, pending] = useActionState(
    forgotPassword,
    INITIAL_FORGOT_PASSWORD_STATE,
  );

  // Success screen
  if (state.submitted) {
    return (
      <div className="auth-page">
        <div className="centered-col">
          <div className="auth-card card card--featured text-center">
            <div
              className="font-[2rem] mb-4"
              role="img"
              aria-label="Email sent"
            >
              📬
            </div>
            <h1 className="auth-heading mb-2">Check Your Email</h1>
            <p className="auth-subheading mb-10">
              If an account with that email exists, we&apos;ve sent a password
              reset link. It expires in 1 hour.
            </p>
            <Link href="/login" className="btn-primary">
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

          {state.error && (
            <div className="error-banner" role="alert">
              <span className="text-sm shrink-0 mt-px" aria-hidden="true">
                ⚠
              </span>
              <p className="error-text">{state.error}</p>
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
            Remembered it? <Link href="/login">Back to sign in</Link>
          </p>
        </div>
      </div>
    </div>
  );
}
