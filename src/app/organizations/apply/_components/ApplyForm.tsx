"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/services/supabase/client";
import BankAccountFields, {
  normalizeAccountNumber,
  validateBankAccount,
  type BankAccountValues,
} from "@/components/BankAccountFields";
import { MALAYSIAN_BANKS } from "@/lib/malaysian-banks";

const LINK_TYPES = [
  { value: "website", label: "Website" },
  { value: "facebook", label: "Facebook" },
  { value: "instagram", label: "Instagram" },
  { value: "x_twitter", label: "X (Twitter)" },
  { value: "youtube", label: "YouTube" },
  { value: "whatsapp", label: "WhatsApp" },
  { value: "telegram", label: "Telegram" },
  { value: "other", label: "Other" },
] as const;

interface LinkEntry {
  type: string;
  url: string;
}

type FormStatus = "idle" | "submitting" | "success" | "error";

interface PendingOrg {
  name: string;
}

type EntityType = "company" | "society" | "individual";

const ENTITY_TYPES: {
  value: EntityType;
  label: string;
  hint: string;
  registrationLabel: string | null;
  docLabel: string;
}[] = [
  {
    value: "company",
    label: "Company (Sdn Bhd / Enterprise)",
    hint: "Registered with SSM.",
    registrationLabel: "SSM Registration Number",
    docLabel: "SSM registration document",
  },
  {
    value: "society",
    label: "Society / Association",
    hint: "Registered with the Registry of Societies (ROS).",
    registrationLabel: "ROS Registration Number",
    docLabel: "ROS registration document",
  },
  {
    value: "individual",
    label: "Individual organizer",
    hint: "Organising in your own name, with no registered entity.",
    registrationLabel: null,
    docLabel: "identity document or authorization letter",
  },
];

// Document types offered per entity, first entry being the expected one.
const DOC_TYPES_BY_ENTITY: Record<
  EntityType,
  { value: string; label: string }[]
> = {
  company: [
    { value: "ssm", label: "SSM registration" },
    { value: "authorization_letter", label: "Authorization letter" },
    { value: "identity_document", label: "Identity document" },
    { value: "other", label: "Other supporting document" },
  ],
  society: [
    { value: "ros", label: "ROS registration" },
    { value: "authorization_letter", label: "Authorization letter" },
    { value: "identity_document", label: "Identity document" },
    { value: "other", label: "Other supporting document" },
  ],
  individual: [
    { value: "identity_document", label: "Identity document (MyKad/passport)" },
    { value: "authorization_letter", label: "Authorization letter" },
    { value: "other", label: "Other supporting document" },
  ],
};

const DOC_ACCEPT = "image/png,image/jpeg,image/webp,application/pdf";
const DOC_MAX_BYTES = 5 * 1024 * 1024; // 5MB — also enforced server-side
const MAX_DOCUMENTS = 10;

interface DocumentEntry {
  docType: string;
  file: File;
}

export default function ApplyForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [links, setLinks] = useState<LinkEntry[]>([]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pastTournamentRefs, setPastTournamentRefs] = useState("");
  const [bank, setBank] = useState<BankAccountValues>({
    bankName: "",
    bankCode: "",
    accountHolder: "",
    accountNumber: "",
  });
  const [entityType, setEntityType] = useState<EntityType>("company");
  const [registrationNumber, setRegistrationNumber] = useState("");
  const [documents, setDocuments] = useState<DocumentEntry[]>([]);
  const [agreementAccepted, setAgreementAccepted] = useState(false);
  const [status, setStatus] = useState<FormStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingOrg, setPendingOrg] = useState<PendingOrg | null>(null);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (status !== "success") return;
    if (countdown <= 0) {
      router.push("/my/organizations/applications");
      return;
    }
    const timer = setTimeout(() => setCountdown((c) => c - 1), 1000);
    return () => clearTimeout(timer);
  }, [status, countdown, router]);

  function addLink() {
    setLinks((prev) => [...prev, { type: "website", url: "" }]);
  }

  function removeLink(index: number) {
    setLinks((prev) => prev.filter((_, i) => i !== index));
  }

  function updateLink(index: number, field: keyof LinkEntry, value: string) {
    setLinks((prev) =>
      prev.map((link, i) => (i === index ? { ...link, [field]: value } : link)),
    );
  }

  const entityConfig =
    ENTITY_TYPES.find((t) => t.value === entityType) ?? ENTITY_TYPES[0];

  function addDocuments(files: FileList | null) {
    if (!files || files.length === 0) return;
    const defaultType = DOC_TYPES_BY_ENTITY[entityType][0].value;
    const accepted: DocumentEntry[] = [];

    for (const file of Array.from(files)) {
      if (file.size > DOC_MAX_BYTES) {
        setErrorMessage(`${file.name} is larger than 5MB.`);
        continue;
      }
      accepted.push({ docType: defaultType, file });
    }

    setDocuments((prev) => [...prev, ...accepted].slice(0, MAX_DOCUMENTS));
  }

  function removeDocument(index: number) {
    setDocuments((prev) => prev.filter((_, i) => i !== index));
  }

  function updateDocumentType(index: number, docType: string) {
    setDocuments((prev) =>
      prev.map((doc, i) => (i === index ? { ...doc, docType } : doc)),
    );
  }

  // Mirrors the entity rule the API and the RPC both enforce, so the applicant
  // is told what's missing before a round trip and an upload.
  function missingRequiredDocument(): string | null {
    if (documents.length === 0)
      return `Please upload your ${entityConfig.docLabel}.`;
    const types = documents.map((d) => d.docType);
    if (entityType === "individual") {
      return types.some(
        (t) => t === "identity_document" || t === "authorization_letter",
      )
        ? null
        : "Please include an identity document or authorization letter.";
    }
    const required = entityType === "company" ? "ssm" : "ros";
    return types.includes(required)
      ? null
      : `Please include your ${entityConfig.docLabel}.`;
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting") return;

    const bankError = validateBankAccount(bank, { requireBankCode: true });
    if (bankError) {
      setErrorMessage(bankError);
      setStatus("error");
      return;
    }

    if (entityType !== "individual" && !registrationNumber.trim()) {
      setErrorMessage(`Please enter your ${entityConfig.registrationLabel}.`);
      setStatus("error");
      return;
    }

    const documentError = missingRequiredDocument();
    if (documentError) {
      setErrorMessage(documentError);
      setStatus("error");
      return;
    }

    setStatus("submitting");
    setErrorMessage(null);

    const filteredLinks = links
      .filter((l) => l.url.trim() !== "")
      .map((l) => ({
        url: l.url.trim(),
        label: LINK_TYPES.find((t) => t.value === l.type)?.label ?? l.type,
      }));

    try {
      // Documents go browser→storage first; the POST registers their paths.
      // Storage RLS confines the write to this user's own folder, and the API
      // re-checks the prefix before recording anything. A submit that fails
      // after this point leaves the objects behind — the same trade-off the OKU
      // upload makes, and cheaper than a cleanup job for a rare case.
      const supabase = createClient();
      const {
        data: { user },
      } = await supabase.auth.getUser();

      if (!user) {
        setErrorMessage("Your session has expired. Please sign in again.");
        setStatus("error");
        return;
      }

      const uploaded: {
        doc_type: string;
        storage_path: string;
        original_filename: string;
      }[] = [];

      for (const [index, doc] of documents.entries()) {
        const ext = doc.file.name.split(".").pop()?.toLowerCase() ?? "bin";
        // The folder segment must be the public.users.id the storage policy
        // compares against via app_user_id(), which is what the session cookie
        // resolves to server-side. It equals the auth id for self-signup
        // accounts, which is every account that can reach this form.
        const path = `users/${user.id}/org-kyb/${Date.now()}-${index}.${ext}`;
        const { error: uploadError } = await supabase.storage
          .from("organization-documents")
          .upload(path, doc.file, { upsert: true });

        if (uploadError) {
          setErrorMessage(`Failed to upload ${doc.file.name}. Please retry.`);
          setStatus("error");
          return;
        }

        uploaded.push({
          doc_type: doc.docType,
          storage_path: path,
          original_filename: doc.file.name,
        });
      }

      const res = await fetch("/api/v1/organizations/applications", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          description: description.trim() || null,
          links: filteredLinks.length > 0 ? filteredLinks : null,
          email: email.trim(),
          phone: phone.trim() || null,
          past_tournament_refs: pastTournamentRefs.trim() || null,
          entity_type: entityType,
          registration_number:
            entityType === "individual" ? null : registrationNumber.trim(),
          // Only the SWIFT code — the server derives the bank's display name,
          // so the stored name can't contradict the code.
          bank_code: bank.bankCode,
          bank_account_holder: bank.accountHolder.trim(),
          bank_account_number: normalizeAccountNumber(bank.accountNumber),
          documents: uploaded,
          // The version this is recorded against is the server's, not ours.
          agreement_accepted: agreementAccepted,
        }),
      });

      const json = await res.json();

      if (res.ok) {
        setPendingOrg({ name: json.data.name });
        setStatus("success");
      } else {
        setErrorMessage(
          json.error?.message ?? "Submission failed. Please try again.",
        );
        setStatus("error");
      }
    } catch {
      setErrorMessage("A network error occurred. Please try again.");
      setStatus("error");
    }
  }

  if (status === "success" && pendingOrg) {
    return (
      <div className="mx-auto max-w-lg py-16 text-center">
        <div className="bg-warning-bg mx-auto mb-5 flex h-16 w-16 items-center justify-center rounded-full text-3xl">
          ⏳
        </div>
        <h1 className="font-cinzel text-text-primary mb-2 text-xl font-semibold">
          Application Submitted
        </h1>
        <p className="font-lato text-text-secondary mb-2 text-sm">
          Your application for{" "}
          <strong className="text-text-primary">{pendingOrg.name}</strong> is
          under review. We&apos;ll notify you by email once it&apos;s been
          processed.
        </p>
        <p className="font-lato text-text-muted mb-8 text-xs">
          Typically reviewed within 1–2 business days.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => router.push("/my/organizations/applications")}
            className="btn-primary w-full rounded-md"
          >
            View My Organizations
            <span className="font-lato ml-2 text-xs opacity-70">
              ({countdown}s)
            </span>
          </button>
          <button
            onClick={() => router.push("/tournaments")}
            className="btn-secondary w-full rounded-md"
          >
            Back to Tournaments
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="mx-auto max-w-lg">
      <div className="mb-6">
        <h1 className="font-cinzel text-text-primary text-xl font-semibold tracking-wider">
          Apply as Tournament Organizer
        </h1>
        <p className="font-lato text-text-muted mt-1 text-sm">
          Fill in your organization details. Your application will be reviewed
          by our admin team.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Organization Name */}
        <div className="flex flex-col gap-1.5">
          <label className="font-lato text-text-secondary text-sm font-medium">
            Organization Name <span className="text-error">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., KL Chess Association"
            required
            className="border-border bg-bg-raised font-lato text-text-primary placeholder:text-text-disabled focus:border-gold-bright w-full rounded-md border px-3 py-2.5 text-sm transition-colors focus:outline-none"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="font-lato text-text-secondary text-sm font-medium">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell us about your organization and chess activities..."
            rows={3}
            className="border-border bg-bg-raised font-lato text-text-primary placeholder:text-text-disabled focus:border-gold-bright w-full resize-y rounded-md border px-3 py-2.5 text-sm transition-colors focus:outline-none"
          />
        </div>

        {/* Links */}
        <div className="flex flex-col gap-1.5">
          <label className="font-lato text-text-secondary text-sm font-medium">
            Links
          </label>
          <div className="flex flex-col gap-2">
            {links.map((link, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  value={link.type}
                  aria-label={`Link type ${index + 1}`}
                  onChange={(e) => updateLink(index, "type", e.target.value)}
                  className="border-border bg-bg-raised font-lato text-text-primary focus:border-gold-bright w-36 shrink-0 cursor-pointer appearance-none rounded-md border px-2 py-2.5 text-sm transition-colors focus:outline-none"
                >
                  {LINK_TYPES.map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <input
                  type="url"
                  value={link.url}
                  onChange={(e) => updateLink(index, "url", e.target.value)}
                  placeholder="https://..."
                  className="border-border bg-bg-raised font-lato text-text-primary placeholder:text-text-disabled focus:border-gold-bright flex-1 rounded-md border px-3 py-2.5 text-sm transition-colors focus:outline-none"
                />
                <button
                  type="button"
                  onClick={() => removeLink(index)}
                  className="border-border text-text-muted hover:border-danger hover:text-danger hover:bg-danger-bg flex h-10 w-9 shrink-0 items-center justify-center rounded-md border text-base transition-colors"
                  aria-label="Remove link"
                >
                  ×
                </button>
              </div>
            ))}
          </div>
          <button
            type="button"
            onClick={addLink}
            className="font-lato text-gold-bright border-border hover:border-gold-bright hover:bg-gold-ghost self-start rounded-md border border-dashed px-3 py-2 text-sm font-medium transition-colors"
          >
            + Add Link
          </button>
        </div>

        {/* Contact info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="font-lato text-text-secondary text-sm font-medium">
              Email <span className="text-error">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="chess@org.com"
              required
              className="border-border bg-bg-raised font-lato text-text-primary placeholder:text-text-disabled focus:border-gold-bright w-full rounded-md border px-3 py-2.5 text-sm transition-colors focus:outline-none"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-lato text-text-secondary text-sm font-medium">
              Phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+60..."
              className="border-border bg-bg-raised font-lato text-text-primary placeholder:text-text-disabled focus:border-gold-bright w-full rounded-md border px-3 py-2.5 text-sm transition-colors focus:outline-none"
            />
          </div>
        </div>

        {/* Past tournament references */}
        <div className="flex flex-col gap-1.5">
          <label className="font-lato text-text-secondary text-sm font-medium">
            Past Tournament References
          </label>
          <textarea
            value={pastTournamentRefs}
            onChange={(e) => setPastTournamentRefs(e.target.value)}
            placeholder="List any tournaments you've previously organized (names, dates, approximate participants)..."
            rows={3}
            className="border-border bg-bg-raised font-lato text-text-primary placeholder:text-text-disabled focus:border-gold-bright w-full resize-y rounded-md border px-3 py-2.5 text-sm transition-colors focus:outline-none"
          />
          <p className="font-lato text-text-muted text-xs">
            Optional — helps speed up the approval process.
          </p>
        </div>

        {/* Payout bank account */}
        <fieldset className="border-border rounded-md border p-4">
          <legend className="font-cinzel text-text-primary px-2 text-sm font-semibold tracking-wider">
            Payout Bank Account
          </legend>
          <p className="font-lato text-text-muted mb-4 text-xs">
            Where your entry-fee revenue is paid out. The account holder name
            must match your bank&apos;s records exactly — payouts fail
            otherwise, and the failed transfer is at your cost.
          </p>
          <BankAccountFields
            values={bank}
            onChange={(patch) => {
              setBank((prev) => ({ ...prev, ...patch }));
              setErrorMessage(null);
            }}
            banks={MALAYSIAN_BANKS}
            idPrefix="org_bank"
            disabled={status === "submitting"}
          />
        </fieldset>

        {/* Entity & verification documents */}
        <fieldset className="border-border rounded-md border p-4">
          <legend className="font-cinzel text-text-primary px-2 text-sm font-semibold tracking-wider">
            Entity &amp; Documents
          </legend>
          <p className="font-lato text-text-muted mb-4 text-xs">
            We verify who is receiving the money before any payout is made.
            These documents are private, visible only to our review team.
          </p>

          <div className="mb-4 flex flex-col gap-2">
            {ENTITY_TYPES.map((type) => (
              <label
                key={type.value}
                className="font-lato text-text-secondary flex cursor-pointer items-start gap-2 text-sm"
              >
                <input
                  type="radio"
                  name="entity_type"
                  value={type.value}
                  checked={entityType === type.value}
                  onChange={() => {
                    setEntityType(type.value);
                    setErrorMessage(null);
                  }}
                  className="mt-1"
                />
                <span>
                  {type.label}
                  <span className="text-text-muted block text-xs">
                    {type.hint}
                  </span>
                </span>
              </label>
            ))}
          </div>

          {entityConfig.registrationLabel && (
            <div className="mb-4 flex flex-col gap-1.5">
              <label
                className="font-lato text-text-secondary text-sm font-medium"
                htmlFor="registration_number"
              >
                {entityConfig.registrationLabel}{" "}
                <span className="text-error">*</span>
              </label>
              <input
                id="registration_number"
                type="text"
                value={registrationNumber}
                onChange={(e) => {
                  setRegistrationNumber(e.target.value);
                  setErrorMessage(null);
                }}
                placeholder="e.g. 202001234567 (1234567-A)"
                maxLength={100}
                className="border-border bg-bg-raised font-lato text-text-primary placeholder:text-text-disabled focus:border-gold-bright w-full rounded-md border px-3 py-2.5 text-sm transition-colors focus:outline-none"
              />
            </div>
          )}

          <div className="flex flex-col gap-2">
            <label
              className="font-lato text-text-secondary text-sm font-medium"
              htmlFor="kyb_documents"
            >
              Verification Documents <span className="text-error">*</span>
            </label>

            {documents.map((doc, index) => (
              <div key={index} className="flex items-center gap-2">
                <select
                  value={doc.docType}
                  aria-label={`Document type for ${doc.file.name}`}
                  onChange={(e) => updateDocumentType(index, e.target.value)}
                  className="border-border bg-bg-raised font-lato text-text-primary focus:border-gold-bright w-44 shrink-0 cursor-pointer appearance-none rounded-md border px-2 py-2.5 text-sm transition-colors focus:outline-none"
                >
                  {DOC_TYPES_BY_ENTITY[entityType].map((t) => (
                    <option key={t.value} value={t.value}>
                      {t.label}
                    </option>
                  ))}
                </select>
                <span className="font-lato text-text-secondary flex-1 truncate text-sm">
                  {doc.file.name}
                </span>
                <button
                  type="button"
                  onClick={() => removeDocument(index)}
                  className="border-border text-text-muted hover:border-danger hover:text-danger hover:bg-danger-bg flex h-10 w-9 shrink-0 items-center justify-center rounded-md border text-base transition-colors"
                  aria-label={`Remove ${doc.file.name}`}
                >
                  ×
                </button>
              </div>
            ))}

            <input
              id="kyb_documents"
              type="file"
              multiple
              accept={DOC_ACCEPT}
              aria-label="Verification documents"
              disabled={documents.length >= MAX_DOCUMENTS}
              onChange={(e) => {
                addDocuments(e.target.files);
                // Reset so re-picking the same file fires onChange again.
                e.target.value = "";
              }}
              className="font-lato text-text-secondary text-sm"
            />
            <p className="font-lato text-text-muted text-xs">
              PDF or image, up to 5MB each. Required: your{" "}
              {entityConfig.docLabel}.
            </p>
          </div>
        </fieldset>

        {/* Organizer Agreement */}
        <div className="check-row">
          <input
            id="agreement"
            type="checkbox"
            className="checkbox"
            checked={agreementAccepted}
            onChange={(e) => setAgreementAccepted(e.target.checked)}
            aria-label="I have read and accept the Organizer Agreement"
          />
          <label className="check-label" htmlFor="agreement">
            I have read and accept the{" "}
            <a
              href="/organizer-agreement"
              target="_blank"
              rel="noopener noreferrer"
              className="modal-trigger-link"
            >
              Organizer Agreement
            </a>{" "}
            on behalf of this organization.
          </label>
        </div>
        <p className="font-lato text-text-muted -mt-3 text-xs">
          It covers how entry fees are collected, how and when payouts are made,
          and what happens if a tournament is cancelled after you have been
          paid.
        </p>

        {/* Error */}
        {status === "error" && errorMessage && (
          <p className="font-lato text-error text-center text-sm">
            {errorMessage}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={status === "submitting" || !agreementAccepted}
          className="btn-primary w-full rounded-md"
        >
          {status === "submitting" ? "Submitting…" : "Submit Application"}
        </button>
      </form>
    </div>
  );
}
