"use client";

import { useEffect, useRef, useState } from "react";
import StepTracker from "./StepTracker";

const CODE_LENGTH = 6;
const EXPIRY_SECONDS = 10 * 60; // 10 minutes

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60).toString().padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

type VerifyFormProps = {
  email?: string;
};

export default function VerifyForm({ email = "user@example.com" }: VerifyFormProps) {
  const [code, setCode] = useState("");
  const [timeLeft, setTimeLeft] = useState(EXPIRY_SECONDS);
  const [resendCount, setResendCount] = useState(0);
  const [cooldown, setCooldown] = useState(false);
  const intervalRef = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    intervalRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(intervalRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value.replace(/\D/g, "").slice(0, CODE_LENGTH);
    setCode(value);
    if (value.length === CODE_LENGTH) {
      // Auto-submit on 6th digit
      window.location.href = "/sign-up/success";
    }
  }

  function handleResend(e: React.MouseEvent) {
    e.preventDefault();
    if (resendCount >= 3 || cooldown) return;
    setResendCount((c) => c + 1);
    setTimeLeft(EXPIRY_SECONDS);
    if (resendCount + 1 >= 3) {
      setCooldown(true);
    }
  }

  const expired = timeLeft === 0;

  return (
    <div className="auth-page">
      <div className="centered-col">
        <div className="auth-card card card--featured">
          <StepTracker
            steps={[
              { label: "Account", state: "done" },
              { label: "Profile", state: "done" },
              { label: "Verify", state: "current" },
            ]}
          />

          <div className="auth-card-header">
            <div style={{ fontSize: 32, marginBottom: "var(--space-md)" }} role="img" aria-label="Email">
              &#128236;
            </div>
            <h1 className="auth-heading">Check Your Email</h1>
            <p className="auth-subheading">
              We sent a 6-digit code to
              <br />
              <strong style={{ color: "var(--color-gold-muted)" }}>{email}</strong>
            </p>
            <hr className="divider-gold" />
          </div>

          <div className="form-group">
            <div className="label-row">
              <label className="input-label" htmlFor="verificationCode">
                Verification Code
              </label>
            </div>
            <input
              id="verificationCode"
              className="input"
              type="text"
              inputMode="numeric"
              pattern="[0-9]*"
              placeholder="_ _ _ _ _ _"
              value={code}
              onChange={handleCodeChange}
              maxLength={CODE_LENGTH}
              autoComplete="one-time-code"
              aria-label="6-digit verification code"
              style={{
                fontFamily: "var(--font-cinzel)",
                letterSpacing: "0.3em",
                fontSize: 22,
                textAlign: "center",
              }}
            />
            <p className="input-hint">
              {expired ? (
                <span style={{ color: "var(--color-error)" }}>Code has expired</span>
              ) : (
                <>
                  Code expires in{" "}
                  <strong style={{ color: "var(--color-gold-muted)" }}>
                    {formatTime(timeLeft)}
                  </strong>
                </>
              )}
            </p>
          </div>

          <button
            className="btn-primary mt-md"
            onClick={() => window.location.href = "/sign-up/success"}
            disabled={code.length !== CODE_LENGTH || expired}
            aria-disabled={code.length !== CODE_LENGTH || expired}
          >
            Verify Email
          </button>

          <p className="auth-footer mt-lg">
            Didn&apos;t receive it?{" "}
            {cooldown ? (
              <span style={{ color: "var(--color-text-disabled)" }}>
                Resend unavailable (30-min cooldown)
              </span>
            ) : (
              <a
                href="#"
                onClick={handleResend}
                aria-disabled={resendCount >= 3}
              >
                Resend code
              </a>
            )}{" "}
            · <a href="/sign-up">Change email</a>
          </p>
        </div>
      </div>
    </div>
  );
}
