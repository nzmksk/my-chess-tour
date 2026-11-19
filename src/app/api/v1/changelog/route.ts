import { NextRequest, NextResponse } from "next/server";
import {
  compareVersions,
  isReleaseVersion,
  releasedEntries,
} from "@/lib/changelog";
import { INTERNAL_ERROR_MESSAGE } from "@/lib/http/internal-error";
import { loadChangelog } from "@/services/github/releases";

/**
 * GET /api/v1/changelog?after=v0.10.0-alpha
 *
 * The releases newer than `after` that this build carries, newest first
 * (#640). The "What's new" dialog calls it with the last release a browser
 * saw, only when that's older than the build's own version, so it never
 * downloads the whole changelog. Public: the releases are public on GitHub.
 */
export async function GET(request: NextRequest): Promise<NextResponse> {
  const after = request.nextUrl.searchParams.get("after");
  if (!after || !isReleaseVersion(after)) {
    return NextResponse.json(
      {
        error: {
          code: "VALIDATION_ERROR",
          message: "after must be a release version, such as v0.10.0-alpha",
        },
      },
      { status: 400 },
    );
  }

  // loadChangelog has logged the failure.
  const changelog = await loadChangelog();
  if (!changelog) {
    return NextResponse.json(
      { error: { code: "INTERNAL_ERROR", message: INTERNAL_ERROR_MESSAGE } },
      { status: 503 },
    );
  }

  const entries = releasedEntries(
    changelog,
    process.env.APP_VERSION ?? "",
  ).filter((entry) => compareVersions(entry.version, after) > 0);
  return NextResponse.json({ data: { entries } });
}
