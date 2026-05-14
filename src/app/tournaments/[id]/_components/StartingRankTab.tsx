import type { StartingRankPlayer } from "../types";

interface Props {
  startingRank: StartingRankPlayer[] | null;
  canViewStartingRank: boolean;
  tournamentStarted: boolean;
  isAuthenticated: boolean;
}

function AccessMessage({
  tournamentStarted,
  isAuthenticated,
}: {
  tournamentStarted: boolean;
  isAuthenticated: boolean;
}) {
  if (tournamentStarted) return null;

  const message = isAuthenticated
    ? "Register for this tournament to view the starting rank before the tournament begins."
    : "Sign in and register for this tournament to view the starting rank before it begins.";

  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="text-4xl mb-4 opacity-20">♟</div>
      <p className="font-lato text-sm text-text-muted leading-relaxed max-w-sm">
        {message}
      </p>
    </div>
  );
}

function EmptyState() {
  return (
    <div className="flex flex-col items-center justify-center py-16 px-4 text-center">
      <div className="text-4xl mb-4 opacity-20">♟</div>
      <p className="font-lato text-sm text-text-muted leading-relaxed">
        No confirmed registrations yet.
      </p>
    </div>
  );
}

function RatingDisplay({ player }: { player: StartingRankPlayer }) {
  if (player.fide_rating != null) {
    return (
      <span className="font-cinzel font-semibold text-text-primary">
        {player.fide_rating}
        <span className="font-lato font-normal text-text-muted text-xs ml-1">
          FIDE
        </span>
      </span>
    );
  }
  if (player.national_rating != null) {
    return (
      <span className="font-cinzel font-semibold text-text-primary">
        {player.national_rating}
        <span className="font-lato font-normal text-text-muted text-xs ml-1">
          Nat.
        </span>
      </span>
    );
  }
  return <span className="text-text-disabled">—</span>;
}

export default function StartingRankTab({
  startingRank,
  canViewStartingRank,
  tournamentStarted,
  isAuthenticated,
}: Props) {
  if (!canViewStartingRank) {
    return (
      <AccessMessage
        tournamentStarted={tournamentStarted}
        isAuthenticated={isAuthenticated}
      />
    );
  }

  if (!startingRank || startingRank.length === 0) {
    return <EmptyState />;
  }

  return (
    <div>
      <table className="table w-full">
        <thead>
          <tr>
            <th className="text-left w-12">#</th>
            <th className="text-left">Player</th>
            <th className="text-right">Rating</th>
          </tr>
        </thead>
        <tbody>
          {startingRank.map((player) => (
            <tr key={player.user_id}>
              <td>
                <span className="font-cinzel text-sm font-semibold text-text-muted">
                  {player.rank}
                </span>
              </td>
              <td>
                <div className="flex items-center gap-2">
                  {player.title && (
                    <span className="font-cinzel text-2xs font-bold tracking-widest uppercase px-1.5 py-0.5 rounded bg-gold-ghost text-gold-bright border border-gold-dim">
                      {player.title}
                    </span>
                  )}
                  <span className="font-lato text-sm text-text-body">
                    {player.name}
                  </span>
                  {player.fide_id != null && (
                    <span className="font-lato text-xs text-text-muted">
                      ({player.fide_id})
                    </span>
                  )}
                </div>
              </td>
              <td className="text-right">
                <RatingDisplay player={player} />
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="font-lato text-xs text-text-muted mt-4 text-right">
        {startingRank.length} player{startingRank.length !== 1 ? "s" : ""}{" "}
        registered
      </p>
    </div>
  );
}
