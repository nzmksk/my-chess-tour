// Client-side avatar plumbing shared by the navbar and the settings page.
//
// The avatar URL is read often (every navbar render) but changes rarely (only
// when the user uploads or removes a photo). To avoid a DB round-trip on every
// navigation we treat it as a layered cache:
//
//   1. user_metadata.avatar_url — durable source of truth, mirrored server-side
//      and delivered for free by supabase.auth (incl. cross-tab/-device once the
//      session token refreshes).
//   2. sessionStorage — seeds reads instantly and survives hard reloads, for
//      accounts whose token hasn't picked up the mirror yet.
//   3. BroadcastChannel — pushes a freshly-saved URL to the navbar (and other
//      tabs) the moment the upload finishes, before the token refresh lands.

const CHANNEL = "mct-avatar";
const STORAGE_PREFIX = "mct:avatar:";

export type AvatarMessage = { userId: string; url: string | null };

// Reads the avatar mirrored onto the auth user. Returns `undefined` when the
// key was never set (account not yet backfilled — caller should fall back to a
// one-time DB read), and `null` when the user has explicitly no avatar.
export function avatarFromMetadata(
  user: { user_metadata?: Record<string, unknown> | null } | null | undefined,
): string | null | undefined {
  const meta = user?.user_metadata;
  if (!meta || !("avatar_url" in meta)) return undefined;
  return (meta.avatar_url as string | null) ?? null;
}

export function readCachedAvatar(userId: string): string | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage.getItem(STORAGE_PREFIX + userId);
  } catch {
    return null;
  }
}

export function writeCachedAvatar(userId: string, url: string | null): void {
  if (typeof window === "undefined") return;
  try {
    if (url === null) {
      window.sessionStorage.removeItem(STORAGE_PREFIX + userId);
    } else {
      window.sessionStorage.setItem(STORAGE_PREFIX + userId, url);
    }
  } catch {
    // Storage may be full or disabled (private mode); the cache is best-effort.
  }
}

// Persists the new URL and notifies any open navbar/tab so it updates without a
// DB query. Call this right after a successful save.
export function broadcastAvatar(userId: string, url: string | null): void {
  writeCachedAvatar(userId, url);
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

// Subscribes to avatar changes from other components/tabs. Mirrors each update
// into this tab's sessionStorage so a later read stays consistent.
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
      writeCachedAvatar(data.userId, data.url ?? null);
      onChange({ userId: data.userId, url: data.url ?? null });
    }
  };
  return () => channel.close();
}
