import {
  getDependent,
  listDependents,
} from "@/services/guardianship/dependents";

export interface RegisterParticipant {
  id: string;
  firstName: string;
  name: string;
  isSelf: boolean;
}

export type ParticipantChoice =
  | {
      ok: true;
      participants: RegisterParticipant[];
      selected: RegisterParticipant | null;
    }
  | { ok: false; error: unknown };

const selfParticipant = (userId: string): RegisterParticipant => ({
  id: userId,
  firstName: "You",
  name: "Myself",
  isSelf: true,
});

export async function loadRegisterParticipants(
  userId: string,
  requested: string | undefined,
): Promise<ParticipantChoice> {
  const dependents = await listDependents(userId);
  if (!dependents.ok) return { ok: false, error: dependents.error };

  const participants = [
    selfParticipant(userId),
    ...dependents.data.map((d) => ({
      id: d.id,
      firstName: d.first_name,
      name: `${d.first_name} ${d.last_name}`,
      isSelf: false,
    })),
  ];
  const wanted = requested ?? userId;
  return {
    ok: true,
    participants,
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
    name: `${dependent.data.first_name} ${dependent.data.last_name}`,
    isSelf: false,
  };
}
