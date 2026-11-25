"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { CountryDropdown } from "@/components/ui/country-dropdown";
import { isUnderAdultAge } from "@/lib/auth/adult-age";
import { getTodayInTimeZone } from "@/lib/tournaments/datetime";
import {
  ADULT_HELPER_RELATIONSHIPS,
  CONTACT_EMAIL_RE,
  MAX_DEPENDENT_NAME_LENGTH,
  MINOR_RELATIONSHIPS,
  RELATIONSHIP_LABELS,
  type GuardianshipBasis,
  type GuardianshipRelationship,
} from "@/lib/guardianship/dependent-options";
import { createDependent, type CreatedDependent } from "./dependents-api";

const BASIS_CHOICES: {
  value: GuardianshipBasis;
  label: string;
  hint: string;
}[] = [
  {
    value: "minor",
    label: "My child under 18",
    hint: "You are their parent or legal guardian.",
  },
  {
    value: "authorised",
    label: "An adult I help, with their permission",
    hint: "For example, you are a carer and the player has asked you to manage their entries.",
  },
];

interface FormState {
  basis: GuardianshipBasis | null;
  relationship: GuardianshipRelationship | "";
  firstName: string;
  lastName: string;
  dateOfBirth: string;
  gender: "male" | "female" | "";
  nationality: string;
  contactEmail: string;
  acceptTerms: boolean;
  authorisedByPlayer: boolean;
}

const EMPTY: FormState = {
  basis: null,
  relationship: "",
  firstName: "",
  lastName: "",
  dateOfBirth: "",
  gender: "",
  nationality: "",
  contactEmail: "",
  acceptTerms: false,
  authorisedByPlayer: false,
};

type FieldErrors = Partial<
  Record<
    | "relationship"
    | "firstName"
    | "lastName"
    | "dateOfBirth"
    | "contactEmail"
    | "acceptTerms"
    | "authorisedByPlayer",
    string
  >
>;

function relationshipsFor(
  basis: GuardianshipBasis,
): readonly GuardianshipRelationship[] {
  return basis === "minor" ? MINOR_RELATIONSHIPS : ADULT_HELPER_RELATIONSHIPS;
}

function validate(form: FormState): FieldErrors {
  const errors: FieldErrors = {};
  if (!form.relationship) errors.relationship = "Choose who they are to you.";
  for (const [key, label] of [
    ["firstName", "first name"],
    ["lastName", "last name"],
  ] as const) {
    const value = form[key].trim();
    if (!value) errors[key] = `Enter their ${label}.`;
    else if (value.length > MAX_DEPENDENT_NAME_LENGTH)
      errors[key] =
        `Their ${label} must be ${MAX_DEPENDENT_NAME_LENGTH} characters or fewer.`;
  }
  if (!form.dateOfBirth) {
    errors.dateOfBirth = "Enter their date of birth.";
  } else if (form.dateOfBirth > getTodayInTimeZone()) {
    errors.dateOfBirth = "The date of birth can't be in the future.";
  } else if (form.basis === "minor" && !isUnderAdultAge(form.dateOfBirth)) {
    errors.dateOfBirth =
      "This date of birth makes them 18 or over. Add them as an adult you help instead.";
  } else if (form.basis === "authorised" && isUnderAdultAge(form.dateOfBirth)) {
    errors.dateOfBirth =
      "This date of birth makes them under 18. Only their parent or legal guardian can add them, as a child under 18.";
  }
  if (
    form.basis === "authorised" &&
    form.contactEmail.trim() &&
    !CONTACT_EMAIL_RE.test(form.contactEmail.trim())
  ) {
    errors.contactEmail = "Enter a valid email address, or leave it empty.";
  }
  if (!form.acceptTerms) errors.acceptTerms = "Accept the Terms to continue.";
  if (form.basis === "authorised" && !form.authorisedByPlayer) {
    errors.authorisedByPlayer =
      "Confirm that the player has authorised you to act for them.";
  }
  return errors;
}

function buildBody(form: FormState): Record<string, unknown> {
  const adult = form.basis === "authorised";
  return {
    basis: form.basis,
    relationship: form.relationship,
    first_name: form.firstName.trim(),
    last_name: form.lastName.trim(),
    date_of_birth: form.dateOfBirth,
    gender: form.gender || null,
    nationality: form.nationality || null,
    contact_email: adult ? form.contactEmail.trim() || null : null,
    accept_terms: form.acceptTerms,
    ...(adult ? { authorised_by_player: form.authorisedByPlayer } : {}),
  };
}

function FieldError({
  id,
  message,
  className = "",
}: {
  id: string;
  message?: string;
  className?: string;
}) {
  if (!message) return null;
  return (
    <p id={id} className={`input-hint error ${className}`.trim()}>
      {message}
    </p>
  );
}

export default function AddDependentForm({
  onAdded,
  onCancel,
}: {
  onAdded: (dependent: CreatedDependent) => void;
  onCancel: () => void;
}) {
  const [form, setForm] = useState<FormState>(EMPTY);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [submitError, setSubmitError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const legendRef = useRef<HTMLLegendElement>(null);
  const summaryRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    legendRef.current?.focus();
  }, []);

  function set<K extends keyof FormState>(key: K, value: FormState[K]) {
    setForm((f) => ({ ...f, [key]: value }));
  }

  function chooseBasis(basis: GuardianshipBasis) {
    setForm((f) => ({
      ...f,
      basis,
      relationship:
        f.relationship && relationshipsFor(basis).includes(f.relationship)
          ? f.relationship
          : "",
      authorisedByPlayer: false,
    }));
    setErrors({});
    setSubmitError(null);
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (saving) return;
    const found = validate(form);
    setErrors(found);
    if (Object.keys(found).length > 0) {
      setSubmitError("Please fix the highlighted fields.");
      summaryRef.current?.focus();
      return;
    }
    setSaving(true);
    setSubmitError(null);
    const result = await createDependent(buildBody(form));
    setSaving(false);
    if (result.ok) {
      onAdded(result.data);
    } else {
      setSubmitError(result.error);
      summaryRef.current?.focus();
    }
  }

  const playerName = form.firstName.trim() || "this player";
  const isMinor = form.basis === "minor";
  const isAdult = form.basis === "authorised";
  const describedBy = (field: keyof FieldErrors, hint?: string) =>
    [errors[field] ? `${field}-error` : null, hint].filter(Boolean).join(" ") ||
    undefined;

  return (
    <form
      onSubmit={handleSubmit}
      noValidate
      className="card p-6"
      aria-labelledby="add-dependent-heading"
    >
      <h2
        id="add-dependent-heading"
        className="font-cinzel text-text-primary border-border mb-4 border-b pb-3 text-base font-semibold tracking-wider"
      >
        Add a Dependent
      </h2>

      <div ref={summaryRef} tabIndex={-1} className="outline-none">
        {submitError && (
          <div className="error-banner" role="alert">
            <p className="error-text">{submitError}</p>
          </div>
        )}
      </div>

      <fieldset className="form-group">
        <legend
          ref={legendRef}
          tabIndex={-1}
          className="input-label mb-2 outline-none"
        >
          Who is the player to you?
        </legend>
        <div className="flex flex-col gap-3">
          {BASIS_CHOICES.map((choice) => (
            <label
              key={choice.value}
              className={`border-border flex cursor-pointer items-start gap-3 rounded-md border p-3 ${form.basis === choice.value ? "border-gold-bright bg-int-gold-bg" : ""}`}
            >
              <input
                type="radio"
                name="basis"
                value={choice.value}
                checked={form.basis === choice.value}
                onChange={() => chooseBasis(choice.value)}
                aria-describedby={`basis-${choice.value}-hint`}
                className="mt-1"
              />
              <span>
                <span className="font-lato text-text-primary block text-sm">
                  {choice.label}
                </span>
                <span
                  id={`basis-${choice.value}-hint`}
                  className="font-lato text-text-muted block text-xs"
                >
                  {choice.hint}
                </span>
              </span>
            </label>
          ))}
        </div>
      </fieldset>

      {form.basis && (
        <>
          <div className="form-group">
            <div className="label-row">
              <label className="input-label" htmlFor="dep-relationship">
                You are their
              </label>
            </div>
            <select
              id="dep-relationship"
              className={`input ${errors.relationship ? "input-error" : ""}`}
              value={form.relationship}
              onChange={(e) =>
                set(
                  "relationship",
                  e.target.value as GuardianshipRelationship | "",
                )
              }
              aria-invalid={Boolean(errors.relationship)}
              aria-describedby={describedBy("relationship")}
            >
              <option value="">Select…</option>
              {relationshipsFor(form.basis).map((value) => (
                <option key={value} value={value}>
                  {RELATIONSHIP_LABELS[value]}
                </option>
              ))}
            </select>
            <FieldError id="relationship-error" message={errors.relationship} />
          </div>

          <div className="input-row">
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="dep-first-name">
                  First name
                </label>
              </div>
              <input
                id="dep-first-name"
                className={`input ${errors.firstName ? "input-error" : ""}`}
                value={form.firstName}
                onChange={(e) => set("firstName", e.target.value)}
                maxLength={MAX_DEPENDENT_NAME_LENGTH}
                autoComplete="off"
                aria-invalid={Boolean(errors.firstName)}
                aria-describedby={describedBy("firstName", "dep-name-hint")}
              />
              <FieldError id="firstName-error" message={errors.firstName} />
            </div>
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="dep-last-name">
                  Last name
                </label>
              </div>
              <input
                id="dep-last-name"
                className={`input ${errors.lastName ? "input-error" : ""}`}
                value={form.lastName}
                onChange={(e) => set("lastName", e.target.value)}
                maxLength={MAX_DEPENDENT_NAME_LENGTH}
                autoComplete="off"
                aria-invalid={Boolean(errors.lastName)}
                aria-describedby={describedBy("lastName", "dep-name-hint")}
              />
              <FieldError id="lastName-error" message={errors.lastName} />
            </div>
          </div>
          <p id="dep-name-hint" className="input-hint -mt-2 mb-4">
            As on their MyKad, MyKid or passport. Names can&apos;t be changed
            later without contacting support.
          </p>

          <div className="form-group">
            <div className="label-row">
              <label className="input-label" htmlFor="dep-dob">
                Date of birth
              </label>
            </div>
            <input
              id="dep-dob"
              type="date"
              className={`input ${errors.dateOfBirth ? "input-error" : ""}`}
              value={form.dateOfBirth}
              max={getTodayInTimeZone()}
              onChange={(e) => set("dateOfBirth", e.target.value)}
              aria-invalid={Boolean(errors.dateOfBirth)}
              aria-describedby={describedBy("dateOfBirth", "dep-dob-hint")}
            />
            <p id="dep-dob-hint" className="input-hint">
              Used for age categories. It can&apos;t be changed later.
            </p>
            <FieldError id="dateOfBirth-error" message={errors.dateOfBirth} />
          </div>

          <div className="input-row">
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="dep-gender">
                  Gender
                </label>
                <span className="label-optional">(Optional)</span>
              </div>
              <select
                id="dep-gender"
                className="input"
                value={form.gender}
                onChange={(e) =>
                  set("gender", e.target.value as FormState["gender"])
                }
              >
                <option value="">Select…</option>
                <option value="male">Male</option>
                <option value="female">Female</option>
              </select>
            </div>
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="dep-nationality">
                  Nationality
                </label>
                <span className="label-optional">(Optional)</span>
              </div>
              <CountryDropdown
                id="dep-nationality"
                placeholder="Select country"
                onChange={(c) => set("nationality", c.name)}
              />
            </div>
          </div>

          {isAdult && (
            <div className="form-group">
              <div className="label-row">
                <label className="input-label" htmlFor="dep-contact-email">
                  Their email
                </label>
                <span className="label-optional">(Optional)</span>
              </div>
              <input
                id="dep-contact-email"
                type="email"
                className={`input ${errors.contactEmail ? "input-error" : ""}`}
                value={form.contactEmail}
                onChange={(e) => set("contactEmail", e.target.value)}
                autoComplete="off"
                aria-invalid={Boolean(errors.contactEmail)}
                aria-describedby={describedBy(
                  "contactEmail",
                  "dep-contact-email-hint",
                )}
              />
              <p id="dep-contact-email-hint" className="input-hint">
                We copy them on emails about their entries. It doesn&apos;t give
                them a login.
              </p>
              <FieldError
                id="contactEmail-error"
                message={errors.contactEmail}
              />
            </div>
          )}

          {isAdult && (
            <div className="check-row">
              <input
                id="dep-authorised"
                type="checkbox"
                className="checkbox"
                checked={form.authorisedByPlayer}
                onChange={(e) => set("authorisedByPlayer", e.target.checked)}
                aria-invalid={Boolean(errors.authorisedByPlayer)}
                aria-describedby={describedBy("authorisedByPlayer")}
              />
              <label
                className={`check-label ${errors.authorisedByPlayer ? "mb-0" : ""}`}
                htmlFor="dep-authorised"
              >
                {playerName} has authorised me to register them for tournaments,
                pay for their entries and manage their player profile for them.
              </label>
            </div>
          )}
          {isAdult && (
            <FieldError
              id="authorisedByPlayer-error"
              message={errors.authorisedByPlayer}
              className="mb-4"
            />
          )}

          <div className="check-row">
            <input
              id="dep-terms"
              type="checkbox"
              className="checkbox"
              checked={form.acceptTerms}
              onChange={(e) => set("acceptTerms", e.target.checked)}
              aria-invalid={Boolean(errors.acceptTerms)}
              aria-describedby={describedBy("acceptTerms")}
            />
            <label
              className={`check-label ${errors.acceptTerms ? "mb-0" : ""}`}
              htmlFor="dep-terms"
            >
              {isMinor
                ? `As ${playerName}'s parent or legal guardian, I accept the `
                : `I'll act for ${playerName} under the `}
              <Link href="/terms" target="_blank">
                Terms
              </Link>{" "}
              and{" "}
              <Link href="/privacy" target="_blank">
                Privacy Policy
              </Link>
              {isMinor
                ? " on their behalf, and I'm responsible for their use of MY Chess Tour."
                : ", only as they authorise."}
            </label>
          </div>
          <FieldError
            id="acceptTerms-error"
            message={errors.acceptTerms}
            className="mb-4"
          />
        </>
      )}

      <div className="mt-2 flex flex-col gap-3 sm:flex-row">
        <button
          type="button"
          className="btn-secondary px-6"
          onClick={onCancel}
          disabled={saving}
        >
          Cancel
        </button>
        {(isMinor || isAdult) && (
          <button
            type="submit"
            className="btn-primary px-6 sm:w-fit"
            disabled={saving}
          >
            {saving ? "Adding…" : "Add Dependent"}
          </button>
        )}
      </div>
    </form>
  );
}
