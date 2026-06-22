import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { SIGNUP_STEP_COOKIE } from "@/lib/signup-cookie";
import { SESSION_ONLY_COOKIE, stripPersistence } from "@/lib/session-cookie";

export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  // Honor the user's "Keep me signed in" choice on token refresh: when the
  // marker is present, keep the refreshed auth cookies session-scoped.
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

  // Refresh session — IMPORTANT: do not remove this
  const {
    data: { user },
  } = await supabase.auth.getUser();

  // Prevent sign-up step-skipping
  const { pathname } = request.nextUrl;
  const signupStep = request.cookies.get(SIGNUP_STEP_COOKIE)?.value;

  if (pathname.startsWith("/auth/signup/profile")) {
    // Account created but email not yet verified — send back to verification
    // instead of letting the user skip the step by editing the URL.
    if (signupStep === "verify") {
      return NextResponse.redirect(new URL("/auth/signup/verify", request.url));
    }
    if (signupStep !== "profile") {
      return NextResponse.redirect(new URL("/auth/signup", request.url));
    }
  }

  if (pathname.startsWith("/auth/signup/verify")) {
    // Already verified — don't let the user redo verification; move forward.
    if (signupStep === "profile") {
      return NextResponse.redirect(
        new URL("/auth/signup/profile", request.url),
      );
    }
    if (signupStep !== "verify") {
      return NextResponse.redirect(new URL("/auth/signup", request.url));
    }
  }

  // Protect routes that require auth. Note the trailing slash on
  // "/organizations/" — the bare "/organizations" landing ("Become an
  // Organizer") is public; only its sub-routes (apply, dashboards, etc.) gate.
  const protectedPaths = ["/admin", "/my", "/organizations/", "/profile"];
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
