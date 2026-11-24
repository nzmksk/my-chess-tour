interface PlayerAccountHolder {
  account_holder: string;
  entered_by: string | null;
}

interface PlayerName {
  first_name: string | null;
  last_name: string | null;
}

export function expectedPlayerHolderName(
  account: PlayerAccountHolder,
  player: PlayerName | null,
): string | null {
  if (!account.entered_by) return account.account_holder;
  const name = [player?.first_name, player?.last_name]
    .filter(Boolean)
    .join(" ");
  return name || null;
}
