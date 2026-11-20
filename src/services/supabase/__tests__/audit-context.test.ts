import { describe, expect, it } from "vitest";
import {
  noteAuditActor,
  runWithAuditContext,
  withAuditContext,
  withAuditHeaders,
} from "../audit-context";

const ACTOR = "11111111-1111-4111-8111-111111111111";
const OTHER = "22222222-2222-4222-8222-222222222222";

function headersOf(init: RequestInit | undefined): Headers {
  return new Headers(init?.headers);
}

describe("withAuditHeaders", () => {
  it("returns init unchanged outside a scope", async () => {
    const init = { method: "POST", headers: { apikey: "k" } };
    expect(withAuditHeaders(init)).toBe(init);
    expect(withAuditHeaders(undefined)).toBeUndefined();
  });

  it("adds the context, and no actor until one is known", async () => {
    await runWithAuditContext("webhook.chip", () => {
      const headers = headersOf(withAuditHeaders({ method: "POST" }));
      expect(headers.get("x-audit-context")).toBe("webhook.chip");
      expect(headers.has("x-audit-actor")).toBe(false);
    });
  });

  it("keeps the request's own headers and options", async () => {
    await runWithAuditContext(
      "tournament.publish",
      () => {
        const init = withAuditHeaders({
          method: "PATCH",
          body: "{}",
          headers: new Headers({ apikey: "k", Authorization: "Bearer t" }),
        });
        const headers = headersOf(init);
        expect(init?.method).toBe("PATCH");
        expect(init?.body).toBe("{}");
        expect(headers.get("apikey")).toBe("k");
        expect(headers.get("authorization")).toBe("Bearer t");
        expect(headers.get("x-audit-actor")).toBe(ACTOR);
      },
      ACTOR,
    );
  });
});

describe("noteAuditActor", () => {
  it("fills in the actor of the current scope", async () => {
    await runWithAuditContext("org.update", () => {
      noteAuditActor(ACTOR);
      expect(headersOf(withAuditHeaders()).get("x-audit-actor")).toBe(ACTOR);
    });
  });

  it("never replaces an actor already set", async () => {
    await runWithAuditContext(
      "registration.payment-return",
      () => {
        noteAuditActor(OTHER);
        expect(headersOf(withAuditHeaders()).get("x-audit-actor")).toBe(ACTOR);
      },
      ACTOR,
    );
  });

  it("does nothing outside a scope", async () => {
    expect(() => noteAuditActor(ACTOR)).not.toThrow();
    expect(withAuditHeaders(undefined)).toBeUndefined();
  });
});

describe("scopes", () => {
  it("follow the request across awaits", async () => {
    await runWithAuditContext("cron.refunds", async () => {
      await new Promise((resolve) => setTimeout(resolve, 1));
      noteAuditActor(ACTOR);
      await Promise.resolve();
      const headers = headersOf(withAuditHeaders());
      expect(headers.get("x-audit-context")).toBe("cron.refunds");
      expect(headers.get("x-audit-actor")).toBe(ACTOR);
    });
  });

  it("are isolated between concurrent requests", async () => {
    const seen = await Promise.all(
      [ACTOR, OTHER].map((actor, i) =>
        runWithAuditContext(`ctx.${i}`, async () => {
          noteAuditActor(actor);
          await new Promise((resolve) => setTimeout(resolve, 5 - i * 4));
          const headers = headersOf(withAuditHeaders());
          return [headers.get("x-audit-context"), headers.get("x-audit-actor")];
        }),
      ),
    );
    expect(seen).toEqual([
      ["ctx.0", ACTOR],
      ["ctx.1", OTHER],
    ]);
  });

  it("an inner scope replaces the outer one, then gives it back", async () => {
    await runWithAuditContext(
      "outer",
      async () => {
        await runWithAuditContext("payment.expire-stale", () => {
          const headers = headersOf(withAuditHeaders());
          expect(headers.get("x-audit-context")).toBe("payment.expire-stale");
          expect(headers.has("x-audit-actor")).toBe(false);
        });
        expect(headersOf(withAuditHeaders()).get("x-audit-context")).toBe(
          "outer",
        );
      },
      ACTOR,
    );
  });
});

describe("withAuditContext", () => {
  it("passes the arguments through and returns the handler's result", async () => {
    const handler = withAuditContext(
      "invitation.revoke",
      async (a: number, b: { id: string }) => {
        const headers = headersOf(withAuditHeaders());
        return `${a}:${b.id}:${headers.get("x-audit-context")}`;
      },
    );
    await expect(handler(1, { id: "x" })).resolves.toBe(
      "1:x:invitation.revoke",
    );
  });

  it("opens a fresh scope per call", async () => {
    const handler = withAuditContext("org.update", async (actor: string) => {
      noteAuditActor(actor);
      await Promise.resolve();
      return headersOf(withAuditHeaders()).get("x-audit-actor");
    });
    await expect(handler(ACTOR)).resolves.toBe(ACTOR);
    await expect(handler(OTHER)).resolves.toBe(OTHER);
  });
});
