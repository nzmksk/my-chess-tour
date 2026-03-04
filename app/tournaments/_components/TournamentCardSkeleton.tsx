export default function TournamentCardSkeleton() {
  return (
    <article className="tournament-card" aria-hidden="true">
      {/* Poster placeholder */}
      <div className="skeleton-shimmer" style={{ minHeight: "200px" }} />

      {/* Body */}
      <div
        style={{
          padding: "16px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
        }}
      >
        {/* Badge row */}
        <div
          style={{
            display: "flex",
            gap: "6px",
            marginBottom: "12px",
          }}
        >
          <div
            className="skeleton-shimmer"
            style={{ width: "62px", height: "18px", borderRadius: "2px" }}
          />
          <div
            className="skeleton-shimmer"
            style={{ width: "44px", height: "18px", borderRadius: "2px" }}
          />
        </div>

        {/* Title */}
        <div
          className="skeleton-shimmer"
          style={{
            width: "80%",
            height: "20px",
            borderRadius: "2px",
            marginBottom: "12px",
          }}
        />

        {/* Meta rows */}
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: "8px",
            marginBottom: "16px",
          }}
        >
          <div
            className="skeleton-shimmer"
            style={{ width: "55%", height: "13px", borderRadius: "2px" }}
          />
          <div
            className="skeleton-shimmer"
            style={{ width: "65%", height: "13px", borderRadius: "2px" }}
          />
          <div
            className="skeleton-shimmer"
            style={{ width: "45%", height: "13px", borderRadius: "2px" }}
          />
        </div>

        {/* Footer */}
        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            alignItems: "center",
            paddingTop: "12px",
            borderTop: "1px solid var(--color-border)",
          }}
        >
          <div
            className="skeleton-shimmer"
            style={{ width: "48px", height: "22px", borderRadius: "2px" }}
          />
          <div
            className="skeleton-shimmer"
            style={{ width: "72px", height: "34px", borderRadius: "2px" }}
          />
        </div>
      </div>
    </article>
  );
}
