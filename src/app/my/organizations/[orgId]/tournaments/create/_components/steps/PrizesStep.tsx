"use client";

import { useCallback, useEffect, useState } from "react";
import type {
  PrizeCategory,
  PrizeRow,
  PrizesData,
  SpecialPrize,
} from "../../types";
import { useTournamentWizard } from "../TournamentWizardContext";
import { newRowId } from "../rowId";

type PrizeRowErrors = Partial<{ placement: string; amount: string }>;
type CategoryErrors = Partial<{
  name: string;
  prizes: Record<string, PrizeRowErrors>;
}>;
type SpecialPrizeErrors = Partial<{ name: string; amount: string }>;

type PrizesErrors = {
  categories: Record<string, CategoryErrors>;
  specialPrizes: Record<string, SpecialPrizeErrors>;
};

const NO_ERRORS: PrizesErrors = { categories: {}, specialPrizes: {} };

function validate(data: PrizesData): PrizesErrors {
  const errors: PrizesErrors = { categories: {}, specialPrizes: {} };

  for (const cat of data.categories) {
    const ce: CategoryErrors = {};
    if (!cat.name.trim()) ce.name = "Category name is required.";

    const prizeErrors: Record<string, PrizeRowErrors> = {};
    for (const row of cat.prizes) {
      const re: PrizeRowErrors = {};
      if (!row.placement.trim()) re.placement = "Placement is required.";
      if (row.amount === "") re.amount = "Amount is required.";
      else if (Number(row.amount) < 0) re.amount = "Amount cannot be negative.";
      if (Object.keys(re).length > 0) prizeErrors[row.id] = re;
    }
    if (Object.keys(prizeErrors).length > 0) ce.prizes = prizeErrors;
    if (Object.keys(ce).length > 0) errors.categories[cat.id] = ce;
  }

  for (const sp of data.specialPrizes) {
    const se: SpecialPrizeErrors = {};
    if (!sp.name.trim()) se.name = "Prize name is required.";
    if (sp.amount === "") se.amount = "Amount is required.";
    else if (Number(sp.amount) < 0) se.amount = "Amount cannot be negative.";
    if (Object.keys(se).length > 0) errors.specialPrizes[sp.id] = se;
  }

  return errors;
}

function hasErrors(errors: PrizesErrors): boolean {
  return (
    Object.keys(errors.categories).length > 0 ||
    Object.keys(errors.specialPrizes).length > 0
  );
}

function RemoveButton({
  onClick,
  label,
}: {
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      aria-label={label}
      className="border-border text-text-muted hover:text-danger hover:border-danger-border flex shrink-0 cursor-pointer items-center justify-center rounded-md border bg-transparent transition duration-200"
      style={{ width: "32px", height: "32px", fontSize: "16px" }}
      onClick={onClick}
    >
      ×
    </button>
  );
}

function AddRowButton({
  onClick,
  children,
}: {
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      className="font-lato text-accent hover:border-accent hover:bg-accent-light border-border cursor-pointer rounded-md border border-dashed bg-transparent px-3.5 py-2 text-sm font-medium transition duration-200"
      onClick={onClick}
    >
      {children}
    </button>
  );
}

function PrizeCategoryBlock({
  category,
  catErrors,
  showErrors,
  onUpdateName,
  onRemoveCategory,
  onAddPrize,
  onUpdatePrize,
  onRemovePrize,
}: {
  category: PrizeCategory;
  catErrors: CategoryErrors;
  showErrors: boolean;
  onUpdateName: (name: string) => void;
  onRemoveCategory: () => void;
  onAddPrize: () => void;
  onUpdatePrize: (id: string, changes: Partial<PrizeRow>) => void;
  onRemovePrize: (id: string) => void;
}) {
  const prizeErrors = catErrors.prizes ?? {};

  return (
    <div className="bg-bg-base border-border mb-3 rounded-lg border p-4">
      <div className="mb-3 flex items-center justify-between gap-2">
        <div className="min-w-0 flex-1">
          <input
            type="text"
            className={`input font-semibold ${showErrors && catErrors.name ? "input-error" : ""}`}
            style={{ width: "200px", maxWidth: "100%" }}
            placeholder="Category name"
            value={category.name}
            onChange={(e) => onUpdateName(e.target.value)}
          />
          {showErrors && catErrors.name && (
            <p className="input-hint error mt-1">{catErrors.name}</p>
          )}
        </div>
        <button
          type="button"
          className="font-lato border-border text-text-muted hover:text-danger hover:border-danger-border shrink-0 cursor-pointer rounded-md border bg-transparent px-3 py-1 text-xs transition duration-200"
          onClick={onRemoveCategory}
        >
          Remove
        </button>
      </div>

      <div className="mb-3 flex flex-col gap-2">
        {category.prizes.map((row) => {
          const re = prizeErrors[row.id] ?? {};
          return (
            <div key={row.id} className="flex items-start gap-2">
              <div className="min-w-0 flex-1">
                <input
                  type="text"
                  className={`input w-full ${showErrors && re.placement ? "input-error" : ""}`}
                  placeholder="Placement (e.g. 1st Place)"
                  value={row.placement}
                  onChange={(e) =>
                    onUpdatePrize(row.id, { placement: e.target.value })
                  }
                />
                {showErrors && re.placement && (
                  <p className="input-hint error mt-0.5">{re.placement}</p>
                )}
              </div>
              <div style={{ width: "130px", flexShrink: 0 }}>
                <div className="flex items-center gap-1.5">
                  <span className="font-lato text-text-muted shrink-0 text-sm">
                    RM
                  </span>
                  <input
                    type="number"
                    className={`input w-full text-right tabular-nums ${showErrors && re.amount ? "input-error" : ""}`}
                    placeholder="0"
                    min={0}
                    value={row.amount === "" ? "" : String(row.amount)}
                    onChange={(e) => {
                      const raw = e.target.value;
                      onUpdatePrize(row.id, {
                        amount: raw === "" ? "" : Number(raw),
                      });
                    }}
                  />
                </div>
                {showErrors && re.amount && (
                  <p className="input-hint error mt-0.5">{re.amount}</p>
                )}
              </div>
              <RemoveButton
                onClick={() => onRemovePrize(row.id)}
                label="Remove prize row"
              />
            </div>
          );
        })}
      </div>

      <AddRowButton onClick={onAddPrize}>+ Add Prize</AddRowButton>
    </div>
  );
}

export default function PrizesStep() {
  const { prizesData, setPrizesData, goNext, registerStepHandler } =
    useTournamentWizard();

  // WizardShell only mounts steps after the context has hydrated, so the
  // context value is already the restored one here.
  const [form, setForm] = useState<PrizesData>(prizesData);
  const [showErrors, setShowErrors] = useState(false);

  // Errors are derived from the form — no need to mirror them into state.
  const errors = showErrors ? validate(form) : NO_ERRORS;

  // ── Category helpers ──────────────────────────────────────

  const addCategory = () => {
    const newCat: PrizeCategory = {
      id: newRowId(),
      name: "",
      prizes: [{ id: newRowId(), placement: "", amount: "" }],
    };
    setForm((f) => ({ ...f, categories: [...f.categories, newCat] }));
  };

  const removeCategory = (catId: string) => {
    setForm((f) => ({
      ...f,
      categories: f.categories.filter((c) => c.id !== catId),
    }));
  };

  const updateCategoryName = (catId: string, name: string) => {
    setForm((f) => ({
      ...f,
      categories: f.categories.map((c) =>
        c.id === catId ? { ...c, name } : c,
      ),
    }));
  };

  const addPrize = (catId: string) => {
    const newRow: PrizeRow = { id: newRowId(), placement: "", amount: "" };
    setForm((f) => ({
      ...f,
      categories: f.categories.map((c) =>
        c.id === catId ? { ...c, prizes: [...c.prizes, newRow] } : c,
      ),
    }));
  };

  const removePrize = (catId: string, rowId: string) => {
    setForm((f) => ({
      ...f,
      categories: f.categories.map((c) =>
        c.id === catId
          ? { ...c, prizes: c.prizes.filter((r) => r.id !== rowId) }
          : c,
      ),
    }));
  };

  const updatePrize = (
    catId: string,
    rowId: string,
    changes: Partial<PrizeRow>,
  ) => {
    setForm((f) => ({
      ...f,
      categories: f.categories.map((c) =>
        c.id === catId
          ? {
              ...c,
              prizes: c.prizes.map((r) =>
                r.id === rowId ? { ...r, ...changes } : r,
              ),
            }
          : c,
      ),
    }));
  };

  // ── Special prize helpers ─────────────────────────────────

  const addSpecialPrize = () => {
    const newSp: SpecialPrize = { id: newRowId(), name: "", amount: "" };
    setForm((f) => ({ ...f, specialPrizes: [...f.specialPrizes, newSp] }));
  };

  const removeSpecialPrize = (id: string) => {
    setForm((f) => ({
      ...f,
      specialPrizes: f.specialPrizes.filter((sp) => sp.id !== id),
    }));
  };

  const updateSpecialPrize = (id: string, changes: Partial<SpecialPrize>) => {
    setForm((f) => ({
      ...f,
      specialPrizes: f.specialPrizes.map((sp) =>
        sp.id === id ? { ...sp, ...changes } : sp,
      ),
    }));
  };

  // ── Validation + step handler ─────────────────────────────

  const attemptNext = useCallback(async () => {
    setShowErrors(true);
    const fieldErrors = validate(form);
    if (hasErrors(fieldErrors)) return;
    setPrizesData(form);
    goNext();
  }, [form, setPrizesData, goNext]);

  useEffect(() => {
    registerStepHandler(3, attemptNext);
  }, [registerStepHandler, attemptNext]);

  // ── Render ────────────────────────────────────────────────

  return (
    <div>
      <h2 className="font-cinzel text-text-primary mb-1 text-lg font-bold tracking-wide">
        Prizes
      </h2>
      <p className="font-lato text-text-muted mb-6 text-sm">
        Define prize categories and amounts. Add as many categories and
        placements as needed.
      </p>

      {/* Prize Categories */}
      {form.categories.map((cat) => {
        const catErrors = errors.categories[cat.id] ?? {};
        return (
          <PrizeCategoryBlock
            key={cat.id}
            category={cat}
            catErrors={catErrors}
            showErrors={showErrors}
            onUpdateName={(name) => updateCategoryName(cat.id, name)}
            onRemoveCategory={() => removeCategory(cat.id)}
            onAddPrize={() => addPrize(cat.id)}
            onUpdatePrize={(rowId, changes) =>
              updatePrize(cat.id, rowId, changes)
            }
            onRemovePrize={(rowId) => removePrize(cat.id, rowId)}
          />
        );
      })}

      <AddRowButton onClick={addCategory}>+ Add Prize Category</AddRowButton>

      {/* Special Prizes */}
      <h3 className="font-cinzel text-gold-muted border-border mt-6 mb-3 border-t pt-4 text-xs font-bold tracking-widest uppercase">
        Special Prizes
      </h3>
      <p className="font-lato text-text-muted mb-4 text-xs">
        Optional. Awards for specific achievements (e.g. Best Female Player,
        Best Veteran).
      </p>

      {form.specialPrizes.length > 0 && (
        <div className="mb-4 flex flex-col gap-2">
          {form.specialPrizes.map((sp) => {
            const se = errors.specialPrizes[sp.id] ?? {};
            return (
              <div key={sp.id} className="flex items-start gap-2">
                <div className="min-w-0 flex-1">
                  <input
                    type="text"
                    className={`input w-full ${showErrors && se.name ? "input-error" : ""}`}
                    placeholder="Prize name (e.g. Best Female Player)"
                    value={sp.name}
                    onChange={(e) =>
                      updateSpecialPrize(sp.id, { name: e.target.value })
                    }
                  />
                  {showErrors && se.name && (
                    <p className="input-hint error mt-0.5">{se.name}</p>
                  )}
                </div>
                <div style={{ width: "130px", flexShrink: 0 }}>
                  <div className="flex items-center gap-1.5">
                    <span className="font-lato text-text-muted shrink-0 text-sm">
                      RM
                    </span>
                    <input
                      type="number"
                      className={`input w-full text-right tabular-nums ${showErrors && se.amount ? "input-error" : ""}`}
                      placeholder="0"
                      min={0}
                      value={sp.amount === "" ? "" : String(sp.amount)}
                      onChange={(e) => {
                        const raw = e.target.value;
                        updateSpecialPrize(sp.id, {
                          amount: raw === "" ? "" : Number(raw),
                        });
                      }}
                    />
                  </div>
                  {showErrors && se.amount && (
                    <p className="input-hint error mt-0.5">{se.amount}</p>
                  )}
                </div>
                <RemoveButton
                  onClick={() => removeSpecialPrize(sp.id)}
                  label="Remove special prize"
                />
              </div>
            );
          })}
        </div>
      )}

      <AddRowButton onClick={addSpecialPrize}>+ Add Special Prize</AddRowButton>
    </div>
  );
}
