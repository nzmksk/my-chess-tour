import NavBar from "@/components/NavBar";

const STAT_CARDS = ["registered", "confirmed", "pending"];
const PARTICIPANT_ROWS = [0, 1, 2, 3, 4];

export default function TournamentManageLoading() {
  return (
    <div className="bg-bg-base flex-1">
      <NavBar />
      <div
        className="mx-auto max-w-5xl px-6 py-8"
        role="status"
        aria-busy="true"
        aria-live="polite"
      >
        <span className="sr-only">Loading tournament…</span>

        <div className="mb-4">
          <div className="bg-border h-4 w-36 animate-pulse rounded" />
        </div>

        <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
          <div className="flex flex-col gap-2">
            <div className="bg-border h-7 w-72 max-w-full animate-pulse rounded" />
            <div className="bg-border h-4 w-96 max-w-full animate-pulse rounded" />
          </div>
          <div className="bg-border h-9 w-36 animate-pulse rounded-md" />
        </div>

        <div className="mb-8 grid grid-cols-2 gap-3 sm:grid-cols-3">
          {STAT_CARDS.map((key) => (
            <div key={key} className="card flex flex-col gap-2 px-5 py-4">
              <div className="bg-border h-3 w-20 animate-pulse rounded" />
              <div className="bg-border h-7 w-12 animate-pulse rounded" />
              <div className="bg-border h-3 w-24 animate-pulse rounded" />
            </div>
          ))}
        </div>

        <div className="mb-3 flex flex-wrap items-center justify-between gap-3">
          <div className="bg-border h-5 w-40 animate-pulse rounded" />
          <div className="bg-border h-9 w-56 animate-pulse rounded-md" />
        </div>
        <div className="card overflow-hidden">
          <div className="border-border bg-bg-raised h-11 border-b" />
          {PARTICIPANT_ROWS.map((row) => (
            <div
              key={row}
              className="border-border flex items-center gap-4 border-b px-4 py-3 last:border-b-0"
            >
              <div className="bg-border h-4 w-40 animate-pulse rounded" />
              <div className="bg-border h-4 w-20 animate-pulse rounded" />
              <div className="bg-border ml-auto h-4 w-16 animate-pulse rounded" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
