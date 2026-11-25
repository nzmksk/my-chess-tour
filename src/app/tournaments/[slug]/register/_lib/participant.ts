import {
  getDependent,
  listDependents,
  type DependentView,
} from "@/services/guardianship/dependents";
import { minorAgeOut } from "@/lib/guardianship/age-out";
import {
  formatCalendarDate,
  getTodayInTimeZone,
} from "@/lib/tournaments/datetime";

export interface RegisterParticipant {
  id: string;
  firstName: string;
  name: string;
  isSelf: boolean;
}

export interface ParticipantOption {
  id: string;
  label: string;
  isSelf: boolean;
  disabled: boolean;
}

export type ParticipantChoice =
  | {
      ok: true;
      participants: RegisterParticipant[];
      options: ParticipantOption[];
      selected: RegisterParticipant | null;
    }
  | { ok: false; error: unknown };

const selfParticipant = (userId: string): RegisterParticipant => ({
  id: userId,
  firstName: "You",
  name: "Myself",
  isSelf: true,
});

const fullName = (d: Pick<DependentView, "first_name" | "last_name">) =>
  `${d.first_name} ${d.last_name}`;

const nameKey = (d: Pick<DependentView, "first_name" | "last_name">) =>
  fullName(d).trim().toLowerCase().replace(/\s+/g, " ");

function dependentOption(
  dependent: DependentView,
  sharesName: boolean,
  agedOut: boolean,
): ParticipantOption {
  const notes: string[] = [];
  if (sharesName && dependent.date_of_birth) {
    notes.push(`born ${formatCalendarDate(dependent.date_of_birth)}`);
  }
  if (agedOut) notes.push("turned 18, registers themselves");
  const suffix = notes.length > 0 ? ` (${notes.join(", ")})` : "";
  return {
    id: dependent.id,
    label: `${fullName(dependent)}${suffix}`,
    isSelf: false,
    disabled: agedOut,
  };
}

export async function loadRegisterParticipants(
  userId: string,
  requested: string | undefined,
  today: string = getTodayInTimeZone(),
): Promise<ParticipantChoice> {
  const dependents = await listDependents(userId);
  if (!dependents.ok) return { ok: false, error: dependents.error };

  const nameCounts = new Map<string, number>();
  for (const d of dependents.data) {
    nameCounts.set(nameKey(d), (nameCounts.get(nameKey(d)) ?? 0) + 1);
  }

  const self = selfParticipant(userId);
  const participants: RegisterParticipant[] = [self];
  const options: ParticipantOption[] = [
    { id: self.id, label: self.name, isSelf: true, disabled: false },
  ];
  for (const d of dependents.data) {
    const agedOut = minorAgeOut(d, today).state === "grace";
    options.push(
      dependentOption(d, (nameCounts.get(nameKey(d)) ?? 0) > 1, agedOut),
    );
    if (agedOut) continue;
    participants.push({
      id: d.id,
      firstName: d.first_name,
      name: fullName(d),
      isSelf: false,
    });
  }

  const wanted = requested ?? userId;
  return {
    ok: true,
    participants,
    options,
    selected: participants.find((p) => p.id === wanted) ?? null,
  };
}

export async function resolveReturnParticipant(
  userId: string,
  requested: string | undefined,
): Promise<RegisterParticipant> {
  if (!requested || requested === userId) return selfParticipant(userId);
  const dependent = await getDependent(userId, requested);
  if (!dependent.ok || !dependent.data) return selfParticipant(userId);
  return {
    id: dependent.data.id,
    firstName: dependent.data.first_name,
    name: fullName(dependent.data),
    isSelf: false,
  };
}
