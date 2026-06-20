"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { FeesData, FeeTier, TierType } from "../TournamentWizardContext";
import { useTournamentWizard } from "../TournamentWizardContext";

const COMMISSION = 0.1;

const CHESS_TITLES = ["GM", "IM", "FM", "WGM", "WIM", "WFM", "CM", "WCM", "NM"];

const TIER_TYPES: TierType[] = [
  "early-bird",
  "titled",
  "rating-based",
  "age-based",
];

const TIER_LABELS: Record<TierType, string> = {
  "early-bird": "Early Bird",
  titled: "Titled Players",
  "rating-based": "Rating-Based",
  "age-based": "Age-Based",
};

type TierErrors = Partial<{
  amount: string;
  validUntil: string;
  titles: string;
  ratingFrom: string;
  ratingTo: string;
  ageFrom: string;
  ageTo: string;
}>;

type FeesErrors = {
  standardFee?: string;
  tiers: Record<string, TierErrors>;
};

function numAmt(v: number | ""): number {
  return v === "" ? 0 : Number(v);
}

function fmtRM(val: number): string {
  return `RM ${val.toFixed(2)}`;
}

function validate(data: FeesData): FeesErrors {
  const errors: FeesErrors = { tiers: {} };

  if (data.standardFee === "") {
    errors.standardFee = "Standard fee is required.";
  } else if (Number(data.standardFee) < 0) {
    errors.standardFee = "Fee cannot be negative.";
  }

  for (const tier of data.tiers) {
    const te: TierErrors = {};

    if (tier.amount === "") {
      te.amount = "Fee amount is required.";
    } else if (Number(tier.amount) < 0) {
      te.amount = "Fee cannot be negative.";
    }

    if (tier.type === "early-bird") {
      if (!tier.validUntil) te.validUntil = "Valid-until date is required.";
    } else if (tier.type === "titled") {
      if (tier.titles.length === 0) te.titles = "Select at least one title.";
    } else if (tier.type === "rating-based") {
      if (tier.ratingFrom === "") {
        te.ratingFrom = "Rating from is required.";
      } else if (Number(tier.ratingFrom) < 0) {
        te.ratingFrom = "Must be 0 or above.";
      }
      if (tier.ratingTo === "") {
        te.ratingTo = "Rating to is required.";
      } else if (
        typeof tier.ratingFrom === "number" &&
        typeof tier.ratingTo === "number" &&
        tier.ratingTo < tier.ratingFrom
      ) {
        te.ratingTo = "Must be ≥ rating from.";
      }
    } else if (tier.type === "age-based") {
      if (tier.ageFrom === "") {
        te.ageFrom = "Age from is required.";
      } else if (Number(tier.ageFrom) < 0) {
        te.ageFrom = "Must be 0 or above.";
      }
      if (tier.ageTo === "") {
        te.ageTo = "Age to is required.";
      } else if (
        typeof tier.ageFrom === "number" &&
        typeof tier.ageTo === "number" &&
        tier.ageTo < tier.ageFrom
      ) {
        te.ageTo = "Must be ≥ age from.";
      }
    }

    if (Object.keys(te).length > 0) {
      errors.tiers[tier.id] = te;
    }
  }

  return errors;
}

function NetBreakdown({ amount }: { amount: number | "" }) {
  const revenue = numAmt(amount);
  const commission = Math.round(revenue * COMMISSION * 100) / 100;
  const playerPays = revenue + commission;
  const isFree = revenue === 0;

  return (
    <div className="flex flex-wrap gap-5 items-center mt-3 px-3.5 py-2.5 bg-bg-base border border-border rounded-md">
      <div className="flex flex-col gap-0.5">
        <span className="font-cinzel text-text-muted text-[10px] uppercase tracking-widest">
          Your revenue
        </span>
        <span className="font-lato text-text-body text-sm tabular-nums">
          {fmtRM(revenue)}
        </span>
      </div>
      <span className="text-text-disabled text-sm">+</span>
      <div className="flex flex-col gap-0.5">
        <span className="font-cinzel text-text-muted text-[10px] uppercase tracking-widest">
          Commission (10%)
        </span>
        <span className="font-lato text-text-body text-sm tabular-nums">
          {fmtRM(commission)}
        </span>
      </div>
      <span className="text-text-disabled text-sm">=</span>
      <div className="flex flex-col gap-0.5">
        <span className="font-cinzel text-text-muted text-[10px] uppercase tracking-widest">
          Player pays
        </span>
        <span
          className={`font-lato text-sm font-semibold tabular-nums ${
            isFree ? "text-success" : "text-gold-bright"
          }`}
        >
          {isFree ? "Free" : fmtRM(playerPays)}
        </span>
      </div>
    </div>
  );
}

function AmountField({
  id,
  value,
  onChange,
  error,
}: {
  id: string;
  value: number | "";
  onChange: (v: number | "") => void;
  error?: string;
}) {
  return (
    <div>
      <div className="flex items-center gap-2">
        <span className="font-lato text-text-muted text-sm">RM</span>
        <input
          id={id}
          type="number"
          className={`input text-right tabular-nums ${error ? "input-error" : ""}`}
          style={{ width: "100px" }}
          value={value === "" ? "" : String(value)}
          placeholder="0.00"
          min={0}
          step={0.01}
          onChange={(e) => {
            const raw = e.target.value;
            onChange(raw === "" ? "" : Number(raw));
          }}
        />
      </div>
      {error && <p className="input-hint error mt-1">{error}</p>}
    </div>
  );
}

function TierCard({
  label,
  onRemove,
  children,
}: {
  label: string;
  onRemove: () => void;
  children: React.ReactNode;
}) {
  return (
    <div className="bg-bg-raised border border-border rounded-lg p-4">
      <div className="flex justify-between items-center mb-3">
        <span className="font-cinzel text-text-primary text-sm font-semibold">
          {label}
        </span>
        <button
          type="button"
          aria-label={`Remove ${label} tier`}
          className="border-border text-text-muted hover:text-danger hover:border-danger-border flex items-center justify-center rounded-md border bg-transparent transition duration-200 cursor-pointer"
          style={{ width: "28px", height: "28px", flexShrink: 0 }}
          onClick={onRemove}
        >
          ×
        </button>
      </div>
      {children}
    </div>
  );
}

function SectionHeader({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="font-cinzel text-gold-muted text-xs font-bold tracking-widest uppercase mt-0 mb-1 pt-4 border-t border-border">
      {children}
    </h3>
  );
}

export default function FeesStep() {
  const { feesData, setFeesData, goNext, registerStepHandler, isHydrated } =
    useTournamentWizard();

  const [form, setForm] = useState<FeesData>(feesData);

  useEffect(() => {
    if (isHydrated) setForm(feesData);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isHydrated]);
  const [errors, setErrors] = useState<FeesErrors>({ tiers: {} });
  const [showErrors, setShowErrors] = useState(false);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    function handler(e: MouseEvent) {
      if (
        dropdownRef.current &&
        !dropdownRef.current.contains(e.target as Node)
      ) {
        setDropdownOpen(false);
      }
    }
    if (dropdownOpen) document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, [dropdownOpen]);

  const existingTypes = new Set(form.tiers.map((t) => t.type));
  const availableTypes = TIER_TYPES.filter((t) => !existingTypes.has(t));

  const addTier = (type: TierType) => {
    const newTier: FeeTier = {
      id: `${Date.now()}-${Math.random()}`,
      type,
      amount: "",
      validUntil: "",
      titles: [],
      ratingFrom: 0,
      ratingTo: "",
      ageFrom: 0,
      ageTo: "",
    };
    setForm((f) => ({ ...f, tiers: [...f.tiers, newTier] }));
    setDropdownOpen(false);
  };

  const removeTier = (id: string) => {
    setForm((f) => ({ ...f, tiers: f.tiers.filter((t) => t.id !== id) }));
  };

  const updateTier = (id: string, changes: Partial<FeeTier>) => {
    setForm((f) => ({
      ...f,
      tiers: f.tiers.map((t) => (t.id === id ? { ...t, ...changes } : t)),
    }));
  };

  const attemptNext = useCallback(async () => {
    setShowErrors(true);
    const fieldErrors = validate(form);
    setErrors(fieldErrors);
    const hasErrors =
      !!fieldErrors.standardFee ||
      Object.keys(fieldErrors.tiers).length > 0;
    if (hasErrors) return;
    setFeesData(form);
    goNext();
  }, [form, setFeesData, goNext]);

  useEffect(() => {
    registerStepHandler(2, attemptNext);
  }, [registerStepHandler, attemptNext]);

  useEffect(() => {
    if (showErrors) {
      setErrors(validate(form));
    }
  }, [form, showErrors]);

  return (
    <div>
      <h2 className="font-cinzel mb-1 text-lg font-bold text-text-primary tracking-wide">
        Entry Fees
      </h2>
      <p className="font-lato mb-6 text-sm text-text-muted">
        Set the standard fee, then add optional tiers for early bird, titled
        players, rating-based, or age-based discounts.
      </p>

      {/* Commission info banner */}
      <div className="flex items-start gap-2.5 mb-5 px-3.5 py-3 bg-bg-raised border border-border rounded-md">
        <span className="text-base shrink-0 leading-snug">ℹ️</span>
        <p className="font-lato text-text-muted text-xs leading-relaxed">
          A{" "}
          <strong className="text-text-secondary font-semibold">
            10% platform commission
          </strong>{" "}
          is added on top of the fee you set. You receive the full amount you
          enter — the commission is charged to the player.
        </p>
      </div>

      {/* Standard Fee */}
      <h3 className="font-cinzel text-gold-muted text-xs font-bold tracking-widest uppercase mb-3">
        Standard Fee
      </h3>
      <div className="bg-bg-raised border border-border rounded-lg p-4 mb-6">
        <div className="flex flex-wrap items-center gap-3 mb-1.5">
          <span
            className="font-cinzel text-text-secondary text-sm font-semibold"
            style={{ minWidth: "90px" }}
          >
            Standard
          </span>
          <AmountField
            id="standard-fee"
            value={form.standardFee}
            onChange={(v) => setForm((f) => ({ ...f, standardFee: v }))}
            error={showErrors ? errors.standardFee : undefined}
          />
        </div>
        <p className="font-lato text-text-disabled text-xs">
          The base entry fee applied to all players by default. This tier cannot
          be removed.
        </p>
        <NetBreakdown amount={form.standardFee} />
      </div>

      {/* Additional Fee Tiers */}
      <SectionHeader>Additional Fee Tiers</SectionHeader>
      <p className="font-lato text-text-muted text-xs mb-4">
        Optional. Players who qualify will see these options during registration.
      </p>

      {form.tiers.length > 0 && (
        <div className="flex flex-col gap-3 mb-4">
          {form.tiers.map((tier) => {
            const te = errors.tiers[tier.id] ?? {};

            if (tier.type === "early-bird") {
              return (
                <TierCard
                  key={tier.id}
                  label={TIER_LABELS[tier.type]}
                  onRemove={() => removeTier(tier.id)}
                >
                  <div className="flex flex-wrap gap-3 items-start mb-1.5">
                    <AmountField
                      id={`${tier.id}-amount`}
                      value={tier.amount}
                      onChange={(v) => updateTier(tier.id, { amount: v })}
                      error={showErrors ? te.amount : undefined}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-lato text-text-muted text-sm">
                          Valid until
                        </span>
                        <input
                          type="date"
                          className={`input ${showErrors && te.validUntil ? "input-error" : ""}`}
                          value={tier.validUntil}
                          onChange={(e) =>
                            updateTier(tier.id, { validUntil: e.target.value })
                          }
                        />
                      </div>
                      {showErrors && te.validUntil && (
                        <p className="input-hint error mt-1">{te.validUntil}</p>
                      )}
                    </div>
                  </div>
                  <p className="font-lato text-text-disabled text-xs">
                    Players who register on or before this date will pay this
                    fee instead of the standard fee.
                  </p>
                  <NetBreakdown amount={tier.amount} />
                </TierCard>
              );
            }

            if (tier.type === "titled") {
              return (
                <TierCard
                  key={tier.id}
                  label={TIER_LABELS[tier.type]}
                  onRemove={() => removeTier(tier.id)}
                >
                  <div className="flex flex-wrap gap-3 items-start mb-3">
                    <AmountField
                      id={`${tier.id}-amount`}
                      value={tier.amount}
                      onChange={(v) => updateTier(tier.id, { amount: v })}
                      error={showErrors ? te.amount : undefined}
                    />
                    <div className="flex-1 min-w-[220px]">
                      <p className="font-lato text-text-muted text-xs mb-2">
                        Applies to titles:
                      </p>
                      <div className="flex flex-wrap gap-x-4 gap-y-2">
                        {CHESS_TITLES.map((title) => (
                          <label
                            key={title}
                            className="flex items-center gap-1.5 cursor-pointer select-none"
                          >
                            <input
                              type="checkbox"
                              className="accent-gold-bright w-3.5 h-3.5 cursor-pointer"
                              checked={tier.titles.includes(title)}
                              onChange={(e) => {
                                const next = e.target.checked
                                  ? [...tier.titles, title]
                                  : tier.titles.filter((t) => t !== title);
                                updateTier(tier.id, { titles: next });
                              }}
                            />
                            <span className="font-cinzel text-text-secondary text-xs font-semibold">
                              {title}
                            </span>
                          </label>
                        ))}
                      </div>
                      {showErrors && te.titles && (
                        <p className="input-hint error mt-1">{te.titles}</p>
                      )}
                    </div>
                  </div>
                  <NetBreakdown amount={tier.amount} />
                </TierCard>
              );
            }

            if (tier.type === "rating-based") {
              return (
                <TierCard
                  key={tier.id}
                  label={TIER_LABELS[tier.type]}
                  onRemove={() => removeTier(tier.id)}
                >
                  <div className="flex flex-wrap gap-3 items-start mb-1.5">
                    <AmountField
                      id={`${tier.id}-amount`}
                      value={tier.amount}
                      onChange={(v) => updateTier(tier.id, { amount: v })}
                      error={showErrors ? te.amount : undefined}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-lato text-text-muted text-sm">
                          Rating from
                        </span>
                        <input
                          type="number"
                          className={`input text-center tabular-nums ${showErrors && te.ratingFrom ? "input-error" : ""}`}
                          style={{ width: "80px" }}
                          value={
                            tier.ratingFrom === "" ? "" : String(tier.ratingFrom)
                          }
                          min={0}
                          onChange={(e) => {
                            const raw = e.target.value;
                            updateTier(tier.id, {
                              ratingFrom: raw === "" ? "" : Number(raw),
                            });
                          }}
                        />
                        <span className="font-lato text-text-muted text-sm">
                          to
                        </span>
                        <input
                          type="number"
                          className={`input text-center tabular-nums ${showErrors && te.ratingTo ? "input-error" : ""}`}
                          style={{ width: "80px" }}
                          value={
                            tier.ratingTo === "" ? "" : String(tier.ratingTo)
                          }
                          min={0}
                          onChange={(e) => {
                            const raw = e.target.value;
                            updateTier(tier.id, {
                              ratingTo: raw === "" ? "" : Number(raw),
                            });
                          }}
                        />
                      </div>
                      {showErrors && (te.ratingFrom ?? te.ratingTo) && (
                        <p className="input-hint error mt-1">
                          {te.ratingFrom ?? te.ratingTo}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="font-lato text-text-disabled text-xs">
                    Players with a rating within this range will see this fee
                    option.
                  </p>
                  <NetBreakdown amount={tier.amount} />
                </TierCard>
              );
            }

            if (tier.type === "age-based") {
              return (
                <TierCard
                  key={tier.id}
                  label={TIER_LABELS[tier.type]}
                  onRemove={() => removeTier(tier.id)}
                >
                  <div className="flex flex-wrap gap-3 items-start mb-1.5">
                    <AmountField
                      id={`${tier.id}-amount`}
                      value={tier.amount}
                      onChange={(v) => updateTier(tier.id, { amount: v })}
                      error={showErrors ? te.amount : undefined}
                    />
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-lato text-text-muted text-sm">
                          Age from
                        </span>
                        <input
                          type="number"
                          className={`input text-center tabular-nums ${showErrors && te.ageFrom ? "input-error" : ""}`}
                          style={{ width: "70px" }}
                          value={tier.ageFrom === "" ? "" : String(tier.ageFrom)}
                          min={0}
                          onChange={(e) => {
                            const raw = e.target.value;
                            updateTier(tier.id, {
                              ageFrom: raw === "" ? "" : Number(raw),
                            });
                          }}
                        />
                        <span className="font-lato text-text-muted text-sm">
                          to
                        </span>
                        <input
                          type="number"
                          className={`input text-center tabular-nums ${showErrors && te.ageTo ? "input-error" : ""}`}
                          style={{ width: "70px" }}
                          value={tier.ageTo === "" ? "" : String(tier.ageTo)}
                          min={0}
                          onChange={(e) => {
                            const raw = e.target.value;
                            updateTier(tier.id, {
                              ageTo: raw === "" ? "" : Number(raw),
                            });
                          }}
                        />
                        <span className="font-lato text-text-disabled text-xs">
                          years old
                        </span>
                      </div>
                      {showErrors && (te.ageFrom ?? te.ageTo) && (
                        <p className="input-hint error mt-1">
                          {te.ageFrom ?? te.ageTo}
                        </p>
                      )}
                    </div>
                  </div>
                  <p className="font-lato text-text-disabled text-xs">
                    Players within this age range will see this fee option.
                  </p>
                  <NetBreakdown amount={tier.amount} />
                </TierCard>
              );
            }

            return null;
          })}
        </div>
      )}

      {/* Add Fee Tier dropdown */}
      {availableTypes.length > 0 && (
        <div className="relative inline-block" ref={dropdownRef}>
          <button
            type="button"
            className="font-cinzel border-border text-text-secondary hover:border-gold-muted hover:text-text-primary cursor-pointer rounded-md border bg-transparent px-4 py-2 text-xs font-bold tracking-widest uppercase transition duration-200"
            onClick={() => setDropdownOpen((o) => !o)}
          >
            + Add Fee Tier
          </button>
          {dropdownOpen && (
            <div
              className="absolute top-[calc(100%+4px)] left-0 bg-bg-surface border border-border rounded-lg py-1.5 min-w-44 z-10"
              style={{ boxShadow: "0 4px 16px rgba(0,0,0,0.4)" }}
            >
              {availableTypes.map((t) => (
                <button
                  key={t}
                  type="button"
                  className="font-lato w-full text-left px-3.5 py-2 text-sm text-text-body hover:bg-int-gold-bg transition duration-100 cursor-pointer border-0 bg-transparent"
                  onClick={() => addTier(t)}
                >
                  {TIER_LABELS[t]}
                </button>
              ))}
            </div>
          )}
        </div>
      )}

      {/* Tip */}
      <div className="mt-5 px-3.5 py-3 bg-int-gold-bg border border-gold-ghost rounded-md">
        <p className="font-lato text-gold-muted text-xs leading-relaxed">
          💡 Players will see the fee tiers they qualify for during
          registration. The breakdown updates automatically as you change
          amounts.
        </p>
      </div>
    </div>
  );
}
