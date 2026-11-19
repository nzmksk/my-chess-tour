"use client";

import { useState } from "react";
import { createClient } from "@/services/supabase/client";
import type { OkuStatus } from "@/app/profile/types";
import SensitiveDataConsent, {
  recordSensitiveDataConsent,
} from "@/components/SensitiveDataConsent";

const ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const MAX_BYTES = 5 * 1024 * 1024; // 5MB

interface Props {
  userId: string;
  status: OkuStatus;
  rejectionReason: string | null;
}

// OKU verification lives outside the main profile edit form because it's an
// upload-then-admin-review flow, not a self-set field. Uploading sends the card
// to the private oku-documents bucket, then records the path server-side and
// moves the player to "pending".
//
// The card is health data, so it needs the player's separate consent (#451):
// a checkbox that must be ticked before submitting, recorded server-side
// BEFORE the upload, because the bucket refuses a card without it. Once a card
// is on file the player can withdraw that consent, which deletes the card and
// resets their status.
export default function OkuVerificationCard({
  userId,
  status: initialStatus,
  rejectionReason,
}: Props) {
  const [status, setStatus] = useState<OkuStatus>(initialStatus);
  const [file, setFile] = useState<File | null>(null);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [consented, setConsented] = useState(false);
  const [confirmingWithdraw, setConfirmingWithdraw] = useState(false);
  const [withdrawing, setWithdrawing] = useState(false);

  async function handleSubmit() {
    if (!file) {
      setError("Please choose your OKU card first.");
      return;
    }
    if (!consented) {
      setError("Please tick the consent box to submit your OKU card.");
      return;
    }
    if (file.size > MAX_BYTES) {
      setError("File must be 5MB or smaller.");
      return;
    }
    setSubmitting(true);
    setError(null);
    try {
      const consentError = await recordSensitiveDataConsent("health");
      if (consentError) {
        setError(consentError);
        return;
      }

      const supabase = createClient();
      const ext = file.name.split(".").pop()?.toLowerCase() ?? "bin";
      const path = `users/${userId}/oku/${Date.now()}.${ext}`;
      const { error: uploadError } = await supabase.storage
        .from("oku-documents")
        .upload(path, file, { upsert: true });
      if (uploadError) {
        setError("Upload failed. Please try again.");
        return;
      }

      const res = await fetch("/api/v1/profile/oku", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ document_path: path }),
      });
      if (!res.ok) {
        const json = await res.json();
        setError(json.error?.message ?? "Submission failed. Please try again.");
        return;
      }
      setFile(null);
      setConsented(false);
      setStatus("pending");
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setSubmitting(false);
    }
  }

  async function handleWithdraw() {
    setWithdrawing(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/profile/oku", { method: "DELETE" });
      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setError(
          json?.error?.message ?? "Withdrawal failed. Please try again.",
        );
        return;
      }
      setConfirmingWithdraw(false);
      setStatus("none");
    } catch {
      setError("A network error occurred. Please try again.");
    } finally {
      setWithdrawing(false);
    }
  }

  const showUploader = status === "none" || status === "rejected";
  // A card is on file in every state but "none".
  const canWithdraw = status !== "none";

  return (
    <div className="card p-6">
      <h2 className="font-cinzel text-text-primary border-border mb-4 border-b pb-3 text-base font-semibold tracking-wider">
        OKU Verification
      </h2>

      {status === "verified" && (
        <p className="font-lato text-sm text-emerald-400">
          ✓ Verified OKU — you can register for OKU fee categories.
        </p>
      )}

      {status === "pending" && (
        <p className="font-lato text-text-secondary text-sm">
          Your OKU card is under review. We&apos;ll update your status once a
          reviewer has checked it.
        </p>
      )}

      {status === "rejected" && (
        <div className="border-danger-border bg-danger-bg mb-4 rounded-md border px-4 py-3">
          <p className="font-cinzel text-danger mb-1 text-xs font-semibold tracking-widest uppercase">
            Verification rejected
          </p>
          <p className="font-lato text-text-secondary text-sm">
            {rejectionReason || "Please upload a clearer copy of your OKU card."}
          </p>
        </div>
      )}

      {showUploader && (
        <div className="flex flex-col gap-3">
          {status === "none" && (
            <p className="font-lato text-text-muted text-sm">
              Hold a valid OKU (Orang Kurang Upaya) card? Upload it to get
              verified and unlock OKU fee tiers and prize categories.
            </p>
          )}
          <input
            type="file"
            accept={ACCEPT}
            aria-label="OKU card file"
            onChange={(e) => {
              setFile(e.target.files?.[0] ?? null);
              setError(null);
            }}
            className="font-lato text-text-secondary text-sm"
          />
          <SensitiveDataConsent
            category="health"
            checked={consented}
            disabled={submitting}
            onChange={(checked) => {
              setConsented(checked);
              setError(null);
            }}
          />
          {error && !confirmingWithdraw && (
            <p className="font-lato text-sm text-red-400">{error}</p>
          )}
          <button
            type="button"
            onClick={handleSubmit}
            disabled={submitting || !file || !consented}
            className="btn-primary w-fit rounded-md"
          >
            {submitting ? "Submitting…" : "Submit for verification"}
          </button>
        </div>
      )}

      {canWithdraw && (
        <div className="border-border mt-4 border-t pt-4">
          {confirmingWithdraw ? (
            <div className="flex flex-col gap-3">
              <p className="font-lato text-text-secondary text-sm">
                This deletes your OKU card and removes your OKU verification.
                You won&apos;t be able to register for OKU fee categories until
                you upload a card and are verified again. Entries you have
                already paid for are not affected.
              </p>
              {error && (
                <p className="font-lato text-sm text-red-400">{error}</p>
              )}
              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="btn-secondary w-fit rounded-md"
                  onClick={() => {
                    setConfirmingWithdraw(false);
                    setError(null);
                  }}
                  disabled={withdrawing}
                >
                  Keep my OKU card
                </button>
                <button
                  type="button"
                  className="btn-primary w-fit rounded-md"
                  onClick={handleWithdraw}
                  disabled={withdrawing}
                >
                  {withdrawing ? "Withdrawing…" : "Withdraw and delete"}
                </button>
              </div>
            </div>
          ) : (
            <button
              type="button"
              className="font-lato text-text-muted hover:text-text-secondary text-sm underline"
              onClick={() => {
                setConfirmingWithdraw(true);
                setError(null);
              }}
            >
              Withdraw consent and delete my OKU card
            </button>
          )}
        </div>
      )}
    </div>
  );
}
