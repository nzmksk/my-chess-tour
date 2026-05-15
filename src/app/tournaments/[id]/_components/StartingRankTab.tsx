import type { StartingRankPlayer } from "../types";

interface Props {
  startingRank: StartingRankPlayer[] | null;
  canViewStartingRank: boolean;
  tournamentStarted: boolean;
  isAuthenticated: boolean;
}

// Maps lowercase country names to ISO 3166-1 alpha-2 codes for flag emoji rendering.
const COUNTRY_NAME_TO_CODE: Record<string, string> = {
  // Southeast Asia
  malaysia: "MY",
  singapore: "SG",
  indonesia: "ID",
  thailand: "TH",
  philippines: "PH",
  vietnam: "VN",
  myanmar: "MM",
  cambodia: "KH",
  laos: "LA",
  brunei: "BN",
  "timor-leste": "TL",
  "east timor": "TL",
  // East Asia
  china: "CN",
  japan: "JP",
  "south korea": "KR",
  korea: "KR",
  taiwan: "TW",
  "hong kong": "HK",
  mongolia: "MN",
  // South Asia
  india: "IN",
  "sri lanka": "LK",
  bangladesh: "BD",
  pakistan: "PK",
  nepal: "NP",
  // Central Asia / Caucasus
  iran: "IR",
  turkey: "TR",
  azerbaijan: "AZ",
  uzbekistan: "UZ",
  kazakhstan: "KZ",
  armenia: "AM",
  georgia: "GE",
  // Europe
  russia: "RU",
  ukraine: "UA",
  germany: "DE",
  france: "FR",
  spain: "ES",
  italy: "IT",
  netherlands: "NL",
  poland: "PL",
  "czech republic": "CZ",
  czechia: "CZ",
  hungary: "HU",
  romania: "RO",
  serbia: "RS",
  croatia: "HR",
  sweden: "SE",
  norway: "NO",
  denmark: "DK",
  finland: "FI",
  austria: "AT",
  switzerland: "CH",
  portugal: "PT",
  greece: "GR",
  bulgaria: "BG",
  slovakia: "SK",
  "united kingdom": "GB",
  uk: "GB",
  england: "GB",
  scotland: "GB",
  wales: "GB",
  ireland: "IE",
  iceland: "IS",
  belgium: "BE",
  latvia: "LV",
  estonia: "EE",
  lithuania: "LT",
  belarus: "BY",
  slovenia: "SI",
  "north macedonia": "MK",
  albania: "AL",
  montenegro: "ME",
  // Americas
  "united states": "US",
  usa: "US",
  canada: "CA",
  brazil: "BR",
  argentina: "AR",
  chile: "CL",
  colombia: "CO",
  peru: "PE",
  mexico: "MX",
  cuba: "CU",
  // Africa
  "south africa": "ZA",
  egypt: "EG",
  nigeria: "NG",
  kenya: "KE",
  morocco: "MA",
  ghana: "GH",
  ethiopia: "ET",
  // Oceania
  australia: "AU",
  "new zealand": "NZ",
};

function nationalityToFlag(nationality: string | null): string | null {
  if (!nationality) return null;
  const code = COUNTRY_NAME_TO_CODE[nationality.toLowerCase().trim()];
  if (!code) return null;
  return [...code.toUpperCase()]
    .map((c) => String.fromCodePoint(c.charCodeAt(0) - 65 + 0x1f1e6))
    .join("");
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

function GenderIcon({ gender }: { gender: "male" | "female" | null }) {
  if (gender === "male")
    return (
      <span className="text-blue-cue" aria-label="Male">
        ♂
      </span>
    );
  if (gender === "female")
    return (
      <span className="text-purception" aria-label="Female">
        ♀
      </span>
    );
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
      <div className="overflow-x-auto">
        <table className="table w-full text-sm">
          <thead>
            <tr className="font-cinzel text-xs uppercase tracking-widest text-text-muted">
              <th className="text-left w-10">#</th>
              <th className="text-left w-10">Nat.</th>
              <th className="text-left">Name</th>
              <th className="text-right">FIDE ID</th>
              <th className="text-right">MCF ID</th>
              <th className="text-right">FIDE</th>
              <th className="text-right">MCF</th>
              <th className="text-center w-10">Gender</th>
            </tr>
          </thead>
          <tbody>
            {startingRank.map((player) => {
              const flag = nationalityToFlag(player.nationality);
              return (
                <tr key={player.user_id}>
                  <td>
                    <span className="font-cinzel text-sm font-semibold text-text-muted">
                      {player.rank}
                    </span>
                  </td>
                  <td>
                    {flag ? (
                      <span
                        aria-label={player.nationality ?? undefined}
                        title={player.nationality ?? undefined}
                      >
                        {flag}
                      </span>
                    ) : player.nationality ? (
                      <span className="font-lato text-xs text-text-muted">
                        {player.nationality}
                      </span>
                    ) : (
                      <span className="text-text-disabled">—</span>
                    )}
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
                    </div>
                  </td>
                  <td className="text-right">
                    {player.fide_id != null ? (
                      <a
                        href={`https://ratings.fide.com/profile/${player.fide_id}`}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="font-lato text-xs text-gold-muted hover:text-gold-bright transition-colors"
                      >
                        {player.fide_id}
                      </a>
                    ) : (
                      <span className="text-text-disabled">—</span>
                    )}
                  </td>
                  <td className="text-right">
                    {player.mcf_id != null ? (
                      <span className="font-lato text-xs text-text-body">
                        {player.mcf_id}
                      </span>
                    ) : (
                      <span className="text-text-disabled">—</span>
                    )}
                  </td>
                  <td className="text-right">
                    {player.fide_rating != null ? (
                      <span className="font-cinzel font-semibold text-text-primary">
                        {player.fide_rating}
                      </span>
                    ) : (
                      <span className="text-text-disabled">—</span>
                    )}
                  </td>
                  <td className="text-right">
                    {player.national_rating != null ? (
                      <span className="font-cinzel font-semibold text-text-primary">
                        {player.national_rating}
                      </span>
                    ) : (
                      <span className="text-text-disabled">—</span>
                    )}
                  </td>
                  <td className="text-center">
                    <GenderIcon gender={player.gender} />
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="font-lato text-xs text-text-muted mt-4 text-right">
        {startingRank.length} player{startingRank.length !== 1 ? "s" : ""}{" "}
        registered
      </p>
    </div>
  );
}
