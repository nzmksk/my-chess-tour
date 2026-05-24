"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";

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

export default function ApplyForm() {
  const router = useRouter();
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [links, setLinks] = useState<LinkEntry[]>([]);
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [pastTournamentRefs, setPastTournamentRefs] = useState("");
  const [status, setStatus] = useState<FormStatus>("idle");
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  const [pendingOrg, setPendingOrg] = useState<PendingOrg | null>(null);
  const [countdown, setCountdown] = useState(5);

  useEffect(() => {
    if (status !== "success") return;
    if (countdown <= 0) {
      router.push("/my/organizations");
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

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (status === "submitting") return;

    setStatus("submitting");
    setErrorMessage(null);

    const filteredLinks = links
      .filter((l) => l.url.trim() !== "")
      .map((l) => ({
        url: l.url.trim(),
        label: LINK_TYPES.find((t) => t.value === l.type)?.label ?? l.type,
      }));

    try {
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
      <div className="max-w-lg mx-auto text-center py-16">
        <div className="w-16 h-16 rounded-full bg-warning-bg flex items-center justify-center text-3xl mx-auto mb-5">
          ⏳
        </div>
        <h1 className="font-cinzel text-xl font-semibold text-text-primary mb-2">
          Application Submitted
        </h1>
        <p className="font-lato text-text-secondary text-sm mb-2">
          Your application for{" "}
          <strong className="text-text-primary">{pendingOrg.name}</strong> is
          under review. We&apos;ll notify you by email once it&apos;s been
          processed.
        </p>
        <p className="font-lato text-text-muted text-xs mb-8">
          Typically reviewed within 1–2 business days.
        </p>
        <div className="flex flex-col gap-3">
          <button
            onClick={() => router.push("/my/organizations")}
            className="btn-primary rounded-md w-full"
          >
            View My Organizations
            <span className="ml-2 font-lato text-xs opacity-70">
              ({countdown}s)
            </span>
          </button>
          <button
            onClick={() => router.push("/tournaments")}
            className="btn-secondary rounded-md w-full"
          >
            Back to Tournaments
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="max-w-lg mx-auto">
      <div className="mb-6">
        <h1 className="font-cinzel text-xl font-semibold text-text-primary tracking-wider">
          Apply as Tournament Organizer
        </h1>
        <p className="font-lato text-sm text-text-muted mt-1">
          Fill in your organization details. Your application will be reviewed
          by our admin team.
        </p>
      </div>

      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        {/* Organization Name */}
        <div className="flex flex-col gap-1.5">
          <label className="font-lato text-sm font-medium text-text-secondary">
            Organization Name <span className="text-error">*</span>
          </label>
          <input
            type="text"
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="e.g., KL Chess Association"
            required
            className="w-full border border-border bg-bg-raised rounded-md px-3 py-2.5 font-lato text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-gold-bright transition-colors"
          />
        </div>

        {/* Description */}
        <div className="flex flex-col gap-1.5">
          <label className="font-lato text-sm font-medium text-text-secondary">
            Description
          </label>
          <textarea
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            placeholder="Tell us about your organization and chess activities..."
            rows={3}
            className="w-full border border-border bg-bg-raised rounded-md px-3 py-2.5 font-lato text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-gold-bright transition-colors resize-y"
          />
        </div>

        {/* Links */}
        <div className="flex flex-col gap-1.5">
          <label className="font-lato text-sm font-medium text-text-secondary">
            Links
          </label>
          <div className="flex flex-col gap-2">
            {links.map((link, index) => (
              <div key={index} className="flex gap-2 items-center">
                <select
                  value={link.type}
                  onChange={(e) => updateLink(index, "type", e.target.value)}
                  className="shrink-0 w-36 border border-border bg-bg-raised rounded-md px-2 py-2.5 font-lato text-sm text-text-primary focus:outline-none focus:border-gold-bright transition-colors appearance-none cursor-pointer"
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
                  className="flex-1 border border-border bg-bg-raised rounded-md px-3 py-2.5 font-lato text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-gold-bright transition-colors"
                />
                <button
                  type="button"
                  onClick={() => removeLink(index)}
                  className="shrink-0 w-9 h-10 rounded-md border border-border text-text-muted hover:border-danger hover:text-danger hover:bg-danger-bg transition-colors flex items-center justify-center text-base"
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
            className="self-start font-lato text-sm font-medium text-gold-bright border border-dashed border-border rounded-md px-3 py-2 hover:border-gold-bright hover:bg-gold-ghost transition-colors"
          >
            + Add Link
          </button>
        </div>

        {/* Contact info */}
        <div className="grid grid-cols-2 gap-4">
          <div className="flex flex-col gap-1.5">
            <label className="font-lato text-sm font-medium text-text-secondary">
              Email <span className="text-error">*</span>
            </label>
            <input
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="chess@org.com"
              required
              className="w-full border border-border bg-bg-raised rounded-md px-3 py-2.5 font-lato text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-gold-bright transition-colors"
            />
          </div>
          <div className="flex flex-col gap-1.5">
            <label className="font-lato text-sm font-medium text-text-secondary">
              Phone
            </label>
            <input
              type="tel"
              value={phone}
              onChange={(e) => setPhone(e.target.value)}
              placeholder="+60..."
              className="w-full border border-border bg-bg-raised rounded-md px-3 py-2.5 font-lato text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-gold-bright transition-colors"
            />
          </div>
        </div>

        {/* Past tournament references */}
        <div className="flex flex-col gap-1.5">
          <label className="font-lato text-sm font-medium text-text-secondary">
            Past Tournament References
          </label>
          <textarea
            value={pastTournamentRefs}
            onChange={(e) => setPastTournamentRefs(e.target.value)}
            placeholder="List any tournaments you've previously organized (names, dates, approximate participants)..."
            rows={3}
            className="w-full border border-border bg-bg-raised rounded-md px-3 py-2.5 font-lato text-sm text-text-primary placeholder:text-text-disabled focus:outline-none focus:border-gold-bright transition-colors resize-y"
          />
          <p className="font-lato text-xs text-text-muted">
            Optional — helps speed up the approval process.
          </p>
        </div>

        {/* Error */}
        {status === "error" && errorMessage && (
          <p className="font-lato text-sm text-error text-center">
            {errorMessage}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={status === "submitting"}
          className="btn-primary rounded-md w-full"
        >
          {status === "submitting" ? "Submitting…" : "Submit Application"}
        </button>
      </form>
    </div>
  );
}
