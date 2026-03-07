"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import StepTracker from "./StepTracker";
import { useSignUpForm } from "./SignUpContext";

const CODE_LENGTH = 6;
const CODE_EXPIRY_SECONDS = 10 * 60; // 10 minutes
const RESEND_COOLDOWN_SECONDS = 30 * 60; // 30 minutes

function formatTime(seconds: number): string {
  const m = Math.floor(seconds / 60)
    .toString()
    .padStart(2, "0");
  const s = (seconds % 60).toString().padStart(2, "0");
  return `${m}:${s}`;
}

export default function VerifyForm() {
  const { form } = useSignUpForm();
  const router = useRouter();
  const email = form.email;
  const [code, setCode] = useState("");
  const [timeLeft, setTimeLeft] = useState(CODE_EXPIRY_SECONDS);
  const [cooldownLeft, setCooldownLeft] = useState(0);
  const [isResending, setIsResending] = useState(false);
  const [isVerifying, setIsVerifying] = useState(false);
  const [verifyError, setVerifyError] = useState<string | null>(null);
  const expiryRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const cooldownRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // Code expiry countdown
  useEffect(() => {
    expiryRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(expiryRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => {
      if (expiryRef.current) clearInterval(expiryRef.current);
    };
  }, []);

  // Cooldown countdown — restarts whenever cooldownLeft is seeded
  const startCooldown = useCallback(() => {
    if (cooldownRef.current) clearInterval(cooldownRef.current);
    setCooldownLeft(RESEND_COOLDOWN_SECONDS);
    cooldownRef.current = setInterval(() => {
      setCooldownLeft((prev) => {
        if (prev <= 1) {
          clearInterval(cooldownRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
  }, []);

  useEffect(() => {
    return () => {
      if (cooldownRef.current) clearInterval(cooldownRef.current);
    };
  }, []);

  async function submitCode(value: string) {
    setVerifyError(null);
    setIsVerifying(true);
    try {
      const res = await fetch("/api/v1/auth/signup/verify-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          email,
          code: value,
          password: form.password,
          firstName: form.firstName,
          lastName: form.lastName,
          gender: form.gender,
          nationality: form.nationality,
          dateOfBirth: form.dateOfBirth,
          state: form.state,
          fideId: form.fideId,
          mcfId: form.mcfId,
          isOku: form.isOku,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVerifyError(data.error ?? "Verification failed. Please try again.");
        return;
      }
      document.cookie = "signup_step=; path=/; max-age=0; SameSite=Lax";
      router.push("/sign-up/success");
    } catch {
      setVerifyError("Network error. Please try again.");
    } finally {
      setIsVerifying(false);
    }
  }

  function handleCodeChange(e: React.ChangeEvent<HTMLInputElement>) {
    const value = e.target.value
      .replace(/[^A-Za-z0-9]/g, "")
      .toUpperCase()
      .slice(0, CODE_LENGTH);
    setCode(value);
    setVerifyError(null);
    if (value.length === CODE_LENGTH) {
      submitCode(value);
    }
  }

  async function handleResend(e: React.MouseEvent) {
    e.preventDefault();
    if (cooldownLeft > 0 || isResending) return;

    setIsResending(true);
    try {
      await fetch("/api/v1/auth/signup/request-code", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email }),
      });
    } finally {
      setIsResending(false);
    }

    // Reset code expiry timer
    if (expiryRef.current) clearInterval(expiryRef.current);
    setTimeLeft(CODE_EXPIRY_SECONDS);
    expiryRef.current = setInterval(() => {
      setTimeLeft((prev) => {
        if (prev <= 1) {
          clearInterval(expiryRef.current!);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    startCooldown();
  }

  const expired = timeLeft === 0;
  const canResend = cooldownLeft === 0 && !isResending;
  const canVerify = code.length === CODE_LENGTH && !expired && !isVerifying;

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
            <div
              style={{ fontSize: 32, marginBottom: "var(--space-md)" }}
              role="img"
              aria-label="Email"
            >
              &#128236;
            </div>
            <h1 className="auth-heading">Check Your Email</h1>
            <p className="auth-subheading">
              We sent a 6-digit code to
              <br />
              <strong style={{ color: "var(--color-gold-muted)" }}>
                {email}
              </strong>
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
              inputMode="text"
              autoCapitalize="characters"
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
                <span style={{ color: "var(--color-error)" }}>
                  Code has expired
                </span>
              ) : (
                <>
                  Code expires in{" "}
                  <strong style={{ color: "var(--color-gold-muted)" }}>
                    {formatTime(timeLeft)}
                  </strong>
                </>
              )}
            </p>
            {verifyError && (
              <p className="input-hint error">{verifyError}</p>
            )}
          </div>

          <button
            className="btn-primary mt-md"
            onClick={() => submitCode(code)}
            disabled={!canVerify}
            aria-disabled={!canVerify}
          >
            {isVerifying ? "Verifying…" : "Verify Email"}
          </button>

          <p className="auth-footer mt-6">
            Didn&apos;t receive it?{" "}
            {cooldownLeft > 0 ? (
              <span style={{ color: "var(--color-text-disabled)" }}>
                Resend again in{" "}
                <span className="text-(--color-text-muted)">
                  {formatTime(cooldownLeft)}
                </span>
              </span>
            ) : (
              <a
                href="#"
                onClick={handleResend}
                aria-disabled={!canResend}
              >
                {isResending ? "Sending…" : "Resend code"}
              </a>
            )}
          </p>
          <p className="auth-footer">
            <a href="/sign-up">Change email</a>
          </p>
        </div>
      </div>
    </div>
  );
}
