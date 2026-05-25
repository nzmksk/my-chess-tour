"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { BasicInfoData } from "../TournamentWizardContext";
import { useTournamentWizard } from "../TournamentWizardContext";

const MALAYSIAN_STATES = [
  "Johor",
  "Kedah",
  "Kelantan",
  "Melaka",
  "Negeri Sembilan",
  "Pahang",
  "Perak",
  "Perlis",
  "Pulau Pinang",
  "Sabah",
  "Sarawak",
  "Selangor",
  "Terengganu",
  "W.P. Kuala Lumpur",
  "W.P. Labuan",
  "W.P. Putrajaya",
];

const MAX_POSTER_BYTES = 5 * 1024 * 1024;

type NameStatus = "idle" | "checking" | "available" | "taken" | "error";

type FieldErrors = {
  name?: string;
  venueName?: string;
  venueState?: string;
  venueAddress?: string;
  posterFile?: string;
};

async function checkNameAvailability(name: string): Promise<NameStatus> {
  try {
    const res = await fetch(
      `/api/v1/tournaments/name-check?name=${encodeURIComponent(name)}`,
    );
    if (!res.ok) return "error";
    const json = await res.json();
    return json.available ? "available" : "taken";
  } catch {
    return "error";
  }
}

function validate(
  data: BasicInfoData,
  nameStatus: NameStatus,
): FieldErrors {
  const errors: FieldErrors = {};

  if (!data.name.trim()) {
    errors.name = "Tournament name is required.";
  } else if (nameStatus === "taken") {
    errors.name = "A tournament with this name already exists.";
  } else if (nameStatus === "error") {
    errors.name = "Could not verify name uniqueness. Please try again.";
  }

  if (!data.venueName.trim()) {
    errors.venueName = "Venue name is required.";
  }
  if (!data.venueState) {
    errors.venueState = "State is required.";
  }
  if (!data.venueAddress.trim()) {
    errors.venueAddress = "Venue address is required.";
  }

  return errors;
}

export default function BasicInfoStep() {
  const { setBasicInfoData, basicInfoData, goNext, registerStepHandler } =
    useTournamentWizard();

  const [form, setForm] = useState<BasicInfoData>(basicInfoData);
  const [nameStatus, setNameStatus] = useState<NameStatus>("idle");
  const [errors, setErrors] = useState<FieldErrors>({});
  const [showErrors, setShowErrors] = useState(false);
  const [posterPreview, setPosterPreview] = useState<string | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const nameCheckTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const dragCounter = useRef(0);
  const [dragging, setDragging] = useState(false);

  const handleNameChange = (value: string) => {
    setForm((f) => ({ ...f, name: value }));
    setNameStatus("idle");

    if (nameCheckTimer.current) clearTimeout(nameCheckTimer.current);

    if (!value.trim()) return;

    nameCheckTimer.current = setTimeout(async () => {
      setNameStatus("checking");
      const status = await checkNameAvailability(value.trim());
      setNameStatus(status);
    }, 600);
  };

  const handlePosterFile = useCallback((file: File) => {
    if (!file.type.startsWith("image/")) {
      setErrors((e) => ({ ...e, posterFile: "Only image files are accepted." }));
      return;
    }
    if (file.size > MAX_POSTER_BYTES) {
      setErrors((e) => ({ ...e, posterFile: "File must be under 5 MB." }));
      return;
    }
    setErrors((e) => ({ ...e, posterFile: undefined }));
    setForm((f) => ({ ...f, posterFile: file }));
    const url = URL.createObjectURL(file);
    setPosterPreview(url);
  }, []);

  const handleFileInput = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) handlePosterFile(file);
  };

  const handleDrop = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current = 0;
    setDragging(false);
    const file = e.dataTransfer.files?.[0];
    if (file) handlePosterFile(file);
  };

  const handleDragEnter = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current += 1;
    setDragging(true);
  };

  const handleDragLeave = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    dragCounter.current -= 1;
    if (dragCounter.current === 0) setDragging(false);
  };

  const handleDragOver = (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
  };

  const removePoster = () => {
    setForm((f) => ({ ...f, posterFile: null }));
    setPosterPreview(null);
    if (fileInputRef.current) fileInputRef.current.value = "";
    setErrors((e) => ({ ...e, posterFile: undefined }));
  };

  useEffect(() => {
    return () => {
      if (posterPreview) URL.revokeObjectURL(posterPreview);
    };
  }, [posterPreview]);

  const attemptNext = useCallback(async () => {
    setShowErrors(true);

    let currentNameStatus = nameStatus;

    if (form.name.trim() && (nameStatus === "idle" || nameStatus === "checking")) {
      setNameStatus("checking");
      currentNameStatus = await checkNameAvailability(form.name.trim());
      setNameStatus(currentNameStatus);
    }

    const fieldErrors = validate(form, currentNameStatus);
    setErrors((e) => ({ ...e, ...fieldErrors }));

    if (Object.keys(fieldErrors).length > 0) return;

    setBasicInfoData(form);
    goNext();
  }, [form, nameStatus, setBasicInfoData, goNext]);

  useEffect(() => {
    registerStepHandler(0, attemptNext);
  }, [registerStepHandler, attemptNext]);

  useEffect(() => {
    if (showErrors) {
      setErrors(validate(form, nameStatus));
    }
  }, [form, nameStatus, showErrors]);

  const field = (key: keyof BasicInfoData, value: string) => {
    setForm((f) => ({ ...f, [key]: value }));
  };

  return (
    <div>
      <h2 className="font-cinzel mb-1 text-lg font-bold text-text-primary tracking-wide">
        Basic Information
      </h2>
      <p className="font-lato mb-6 text-sm text-text-muted">
        Tell players what your tournament is about and where it&apos;s held.
      </p>

      {/* Tournament Name */}
      <div className="form-group">
        <div className="label-row">
          <label htmlFor="tournament-name" className="input-label">
            Tournament Name
          </label>
          <span aria-hidden="true" className="text-danger text-sm ml-0.5">*</span>
        </div>
        <div className="relative">
          <input
            id="tournament-name"
            type="text"
            className={`input pr-8 ${showErrors && errors.name ? "input-error" : ""}`}
            placeholder="e.g., KL Open Rapid Championship 2026"
            value={form.name}
            onChange={(e) => handleNameChange(e.target.value)}
            maxLength={255}
            autoComplete="off"
          />
          {nameStatus === "checking" && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-text-muted text-xs">
              …
            </span>
          )}
          {nameStatus === "available" && form.name.trim() && (
            <span className="absolute right-3 top-1/2 -translate-y-1/2 text-success text-sm">
              ✓
            </span>
          )}
        </div>
        {showErrors && errors.name && (
          <p className="input-hint error">{errors.name}</p>
        )}
        {nameStatus === "available" && form.name.trim() && !errors.name && (
          <p className="input-hint" style={{ color: "var(--color-success)" }}>
            Name is available.
          </p>
        )}
      </div>

      {/* Description */}
      <div className="form-group">
        <div className="label-row">
          <label htmlFor="tournament-description" className="input-label">
            Description
          </label>
          <span className="label-optional">(optional)</span>
        </div>
        <textarea
          id="tournament-description"
          className="input min-h-24 resize-y"
          placeholder="Full description, rules, what to bring, parking info, etc."
          value={form.description}
          onChange={(e) => field("description", e.target.value)}
          rows={3}
        />
      </div>

      {/* Tournament Poster */}
      <div className="form-group">
        <div className="label-row">
          <label className="input-label">Tournament Poster</label>
          <span className="label-optional">(optional)</span>
        </div>

        {posterPreview ? (
          <div className="relative inline-block">
            <img
              src={posterPreview}
              alt="Tournament poster preview"
              className="max-h-48 rounded-md border border-border object-cover"
            />
            <button
              type="button"
              onClick={removePoster}
              className="absolute -top-2 -right-2 flex h-6 w-6 items-center justify-center rounded-full border border-border bg-bg-raised text-text-muted text-xs transition hover:border-danger hover:text-danger"
              aria-label="Remove poster"
            >
              ×
            </button>
          </div>
        ) : (
          <div
            role="button"
            tabIndex={0}
            onClick={() => fileInputRef.current?.click()}
            onKeyDown={(e) => {
              if (e.key === "Enter" || e.key === " ") fileInputRef.current?.click();
            }}
            onDrop={handleDrop}
            onDragEnter={handleDragEnter}
            onDragLeave={handleDragLeave}
            onDragOver={handleDragOver}
            className={`flex cursor-pointer flex-col items-center justify-center gap-2 rounded-lg border-2 border-dashed px-6 py-10 text-center transition duration-200 ${
              dragging
                ? "border-gold-bright bg-int-gold-bg"
                : "border-border hover:border-gold-muted hover:bg-bg-raised"
            }`}
          >
            <span className="text-2xl text-text-muted">📁</span>
            <span className="font-lato text-sm text-text-muted">
              Click to upload or drag and drop
            </span>
            <span className="font-lato text-xs text-text-disabled">
              Portrait format recommended (3:4 ratio) · Max 5 MB
            </span>
          </div>
        )}
        <input
          ref={fileInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={handleFileInput}
          aria-label="Tournament poster"
        />
        {errors.posterFile && (
          <p className="input-hint error">{errors.posterFile}</p>
        )}
      </div>

      {/* Venue Name + State row */}
      <div className="input-row">
        <div className="form-group">
          <div className="label-row">
            <label htmlFor="venue-name" className="input-label">
              Venue Name
            </label>
            <span aria-hidden="true" className="text-danger text-sm ml-0.5">*</span>
          </div>
          <input
            id="venue-name"
            type="text"
            className={`input ${showErrors && errors.venueName ? "input-error" : ""}`}
            placeholder="e.g., Dewan Bandaraya KL"
            value={form.venueName}
            onChange={(e) => field("venueName", e.target.value)}
            maxLength={255}
          />
          {showErrors && errors.venueName && (
            <p className="input-hint error">{errors.venueName}</p>
          )}
        </div>

        <div className="form-group">
          <div className="label-row">
            <label htmlFor="venue-state" className="input-label">
              State
            </label>
            <span aria-hidden="true" className="text-danger text-sm ml-0.5">*</span>
          </div>
          <select
            id="venue-state"
            className={`input ${showErrors && errors.venueState ? "input-error" : ""}`}
            value={form.venueState}
            onChange={(e) => field("venueState", e.target.value)}
          >
            <option value="">Select state…</option>
            {MALAYSIAN_STATES.map((s) => (
              <option key={s} value={s}>
                {s}
              </option>
            ))}
          </select>
          {showErrors && errors.venueState && (
            <p className="input-hint error">{errors.venueState}</p>
          )}
        </div>
      </div>

      {/* Venue Address */}
      <div className="form-group">
        <div className="label-row">
          <label htmlFor="venue-address" className="input-label">
            Venue Address
          </label>
          <span aria-hidden="true" className="text-danger text-sm ml-0.5">*</span>
        </div>
        <input
          id="venue-address"
          type="text"
          className={`input ${showErrors && errors.venueAddress ? "input-error" : ""}`}
          placeholder="Full address"
          value={form.venueAddress}
          onChange={(e) => field("venueAddress", e.target.value)}
        />
        {showErrors && errors.venueAddress && (
          <p className="input-hint error">{errors.venueAddress}</p>
        )}
      </div>
    </div>
  );
}
