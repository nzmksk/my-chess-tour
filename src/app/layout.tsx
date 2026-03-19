import type { Metadata } from "next";
import { headers } from "next/headers";
import { Cinzel, Lato } from "next/font/google";
import "@/styles/globals.css";
import { ThemeProvider } from "@/components/ThemeProvider";

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

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
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
        <ThemeProvider>{children}</ThemeProvider>
      </body>
    </html>
  );
}
