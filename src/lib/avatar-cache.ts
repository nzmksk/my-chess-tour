// Cross-tab avatar sync. The Zustand auth store owns the in-tab state and its
// sessionStorage persistence; this module only carries an avatar change to other
// open tabs (a BroadcastChannel message) so they update without a round-trip.

const CHANNEL = "mct-avatar";

export type AvatarMessage = { userId: string; url: string | null };

// Notifies other tabs that a user's avatar changed. Call after a successful save.
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

// Subscribes to avatar changes broadcast from other tabs.
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
