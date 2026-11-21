import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const ACTOR = "11111111-1111-4111-8111-111111111111";

const fetchMock = vi.fn(
  async () =>
    new Response("[]", {
      status: 200,
      headers: { "content-type": "application/json" },
    }),
);

async function loadAdmin() {
  vi.resetModules();
  const { supabaseAdmin } = await import("../admin");
  const { runWithAuditContext } = await import("../audit-context");
  return { supabaseAdmin, runWithAuditContext };
}

function lastRequestHeaders(): Headers {
  const [, init] = fetchMock.mock.calls.at(-1) as unknown as [
    unknown,
    RequestInit,
  ];
  return new Headers(init.headers);
}

describe("supabaseAdmin", () => {
  beforeEach(() => {
    vi.stubEnv("NEXT_PUBLIC_SUPABASE_URL", "https://project.supabase.test");
    vi.stubEnv("SUPABASE_SECRET_KEY", "sb_secret_test");
    vi.stubGlobal("fetch", fetchMock);
    fetchMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
    vi.unstubAllGlobals();
  });

  it("sends the audit actor and context on a write inside a scope", async () => {
    const { supabaseAdmin, runWithAuditContext } = await loadAdmin();

    await runWithAuditContext(
      "tournament.publish",
      async () => {
        await supabaseAdmin
          .from("tournaments")
          .update({ status: "published" })
          .eq("id", "t1");
      },
      ACTOR,
    );

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const headers = lastRequestHeaders();
    expect(headers.get("x-audit-context")).toBe("tournament.publish");
    expect(headers.get("x-audit-actor")).toBe(ACTOR);
    expect(headers.get("apikey")).toBe("sb_secret_test");
  });

  it("labels RPC calls too", async () => {
    const { supabaseAdmin, runWithAuditContext } = await loadAdmin();

    await runWithAuditContext("webhook.chip", () =>
      supabaseAdmin.rpc("settle_refund", { p_refund_id: "r1" }),
    );

    const headers = lastRequestHeaders();
    expect(headers.get("x-audit-context")).toBe("webhook.chip");
    expect(headers.has("x-audit-actor")).toBe(false);
  });

  it("sends no audit headers outside a scope", async () => {
    const { supabaseAdmin } = await loadAdmin();

    await supabaseAdmin.from("tournaments").select("id");

    const headers = lastRequestHeaders();
    expect(headers.has("x-audit-context")).toBe(false);
    expect(headers.has("x-audit-actor")).toBe(false);
  });
});
