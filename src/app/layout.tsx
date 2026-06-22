import type { Metadata } from "next";
import { headers } from "next/headers";
import { Cinzel, Lato } from "next/font/google";
import "@/styles/globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";
import { AuthProvider } from "@/components/AuthProvider";
import { getNavUser } from "@/services/supabase/permission";
import { toAuthUser } from "@/lib/auth-user";

const themeScript = `(function(){try{var t=localStorage.getItem("theme");if(t==="light")document.documentElement.setAttribute("data-theme","light")}catch(e){}})();`;

const cinzel = Cinzel({
  subsets: ["latin"],
  weight: ["400", "600", "700"],
  variable: "--font-cinzel",
});

const lato = Lato({
  subsets: ["latin"],
  weight: ["300", "400"],
  variable: "--font-lato",
});

export async function generateMetadata(): Promise<Metadata> {
  const headersList = await headers();
  const host = headersList.get("host") || "";

  const noindex = host.startsWith("admin.") || host.startsWith("staging");

  return {
    title: {
      default: "MY Chess Tour — Coming Soon",
      template: "%s | MY Chess Tour",
    },
    applicationName: "MY Chess Tour",
    description:
      "Malaysia's premier competitive chess circuit. Join the waitlist.",
    robots: noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    icons: {
      icon: "/mct-logo-square.svg",
    },
    openGraph: {
      title: "MY Chess Tour — Coming Soon",
      description:
        "Malaysia's premier competitive chess circuit. Join the waitlist.",
      type: "website",
      siteName: "MY Chess Tour",
    },
    twitter: {
      card: "summary",
      title: "MY Chess Tour — Coming Soon",
      description:
        "Malaysia's premier competitive chess circuit. Join the waitlist.",
    },
  };
}

export default async function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // Resolve the signed-in user once per full page load (local getClaims for
  // identity + one PK read for the avatar, both cached per request) so the
  // client store seeds without a round-trip.
  const nav = await getNavUser();
  const initialUser = nav
    ? toAuthUser({
        sub: nav.claims.id,
        email: nav.claims.email,
        user_metadata: nav.claims.userMetadata,
      })
    : null;
  const initialAvatar = nav?.avatarUrl ?? null;

  return (
    <html
      lang="en"
      data-theme="dark"
      suppressHydrationWarning
      className={`${cinzel.variable} ${lato.variable}`}
    >
      <head>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
      </head>
      <body>
        <ThemeProvider>
          <AuthProvider initialUser={initialUser} initialAvatar={initialAvatar}>
            {children}
          </AuthProvider>
        </ThemeProvider>
      </body>
    </html>
  );
}
