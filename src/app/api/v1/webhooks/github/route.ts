import crypto from "node:crypto";
import { revalidateTag } from "next/cache";
import { NextRequest, NextResponse } from "next/server";
import { GITHUB_RELEASES_TAG } from "@/services/github/releases";

// Needs the Node.js runtime for `crypto` and the raw request body.
export const runtime = "nodejs";

/**
 * GitHub's repository webhook (#640). The changelog is read from the GitHub
 * releases and cached with no time limit; any `release` event (published,
 * edited, deleted, ...) invalidates that cache so the next request reads the
 * releases again.
 *
 * Set up one webhook per site (Settings → Webhooks): payload URL
 * `<site>/api/v1/webhooks/github`, content type application/json, the
 * site's GITHUB_WEBHOOK_SECRET as the secret, and the "Releases" event.
 * GitHub signs each delivery with that secret (X-Hub-Signature-256).
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const secret = process.env.GITHUB_WEBHOOK_SECRET;
  if (!secret) {
    console.error("GitHub webhook: GITHUB_WEBHOOK_SECRET is not configured");
    return NextResponse.json(
      {
        error: {
          code: "MISCONFIGURED",
          message: "GITHUB_WEBHOOK_SECRET is not configured",
        },
      },
      { status: 500 },
    );
  }

  // The signature is over these exact bytes, so read them before parsing.
  const raw = await request.text();
  if (
    !verifySignature(raw, request.headers.get("x-hub-signature-256"), secret)
  ) {
    return NextResponse.json(
      {
        error: {
          code: "UNAUTHORIZED",
          message: "Invalid or missing signature",
        },
      },
      { status: 401 },
    );
  }

  if (request.headers.get("x-github-event") !== "release") {
    // `ping` when the webhook is created, or an event it shouldn't be
    // subscribed to: acknowledge so GitHub doesn't mark the delivery failed.
    return NextResponse.json({ data: { received: true, revalidated: false } });
  }

  // "max": the next request is served the cached releases once while fresh
  // ones are fetched, and if GitHub fails then, the old ones stay.
  revalidateTag(GITHUB_RELEASES_TAG, "max");
  return NextResponse.json({ data: { received: true, revalidated: true } });
}

function verifySignature(
  raw: string,
  header: string | null,
  secret: string,
): boolean {
  if (!header) return false;
  const expected = Buffer.from(
    `sha256=${crypto.createHmac("sha256", secret).update(raw).digest("hex")}`,
  );
  const received = Buffer.from(header);
  return (
    received.length === expected.length &&
    crypto.timingSafeEqual(received, expected)
  );
}
