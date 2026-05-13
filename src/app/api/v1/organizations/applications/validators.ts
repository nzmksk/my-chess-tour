import { NextResponse } from "next/server";
import { validateEmail } from "@/services/auth/auth-validation";

interface OrgLink {
  url: string;
  label: string;
}

export interface ApplyRequest {
  name: string;
  description?: string | null;
  links?: OrgLink[] | null;
  email: string;
  phone?: string | null;
  past_tournament_refs?: string | null;
}

export function validateApplyRequest(
  body: unknown,
): { data: ApplyRequest } | { error: NextResponse } {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    return {
      error: NextResponse.json(
        { error: { code: "VALIDATION_ERROR", message: "Invalid request body" } },
        { status: 400 },
      ),
    };
  }

  const b = body as Record<string, unknown>;

  if (!b.name || typeof b.name !== "string" || b.name.trim() === "") {
    return {
      error: NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Organization name is required",
          },
        },
        { status: 400 },
      ),
    };
  }

  if (!b.email || typeof b.email !== "string" || b.email.trim() === "") {
    return {
      error: NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Email is required",
          },
        },
        { status: 400 },
      ),
    };
  }

  if (!validateEmail(b.email as string)) {
    return {
      error: NextResponse.json(
        {
          error: {
            code: "VALIDATION_ERROR",
            message: "Invalid email address",
          },
        },
        { status: 400 },
      ),
    };
  }

  if (b.links != null) {
    if (!Array.isArray(b.links)) {
      return {
        error: NextResponse.json(
          {
            error: {
              code: "VALIDATION_ERROR",
              message: "links must be an array",
            },
          },
          { status: 400 },
        ),
      };
    }

    for (const link of b.links) {
      if (!link || typeof link !== "object" || Array.isArray(link)) {
        return {
          error: NextResponse.json(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "Each link must be an object with label and url",
              },
            },
            { status: 400 },
          ),
        };
      }

      const l = link as Record<string, unknown>;

      if (typeof l.label !== "string" || l.label.trim() === "") {
        return {
          error: NextResponse.json(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "Each link must have a non-empty label",
              },
            },
            { status: 400 },
          ),
        };
      }

      if (typeof l.url !== "string" || l.url.trim() === "") {
        return {
          error: NextResponse.json(
            {
              error: {
                code: "VALIDATION_ERROR",
                message: "Each link must have a non-empty url",
              },
            },
            { status: 400 },
          ),
        };
      }
    }
  }

  return {
    data: {
      name: b.name.trim(),
      description:
        typeof b.description === "string" ? b.description.trim() || null : null,
      links: Array.isArray(b.links) && b.links.length > 0
        ? (b.links as OrgLink[])
        : null,
      email: (b.email as string).trim(),
      phone:
        typeof b.phone === "string" ? b.phone.trim() || null : null,
      past_tournament_refs:
        typeof b.past_tournament_refs === "string"
          ? b.past_tournament_refs.trim() || null
          : null,
    },
  };
}
