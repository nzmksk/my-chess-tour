import { beforeEach, describe, expect, it, vi } from "vitest";

const mockCreateBrowserClient = vi.hoisted(() =>
  vi.fn(() => ({ mock: "browser-client" })),
);

vi.mock("@supabase/ssr", () => ({
  createBrowserClient: mockCreateBrowserClient,
}));

import { createClient } from "../client";

beforeEach(() => {
  vi.clearAllMocks();
});

describe("createClient (browser)", () => {
  it("creates a browser client with the public Supabase env vars", () => {
    process.env.NEXT_PUBLIC_SUPABASE_URL = "https://proj.supabase.co";
    process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY = "anon-key";

    const client = createClient();

    expect(mockCreateBrowserClient).toHaveBeenCalledWith(
      "https://proj.supabase.co",
      "anon-key",
    );
    expect(client).toEqual({ mock: "browser-client" });
  });
});
