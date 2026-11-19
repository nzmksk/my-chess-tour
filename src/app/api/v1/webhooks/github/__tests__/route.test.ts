import crypto from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { NextRequest } from "next/server";

const { mockRevalidateTag } = vi.hoisted(() => ({
  mockRevalidateTag: vi.fn(),
}));
vi.mock("next/cache", () => ({ revalidateTag: mockRevalidateTag }));
vi.mock("@/services/github/releases", () => ({
  GITHUB_RELEASES_TAG: "github-releases",
}));

import { POST } from "../route";

const SECRET = "webhook-secret";
const BODY = JSON.stringify({ action: "published", release: { id: 1 } });

function sign(body: string, secret = SECRET) {
  return `sha256=${crypto.createHmac("sha256", secret).update(body).digest("hex")}`;
}

function delivery({
  event = "release",
  body = BODY,
  signature = sign(BODY),
}: {
  event?: string;
  body?: string;
  signature?: string | null;
} = {}) {
  const headers: Record<string, string> = {
    "content-type": "application/json",
    "x-github-event": event,
  };
  if (signature !== null) headers["x-hub-signature-256"] = signature;
  return new NextRequest("http://localhost/api/v1/webhooks/github", {
    method: "POST",
    headers,
    body,
  });
}

describe("POST /api/v1/webhooks/github", () => {
  beforeEach(() => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", SECRET);
    mockRevalidateTag.mockClear();
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("invalidates the cached releases on a release event", async () => {
    const response = await POST(delivery());
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { received: true, revalidated: true },
    });
    expect(mockRevalidateTag).toHaveBeenCalledWith("github-releases", "max");
  });

  it("acknowledges a ping without invalidating anything", async () => {
    const body = JSON.stringify({ zen: "Keep it logically awesome." });
    const response = await POST(
      delivery({ event: "ping", body, signature: sign(body) }),
    );
    expect(response.status).toBe(200);
    expect(await response.json()).toEqual({
      data: { received: true, revalidated: false },
    });
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("acknowledges other events without invalidating anything", async () => {
    const response = await POST(delivery({ event: "push" }));
    expect(response.status).toBe(200);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("refuses a delivery without a signature", async () => {
    const response = await POST(delivery({ signature: null }));
    expect(response.status).toBe(401);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("refuses a delivery signed with another secret", async () => {
    const response = await POST(
      delivery({ signature: sign(BODY, "someone-else") }),
    );
    expect(response.status).toBe(401);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("refuses a body that doesn't match its signature", async () => {
    const response = await POST(
      delivery({ body: JSON.stringify({ action: "deleted" }) }),
    );
    expect(response.status).toBe(401);
    expect(mockRevalidateTag).not.toHaveBeenCalled();
  });

  it("refuses a malformed signature header", async () => {
    const response = await POST(delivery({ signature: "sha256=abc" }));
    expect(response.status).toBe(401);
  });

  it("fails loudly when the secret isn't configured", async () => {
    vi.stubEnv("GITHUB_WEBHOOK_SECRET", "");
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});
    const response = await POST(delivery());
    expect(response.status).toBe(500);
    expect((await response.json()).error.code).toBe("MISCONFIGURED");
    expect(mockRevalidateTag).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });
});
