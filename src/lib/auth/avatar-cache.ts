const CHANNEL = "mct-avatar";

export type AvatarMessage = { userId: string; url: string | null };

export function broadcastAvatar(userId: string, url: string | null): void {
  if (
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined"
  ) {
    return;
  }
  const channel = new BroadcastChannel(CHANNEL);
  channel.postMessage({ userId, url } satisfies AvatarMessage);
  channel.close();
}

export function subscribeAvatar(
  onChange: (message: AvatarMessage) => void,
): () => void {
  if (
    typeof window === "undefined" ||
    typeof BroadcastChannel === "undefined"
  ) {
    return () => {};
  }
  const channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (event: MessageEvent<AvatarMessage>) => {
    const data = event.data;
    if (data && typeof data.userId === "string") {
      onChange({ userId: data.userId, url: data.url ?? null });
    }
  };
  return () => channel.close();
}
