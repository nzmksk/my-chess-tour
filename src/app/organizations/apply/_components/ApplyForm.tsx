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

        {/* Error */}
        {status === "error" && errorMessage && (
          <p className="font-lato text-error text-center text-sm">
            {errorMessage}
          </p>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={status === "submitting"}
          className="btn-primary w-full rounded-md"
        >
          {status === "submitting" ? "Submitting…" : "Submit Application"}
        </button>
      </form>
    </div>
  );
}
