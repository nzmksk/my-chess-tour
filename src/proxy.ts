import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SIGNUP_STEP_COOKIE } from "@/lib/auth/signup-cookie";
import { SESSION_ONLY_COOKIE, stripPersistence } from "@/lib/auth/session-cookie";
import { applyCorsHeaders, enforceApiOrigin } from "@/lib/http/origin-policy";
import { enforceApiBaseline } from "@/services/rate-limit/limiter";

export async function proxy(request: NextRequest) {
  const refused = enforceApiOrigin(request);
  if (refused) return refused;
  return applyCorsHeaders(request, await handleRequest(request));
}

async function handleRequest(request: NextRequest): Promise<NextResponse> {
  let supabaseResponse = NextResponse.next({ request });

  const sessionOnly = request.cookies.get(SESSION_ONLY_COOKIE)?.value === "1";

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_PUBLIC_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll();
        },
        setAll(cookiesToSet) {
          const toSet = sessionOnly
            ? stripPersistence(cookiesToSet)
            : cookiesToSet;
          toSet.forEach(({ name, value }) => request.cookies.set(name, value));
          supabaseResponse = NextResponse.next({ request });
          toSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options),
          );
        },
      },
    },
  );

  const { data: claimsData } = await supabase.auth.getClaims();
  const user = claimsData?.claims ?? null;

  const limited = await enforceApiBaseline(request, user?.sub ?? null);
  if (limited) return limited;

  const { pathname } = request.nextUrl;
  const signupStep = request.cookies.get(SIGNUP_STEP_COOKIE)?.value;

  if (pathname.startsWith("/auth/signup/verify")) {
    if (signupStep !== "verify") {
      return NextResponse.redirect(new URL("/auth/signup", request.url));
    }
  }

  if (pathname.startsWith("/auth/update-password")) {
    if (!user) {
      return NextResponse.redirect(
        new URL("/auth/forgot-password", request.url),
      );
    }
    const amr = (user.amr ?? []) as Array<{ method: string } | string>;
    const isRecovery = amr.some(
      (e) => (typeof e === "string" ? e : e.method) === "otp",
    );
    if (!isRecovery) {
      return NextResponse.redirect(new URL("/", request.url));
    }
  }

  const guestOnlyPaths = [
    "/auth/forgot-password",
    "/auth/login",
    "/auth/logout",
    "/auth/signup",
  ];
  if (user && guestOnlyPaths.some((p) => pathname.startsWith(p))) {
    return NextResponse.redirect(new URL("/", request.url));
  }

  const protectedPaths = ["/admin", "/my", "/organizations/", "/settings"];
  const isProtected = protectedPaths.some((path) =>
    request.nextUrl.pathname.startsWith(path),
  );

  if (isProtected && !user) {
    const url = request.nextUrl.clone();
    url.pathname = "/auth/login";
    url.searchParams.set("redirectTo", request.nextUrl.pathname);
    return NextResponse.redirect(url);
  }

  return supabaseResponse;
}

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp)$).*)",
  ],
};
