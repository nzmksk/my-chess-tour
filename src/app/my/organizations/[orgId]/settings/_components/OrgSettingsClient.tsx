"use client";

import { useState } from "react";
import Link from "next/link";
import Image from "next/image";
import { useRouter } from "next/navigation";
import { createClient } from "@/services/supabase/client";
import BankAccountFields, {
  normalizeAccountNumber,
  validateBankAccount,
  type BankAccountValues,
} from "@/components/BankAccountFields";
import { MALAYSIAN_BANKS } from "@/lib/malaysian-banks";
import type {
  MaskedBankAccount,
  OrgDocumentSummary,
  OrgProfile,
} from "../page";

const AVATAR_ACCEPT = "image/png,image/jpeg,image/webp";
const AVATAR_MAX_BYTES = 2 * 1024 * 1024;

const ENTITY_LABELS: Record<string, string> = {
  company: "Company (Sdn Bhd / Enterprise)",
  society: "Society / Association",
  individual: "Individual organizer",
};

const DOC_LABELS: Record<string, string> = {
  ssm: "SSM registration",
  ros: "ROS registration",
  authorization_letter: "Authorization letter",
  identity_document: "Identity document",
  other: "Other supporting document",
};

const BANK_STATUS: Record<
  MaskedBankAccount["status"],
  { label: string; className: string }
> = {
  pending: {
    label: "Awaiting verification",
    className: "bg-warning/15 text-warning border border-warning/20",
  },
  verified: {
    label: "Verified",
    className: "bg-success/10 text-success border border-success/20",
  },
  rejected: {
    label: "Rejected",
    className: "bg-danger/15 text-danger border border-danger/20",
  },
};

interface Props {
  organization: OrgProfile;
  bankAccount: MaskedBankAccount | null;
  canManageBank: boolean;
  documents: OrgDocumentSummary[];
}

function Card({
  title,
  description,
  children,
}: {
  title: string;
  description?: string;
  children: React.ReactNode;
}) {
  return (
    <section className="card mb-6 overflow-hidden">
      <div className="border-border bg-bg-raised border-b px-5 py-3">
        <h2 className="font-cinzel text-text-primary text-sm font-bold tracking-wide uppercase">
          {title}
        </h2>
        {description && (
          <p className="font-lato text-text-muted mt-1 text-xs">
            {description}
          </p>
        )}
      </div>
      <div className="px-5 py-5">{children}</div>
    </section>
  );
}

export default function OrgSettingsClient({
  organization,
  bankAccount,
  canManageBank,
  documents,
}: Props) {
  const router = useRouter();

  // ---- Profile -------------------------------------------------------------
  const [name, setName] = useState(organization.name);
  const [description, setDescription] = useState(organization.description ?? "");
  const [email, setEmail] = useState(organization.email ?? "");
  const [phone, setPhone] = useState(organization.phone ?? "");
  const [pastRefs, setPastRefs] = useState(
    organization.past_tournament_refs ?? "",
  );
  const [avatarUrl, setAvatarUrl] = useState(organization.avatar_url);
  const [avatarFile, setAvatarFile] = useState<File | null>(null);
  const [profileSaving, setProfileSaving] = useState(false);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileSaved, setProfileSaved] = useState(false);

  // ---- Bank account --------------------------------------------------------
  const [editingBank, setEditingBank] = useState(false);
  const [bank, setBank] = useState<BankAccountValues>({
    bankName: bankAccount?.bank_name ?? "",
    bankCode: bankAccount?.bank_code ?? "",
    accountHolder: bankAccount?.account_holder ?? "",
    accountNumber: "",
  });
  const [bankSaving, setBankSaving] = useState(false);
  const [bankError, setBankError] = useState<string | null>(null);

  async function handleProfileSave(e: React.FormEvent) {
    e.preventDefault();
    if (profileSaving) return;

    setProfileSaving(true);
    setProfileError(null);
    setProfileSaved(false);

    try {
      const payload: Record<string, unknown> = {
        name: name.trim(),
        description: description.trim() || null,
        email: email.trim(),
        phone: phone.trim() || null,
        past_tournament_refs: pastRefs.trim() || null,
      };

      if (avatarFile) {
        if (avatarFile.size > AVATAR_MAX_BYTES) {
          setProfileError("Logo must be 2MB or smaller.");
          return;
        }
        const supabase = createClient();
        const ext = avatarFile.name.split(".").pop()?.toLowerCase() ?? "png";
        // The org-scoped avatars policy (005_bucket_policies.sql) checks
        // has_org_permission(..., 'org.manage') on this folder segment.
        const path = `organizations/${organization.id}/${Date.now()}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("avatars")
          .upload(path, avatarFile, {
            upsert: true,
            cacheControl: "31536000",
          });

        if (uploadError) {
          setProfileError("Failed to upload the logo. Please try again.");
          return;
        }

        const {
          data: { publicUrl },
        } = supabase.storage.from("avatars").getPublicUrl(path);
        payload.avatar_url = publicUrl;
      }

      const res = await fetch(`/api/v1/organizations/${organization.id}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });

      const json = await res.json().catch(() => null);

      if (!res.ok) {
        setProfileError(
          json?.error?.message ?? "Save failed. Please try again.",
        );
        return;
      }

      if (typeof payload.avatar_url === "string") {
        setAvatarUrl(payload.avatar_url);
      }
      setAvatarFile(null);
      setProfileSaved(true);
      router.refresh();
    } catch {
      setProfileError("A network error occurred. Please try again.");
    } finally {
      setProfileSaving(false);
    }
  }

  async function handleBankSave() {
    if (bankSaving) return;

    const validationError = validateBankAccount(bank, {
      requireBankCode: true,
    });
    if (validationError) {
      setBankError(validationError);
      return;
    }

    setBankSaving(true);
    setBankError(null);

    try {
      const res = await fetch(
        `/api/v1/organizations/${organization.id}/bank-account`,
        {
          method: "PUT",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            bank_code: bank.bankCode,
            account_holder: bank.accountHolder.trim(),
            account_number: normalizeAccountNumber(bank.accountNumber),
          }),
        },
      );

      if (!res.ok) {
        const json = await res.json().catch(() => null);
        setBankError(json?.error?.message ?? "Save failed. Please try again.");
        return;
      }

      setEditingBank(false);
      setBank((prev) => ({ ...prev, accountNumber: "" }));
      router.refresh();
    } catch {
      setBankError("A network error occurred. Please try again.");
    } finally {
      setBankSaving(false);
    }
  }

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      <div className="mb-6 flex flex-wrap items-center gap-3">
        <Link
          href={`/my/organizations/${organization.id}`}
          className="font-lato text-text-muted hover:text-text-primary text-sm transition-colors"
        >
          ← Back
        </Link>
        <h1 className="font-cinzel text-text-primary text-2xl font-bold tracking-wide">
          Settings
        </h1>
      </div>

      {/* ---- Organization profile ---- */}
      <Card
        title="Organization Profile"
        description="What players see on your tournaments and your public page."
      >
        <form onSubmit={handleProfileSave}>
          {/* Image is `unoptimized` like every other remote avatar here: there
              is no next.config remotePatterns entry for the storage host. */}
          <div className="mb-5 flex items-center gap-4">
            {avatarUrl ? (
              <Image
                src={avatarUrl}
                alt=""
                width={64}
                height={64}
                unoptimized
                className="border-border h-16 w-16 rounded-full border object-cover"
              />
            ) : (
              <div className="border-border bg-bg-raised text-gold-bright flex h-16 w-16 items-center justify-center rounded-full border text-2xl">
                ♜
              </div>
            )}
            <div className="flex flex-col gap-1">
              <input
                type="file"
                accept={AVATAR_ACCEPT}
                aria-label="Organization logo"
                onChange={(e) => {
                  setAvatarFile(e.target.files?.[0] ?? null);
                  setProfileError(null);
                }}
                className="font-lato text-text-secondary text-sm"
              />
              <p className="font-lato text-text-muted text-xs">
                PNG, JPEG or WebP, up to 2MB.
              </p>
            </div>
          </div>

          <div className="form-group">
            <div className="label-row">
              <label className="input-label" htmlFor="org_name">
                Organization Name
              </label>
            </div>
            <input
              id="org_name"
              className="input"
              type="text"
              value={name}
              maxLength={255}
              onChange={(e) => {
                setName(e.target.value);
                setProfileError(null);
              }}
            />
          </div>

          <div className="form-group">
            <div className="label-row">
              <label className="input-label" htmlFor="org_description">
                Description
              </label>
            </div>
            <textarea
              id="org_description"
              className="input resize-y"
              rows={3}
              value={description}
              onChange={(e) => setDescription(e.target.value)}
            />
          </div>

          <div className="input-row">
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="org_email">
                  Email
                </label>
              </div>
              <input
                id="org_email"
                className="input"
                type="email"
                value={email}
                onChange={(e) => {
                  setEmail(e.target.value);
                  setProfileError(null);
                }}
              />
            </div>
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="org_phone">
                  Phone
                </label>
              </div>
              <input
                id="org_phone"
                className="input"
                type="tel"
                value={phone}
                maxLength={20}
                onChange={(e) => setPhone(e.target.value)}
              />
            </div>
          </div>

          <div className="form-group">
            <div className="label-row">
              <label className="input-label" htmlFor="org_past_refs">
                Past Tournament References
              </label>
            </div>
            <textarea
              id="org_past_refs"
              className="input resize-y"
              rows={3}
              value={pastRefs}
              onChange={(e) => setPastRefs(e.target.value)}
            />
          </div>

          {profileError && (
            <p className="font-lato text-error mb-3 text-sm" role="alert">
              {profileError}
            </p>
          )}
          {profileSaved && !profileError && (
            <p className="font-lato mb-3 text-sm text-emerald-400">
              Changes saved.
            </p>
          )}

          <button
            type="submit"
            className="btn-primary rounded-md"
            disabled={profileSaving}
          >
            {profileSaving ? "Saving…" : "Save Profile"}
          </button>
        </form>
      </Card>

      {/* ---- Payout bank account ---- */}
      {canManageBank && (
        <Card
          title="Payout Bank Account"
          description="Where your entry-fee revenue is paid out."
        >
          {!editingBank && bankAccount && (
            <div className="mb-4">
              <div className="mb-3 flex items-center gap-3">
                <span
                  className={`font-cinzel rounded-md px-2.5 py-1 text-xs font-bold tracking-widest uppercase ${BANK_STATUS[bankAccount.status].className}`}
                >
                  {BANK_STATUS[bankAccount.status].label}
                </span>
              </div>
              {bankAccount.status === "rejected" &&
                bankAccount.rejection_reason && (
                  <p className="font-lato text-danger mb-3 text-sm">
                    {bankAccount.rejection_reason}
                  </p>
                )}
              <dl className="font-lato text-sm">
                <div className="border-border grid grid-cols-[140px_1fr] border-b py-2">
                  <dt className="text-text-muted text-xs">Bank</dt>
                  <dd className="text-text-primary">{bankAccount.bank_name}</dd>
                </div>
                <div className="border-border grid grid-cols-[140px_1fr] border-b py-2">
                  <dt className="text-text-muted text-xs">Account Holder</dt>
                  <dd className="text-text-primary">
                    {bankAccount.account_holder}
                  </dd>
                </div>
                <div className="grid grid-cols-[140px_1fr] py-2">
                  <dt className="text-text-muted text-xs">Account Number</dt>
                  <dd className="text-text-primary">
                    •••• {bankAccount.account_number_last4}
                  </dd>
                </div>
              </dl>
            </div>
          )}

          {!editingBank && !bankAccount && (
            <p className="font-lato text-text-muted mb-4 text-sm">
              No bank account on file. Payouts cannot be made until one is
              added.
            </p>
          )}

          {!editingBank ? (
            <button
              type="button"
              className="btn-secondary rounded-md"
              onClick={() => {
                setEditingBank(true);
                setBankError(null);
              }}
            >
              {bankAccount ? "Change bank account" : "Add bank account"}
            </button>
          ) : (
            <>
              <p className="font-lato text-text-muted mb-4 text-xs">
                The account holder name must match your bank&apos;s records
                exactly — payouts fail otherwise, and the failed transfer is at
                your cost. Changing any detail sends the account back for
                verification.
              </p>
              <BankAccountFields
                values={bank}
                onChange={(patch) => {
                  setBank((prev) => ({ ...prev, ...patch }));
                  setBankError(null);
                }}
                banks={MALAYSIAN_BANKS}
                existingLast4={bankAccount?.account_number_last4 ?? null}
                idPrefix="org_bank"
                disabled={bankSaving}
              />

              {bankError && (
                <p className="font-lato text-error mb-3 text-sm" role="alert">
                  {bankError}
                </p>
              )}

              <div className="flex flex-col gap-2 sm:flex-row">
                <button
                  type="button"
                  className="btn-secondary w-full"
                  onClick={() => {
                    setEditingBank(false);
                    setBankError(null);
                  }}
                  disabled={bankSaving}
                >
                  Cancel
                </button>
                <button
                  type="button"
                  className="btn-primary w-full"
                  onClick={handleBankSave}
                  disabled={bankSaving}
                >
                  {bankSaving ? "Saving…" : "Save Bank Account"}
                </button>
              </div>
            </>
          )}
        </Card>
      )}

      {/* ---- Business verification (read-only) ---- */}
      <Card
        title="Business Verification"
        description="Reviewed when your application was approved."
      >
        <dl className="font-lato mb-4 text-sm">
          <div className="border-border grid grid-cols-[140px_1fr] border-b py-2">
            <dt className="text-text-muted text-xs">Entity Type</dt>
            <dd className="text-text-primary">
              {organization.entity_type
                ? (ENTITY_LABELS[organization.entity_type] ??
                  organization.entity_type)
                : "—"}
            </dd>
          </div>
          <div className="grid grid-cols-[140px_1fr] py-2">
            <dt className="text-text-muted text-xs">Registration No.</dt>
            <dd className="text-text-primary">
              {organization.registration_number ?? "—"}
            </dd>
          </div>
        </dl>

        {documents.length > 0 ? (
          <ul className="font-lato text-text-secondary space-y-1 text-sm">
            {documents.map((doc) => (
              <li key={doc.id}>
                <span className="text-text-muted">
                  {DOC_LABELS[doc.doc_type] ?? doc.doc_type}:
                </span>{" "}
                {doc.original_filename ?? "Uploaded document"}
              </li>
            ))}
          </ul>
        ) : (
          <p className="font-lato text-text-muted text-sm">
            No documents on file.
          </p>
        )}

        <p className="font-lato text-text-muted mt-4 text-xs">
          These details are fixed once your application has been reviewed —
          changing them would invalidate that review. Contact support if
          something here is wrong.
        </p>
      </Card>
    </div>
  );
}
