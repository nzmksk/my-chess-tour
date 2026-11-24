"use client";

import { useTransition } from "react";
import { usePathname, useRouter } from "next/navigation";

interface PickerOption {
  id: string;
  name: string;
  isSelf: boolean;
}

interface Props {
  participants: PickerOption[];
  selectedId: string;
}

export default function ParticipantPicker({ participants, selectedId }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  function choose(id: string) {
    const next = participants.find((p) => p.id === id);
    if (!next || next.id === selectedId) return;
    const query = next.isSelf
      ? ""
      : `?participant=${encodeURIComponent(next.id)}`;
    startTransition(() => {
      router.push(`${pathname}${query}`);
    });
  }

  return (
    <div className="card mx-auto mb-4 flex max-w-lg flex-col gap-2 p-6">
      <label
        htmlFor="register-participant"
        className="font-cinzel text-text-muted text-xs font-semibold tracking-widest uppercase"
      >
        Who is playing?
      </label>
      <div className="relative">
        <select
          id="register-participant"
          value={selectedId}
          onChange={(e) => choose(e.target.value)}
          disabled={pending}
          className="border-border bg-bg-raised font-lato text-text-primary focus:border-gold-bright w-full cursor-pointer appearance-none rounded-md border px-3 py-2.5 pr-8 text-sm transition-colors focus:outline-none disabled:cursor-wait disabled:opacity-60"
        >
          {participants.map((p) => (
            <option key={p.id} value={p.id}>
              {p.name}
            </option>
          ))}
        </select>
        <span className="text-text-muted pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 text-xs">
          ▾
        </span>
      </div>
      <p className="font-lato text-text-muted text-xs">
        You can register yourself or a player you look after. Manage them under
        Settings, Dependents.
      </p>
    </div>
  );
}
