"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { formatCalendarDate } from "@/lib/tournaments/datetime";
import type { DependentView } from "@/services/guardianship/dependents";
import AddDependentForm from "./AddDependentForm";
import DependentCard from "./DependentCard";
import {
  fetchDependents,
  type CreatedDependent,
  type RevokeResult,
  type UpcomingRegistration,
} from "./dependents-api";

interface Notice {
  message: string;
  upcoming: UpcomingRegistration[];
}

export default function DependentsManager() {
  const [dependents, setDependents] = useState<DependentView[] | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [adding, setAdding] = useState(false);
  const [notice, setNotice] = useState<Notice | null>(null);
  const noticeRef = useRef<HTMLDivElement>(null);
  const addButtonRef = useRef<HTMLButtonElement>(null);

  const apply = useCallback(
    (result: Awaited<ReturnType<typeof fetchDependents>>) => {
      if (result.ok) {
        setDependents(result.data);
        setLoadError(null);
      } else {
        setLoadError(result.error);
      }
    },
    [],
  );

  useEffect(() => {
    let cancelled = false;
    fetchDependents().then((result) => {
      if (!cancelled) apply(result);
    });
    return () => {
      cancelled = true;
    };
  }, [apply]);

  useEffect(() => {
    if (notice) noticeRef.current?.focus();
  }, [notice]);

  const returnFocus = useRef(false);

  useEffect(() => {
    if (!adding && returnFocus.current) {
      returnFocus.current = false;
      addButtonRef.current?.focus();
    }
  }, [adding]);

  function handleAdded(created: CreatedDependent) {
    setAdding(false);
    setDependents((list) => [
      ...(list ?? []).filter((d) => d.id !== created.id),
      created,
    ]);
    setNotice({
      message: created.reactivated
        ? `${created.first_name} ${created.last_name} is back on your account, with their earlier registrations.`
        : `${created.first_name} ${created.last_name} was added. You can now register them for tournaments.`,
      upcoming: [],
    });
  }

  function handleUpdated(updated: DependentView) {
    setDependents((list) =>
      (list ?? []).map((d) => (d.id === updated.id ? updated : d)),
    );
  }

  function handleRemoved(removed: DependentView, result: RevokeResult) {
    setDependents((list) => (list ?? []).filter((d) => d.id !== removed.id));
    setNotice({
      message:
        result.warning ??
        `${removed.first_name} ${removed.last_name} was removed from your account.`,
      upcoming: result.upcoming_registrations,
    });
  }

  function cancelAdding() {
    returnFocus.current = true;
    setAdding(false);
  }

  return (
    <div className="flex flex-col gap-6">
      <div ref={noticeRef} tabIndex={-1} className="outline-none">
        <div role="status" aria-live="polite">
          {notice && (
            <div
              className={
                notice.upcoming.length > 0 ? "info-banner" : "success-banner"
              }
            >
              <div>
                <p
                  className={
                    notice.upcoming.length > 0 ? "info-text" : "success-text"
                  }
                >
                  {notice.message}
                </p>
                {notice.upcoming.length > 0 && (
                  <ul className="font-lato text-info mt-2 list-disc pl-5 text-sm">
                    {notice.upcoming.map((r) => (
                      <li key={r.registration_id}>
                        {r.tournament_name}, starting{" "}
                        {formatCalendarDate(r.start_date)}
                      </li>
                    ))}
                  </ul>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {loadError && (
        <div className="error-banner" role="alert">
          <p className="error-text">
            {loadError} Refresh the page to try again.
          </p>
        </div>
      )}

      {!dependents && !loadError && (
        <p className="font-lato text-text-muted text-sm" role="status">
          Loading your dependents…
        </p>
      )}

      {dependents && dependents.length === 0 && !adding && (
        <div className="card p-6">
          <p className="font-lato text-text-secondary text-sm">
            You haven&apos;t added anyone yet. Add your child, or an adult who
            has asked you to manage their chess, to register them for
            tournaments from your account.
          </p>
        </div>
      )}

      {dependents && dependents.length > 0 && (
        <ul className="flex flex-col gap-4" aria-label="Your dependents">
          {dependents.map((dependent) => (
            <DependentCard
              key={dependent.id}
              dependent={dependent}
              onUpdated={handleUpdated}
              onRemoved={handleRemoved}
            />
          ))}
        </ul>
      )}

      {dependents && adding && (
        <AddDependentForm onAdded={handleAdded} onCancel={cancelAdding} />
      )}

      {dependents && !adding && (
        <button
          ref={addButtonRef}
          type="button"
          className="btn-primary px-6 sm:w-fit"
          onClick={() => {
            setNotice(null);
            setAdding(true);
          }}
        >
          Add a Dependent
        </button>
      )}
    </div>
  );
}
