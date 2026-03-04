import TournamentCardSkeleton from "./TournamentCardSkeleton";

const SKELETON_COUNT = 6;

export default function TournamentsGridSkeleton() {
  return (
    <>
      {/* Filter bar skeleton */}
      <div
        style={{
          background: "var(--color-bg-surface)",
          borderBottom: "1px solid var(--color-border)",
          padding: "16px 0",
        }}
      >
        <div
          style={{
            maxWidth: "1200px",
            margin: "0 auto",
            padding: "0 40px",
          }}
        >
          {/* Search bar */}
          <div
            className="skeleton-shimmer"
            style={{ width: "100%", height: "42px", borderRadius: "2px" }}
          />

          {/* Filter buttons */}
          <div
            style={{
              display: "flex",
              gap: "10px",
              marginTop: "12px",
            }}
          >
            {[80, 68, 72, 84].map((w, i) => (
              <div
                key={i}
                className="skeleton-shimmer"
                style={{ width: `${w}px`, height: "40px", borderRadius: "2px" }}
              />
            ))}
          </div>
        </div>
      </div>

      {/* Card grid */}
      <div
        style={{
          maxWidth: "1200px",
          margin: "0 auto",
          padding: "24px 40px",
        }}
      >
        <div
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(auto-fill, minmax(400px, 1fr))",
            gap: "16px",
          }}
        >
          {Array.from({ length: SKELETON_COUNT }).map((_, i) => (
            <TournamentCardSkeleton key={i} />
          ))}
        </div>
      </div>
    </>
  );
}
