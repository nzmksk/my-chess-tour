import Image from "next/image";
import Link from "next/link";
import type { PublicPlayerProfile } from "@/app/profile/types";

interface StatCardProps {
  label: string;
  value: string | number;
}

function StatCard({ label, value }: StatCardProps) {
  return (
    <div className="card flex flex-col gap-1 p-5">
      <span className="font-cinzel text-gold-muted text-xs font-semibold tracking-widest uppercase">
        {label}
      </span>
      <span className="font-cinzel text-text-primary text-2xl font-bold">
        {value}
      </span>
    </div>
  );
}

interface Props {
  profile: PublicPlayerProfile;
  isOwner: boolean;
}

export default function PublicProfile({ profile, isOwner }: Props) {
  const initials =
    `${profile.first_name[0] ?? ""}${profile.last_name[0] ?? ""}`.toUpperCase() ||
    "?";

  const fullName = [profile.first_name, profile.last_name]
    .filter(Boolean)
    .join(" ");

  const fide = profile.fide_rating;
  const fmt = (n: number | null | undefined) => (n != null ? n : "—");

  return (
    <div className="mx-auto max-w-2xl px-6 py-8">
      {/* Header */}
      <div className="mb-8 flex items-center gap-5">
        <div className="bg-gold-ghost border-gold-muted font-cinzel text-gold-bright relative flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-full border-2 text-xl font-semibold">
          {profile.avatar_url ? (
            <Image
              src={profile.avatar_url}
              alt={`${fullName || "Profile"} avatar`}
              fill
              unoptimized
              className="object-cover"
            />
          ) : (
            initials
          )}
        </div>
        <div className="min-w-0 flex-1">
          <h1 className="font-cinzel text-text-primary text-2xl leading-tight font-bold tracking-wide">
            {fullName}
          </h1>
          {profile.nationality && (
            <p className="font-lato text-text-muted mt-0.5 text-sm">
              {profile.nationality}
            </p>
          )}
          {profile.title && (
            <span className="font-cinzel bg-info-bg text-info border-info-border mt-1.5 inline-block rounded border px-2 py-0.5 text-xs font-bold tracking-widest uppercase">
              {profile.title}
            </span>
          )}
        </div>
        {isOwner && (
          <Link
            href="/settings"
            className="btn-secondary shrink-0 px-4 py-2 text-xs"
          >
            Edit Profile
          </Link>
        )}
      </div>

      {/* Stats */}
      <div className="mb-4 grid grid-cols-2 gap-4 sm:grid-cols-3">
        <StatCard
          label="Tournaments Joined"
          value={profile.tournaments_joined}
        />
        <StatCard label="FIDE Standard" value={fmt(fide?.standard)} />
        <StatCard label="FIDE Rapid" value={fmt(fide?.rapid)} />
        <StatCard label="FIDE Blitz" value={fmt(fide?.blitz)} />
        <StatCard
          label="National Rating"
          value={fmt(profile.national_rating)}
        />
      </div>

      {/* IDs */}
      <div className="card p-6">
        <h2 className="font-cinzel text-text-primary border-border mb-4 border-b pb-3 text-base font-semibold tracking-wider">
          Identifiers
        </h2>
        <div className="border-border flex flex-col gap-0.5 border-b py-3">
          <span className="font-cinzel text-gold-muted text-xs font-semibold tracking-widest uppercase">
            FIDE ID
          </span>
          <span className="font-lato text-text-body text-sm">
            {profile.fide_id ?? "—"}
          </span>
        </div>
        <div className="flex flex-col gap-0.5 py-3">
          <span className="font-cinzel text-gold-muted text-xs font-semibold tracking-widest uppercase">
            MCF ID
          </span>
          <span className="font-lato text-text-body text-sm">
            {profile.mcf_id ?? "—"}
          </span>
        </div>
      </div>
    </div>
  );
}
