import { beforeEach, vi } from "vitest";
import { resetAfterCallbacks } from "./after";
import { appIdFor } from "./identity";

vi.mock("next/server", async (importOriginal) => ({
  ...(await importOriginal<typeof import("next/server")>()),
  after: (await import("./after")).after,
}));

beforeEach(() => {
  resetAfterCallbacks();
});

vi.mock("@/services/supabase/identity", () => ({
  lookupAppUserId: vi.fn(async (authUserId: string) => appIdFor(authUserId)),
}));

vi.mock("@/services/rate-limit/window", () => ({
  hitWindow: vi.fn(async () => 0),
  countHit: vi.fn(async () => ({ count: 1, ttl: 60 })),
  peekCount: vi.fn(async () => 0),
  resetCount: vi.fn(async () => undefined),
}));
