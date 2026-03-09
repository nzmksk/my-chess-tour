"use client";

import { useActionState, useState } from "react";
import { updatePassword } from "../actions";
import { INITIAL_UPDATE_PASSWORD_STATE } from "../types";

export default function UpdatePasswordForm() {
  const [state, formAction, pending] = useActionState(
    updatePassword,
    INITIAL_UPDATE_PASSWORD_STATE,
  );
  const [showPassword, setShowPassword] = useState(false);
  const [showConfirm, setShowConfirm] = useState(false);

  return (
    <div className="auth-page">
      <div className="centered-col">
        <div className="auth-card card card--featured">
          <div className="auth-card-header">
            <span className="auth-logo">MY Chess Tour</span>
            <h1 className="auth-heading">New Password</h1>
            <p className="auth-subheading">Choose a strong password for your account</p>
            <hr className="divider-gold" />
          </div>

          {state.error && (
            <div className="error-banner" role="alert">
              <span className="text-sm shrink-0 mt-px" aria-hidden="true">⚠</span>
              <p className="error-text">{state.error}</p>
            </div>
          )}

          <form action={formAction}>
            {/* New password */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="password">
                  New Password
                </label>
              </div>
              <div className="input-wrap">
                <input
                  id="password"
                  name="password"
                  className={`input input--icon${state.fieldErrors.password ? " input-error" : ""}`}
                  type={showPassword ? "text" : "password"}
                  placeholder="At least 8 characters"
                  autoComplete="new-password"
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
              {state.fieldErrors.password && (
                <p className="input-hint error">{state.fieldErrors.password}</p>
              )}
            </div>

            {/* Confirm password */}
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="confirmPassword">
                  Confirm Password
                </label>
              </div>
              <div className="input-wrap">
                <input
                  id="confirmPassword"
                  name="confirmPassword"
                  className={`input input--icon${state.fieldErrors.confirmPassword ? " input-error" : ""}`}
                  type={showConfirm ? "text" : "password"}
                  placeholder="Repeat your new password"
                  autoComplete="new-password"
                  required
                />
                <button
                  type="button"
                  className="eye-btn"
                  onClick={() => setShowConfirm((v) => !v)}
                  aria-label={showConfirm ? "Hide password" : "Show password"}
                >
                  <span
                    className={showConfirm ? "eye-off-icon" : "eye-icon"}
                    aria-hidden="true"
                  />
                </button>
              </div>
              {state.fieldErrors.confirmPassword && (
                <p className="input-hint error">{state.fieldErrors.confirmPassword}</p>
              )}
            </div>

            <button
              type="submit"
              className="btn-primary"
              disabled={pending}
              aria-disabled={pending}
            >
              {pending ? "Updating\u2026" : "Update Password"}
            </button>
          </form>
        </div>
      </div>
    </div>
  );
}
