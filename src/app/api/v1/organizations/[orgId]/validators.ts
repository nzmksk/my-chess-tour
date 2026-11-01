import { NextResponse } from "next/server";
import { validateEmail } from "@/services/auth/auth-validation";
import {
  orgAvatarPrefix,
  validateOrgLinks,
  type OrgLink,
} from "../_lib/org-fields";

export interface OrgUpdate {
  name?: string;
  description?: string | null;
  links?: OrgLink[] | null;
  email?: string;
  phone?: string | null;
  past_tournament_refs?: string | null;
  avatar_url?: string | null;
}

/**
 * A partial update of an organization's public profile.
 *
 * Deliberately does NOT accept `entity_type`, `registration_number`,
 * `approval_status`, `agreement_*` or anything on organization_bank_accounts.
 * The first two are the business identity a platform admin approved — changing
 * them would invalidate that decision silently — and the rest have their own
 * gated paths (the admin review RPC, the agreement route, the bank-account
 * route). A field absent from this shape cannot be written by this endpoint
 * even by accident.
 */
export function validateOrgUpdate(
  body: unknown,
  orgId: string,
): { data: OrgUpdate } | { error: NextResponse } {
  const fail = (message: string) => ({
    error: NextResponse.json(
      { error: { code: "VALIDATION_ERROR", message } },
      { status: 400 },
    ),
  });

  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return fail("Invalid request body");
  }

  const b = body as Record<string, unknown>;
  const update: OrgUpdate = {};

  if ("name" in b) {
    if (typeof b.name !== "string" || b.name.trim() === "") {
      return fail("Organization name is required");
    }
    if (b.name.trim().length > 255) {
      return fail("Organization name must be 255 characters or fewer");
    }
    update.name = b.name.trim();
  }

  if ("email" in b) {
    if (typeof b.email !== "string" || !validateEmail(b.email)) {
      return fail("Invalid email address");
    }
    update.email = b.email.trim();
  }

  if ("links" in b) {
    const linksError = validateOrgLinks(b.links);
    if (linksError) return fail(linksError);
    update.links =
      Array.isArray(b.links) && b.links.length > 0
        ? (b.links as OrgLink[])
        : null;
  }

  if ("description" in b) {
    update.description =
      typeof b.description === "string" ? b.description.trim() || null : null;
  }

  if ("phone" in b) {
    if (typeof b.phone === "string" && b.phone.trim().length > 20) {
      return fail("Phone number must be 20 characters or fewer");
    }
    update.phone = typeof b.phone === "string" ? b.phone.trim() || null : null;
  }

  if ("past_tournament_refs" in b) {
    update.past_tournament_refs =
      typeof b.past_tournament_refs === "string"
        ? b.past_tournament_refs.trim() || null
        : null;
  }

  if ("avatar_url" in b) {
    if (b.avatar_url === null) {
      update.avatar_url = null;
    } else if (
      typeof b.avatar_url === "string" &&
      b.avatar_url.startsWith(orgAvatarPrefix(orgId))
    ) {
      update.avatar_url = b.avatar_url;
    } else {
      return fail("avatar_url must be a valid uploaded avatar URL or null");
    }
  }

  if (Object.keys(update).length === 0) {
    return fail("No valid fields provided");
  }

  return { data: update };
}
