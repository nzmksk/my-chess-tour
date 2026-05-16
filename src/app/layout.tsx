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
      default: "MY Chess Tour — Register for Chess Tournaments in Malaysia",
      template: "%s | MY Chess Tour",
    },
    applicationName: "MY Chess Tour",
    description:
      "Discover and sign up for chess tournaments across Malaysia. Browse upcoming events, register online in minutes, and pay securely — all in one place.",
    robots: noindex
      ? { index: false, follow: false }
      : { index: true, follow: true },
    icons: {
      icon: "/mct-logo-square.svg",
    },
    openGraph: {
      title: "MY Chess Tour — Register for Chess Tournaments in Malaysia",
      description:
        "Malaysia's home for chess tournaments. Browse upcoming open events, register online, and pay in one step.",
      type: "website",
      siteName: "MY Chess Tour",
    },
    twitter: {
      card: "summary",
      title: "MY Chess Tour — Register for Chess Tournaments in Malaysia",
      description:
        "Malaysia's home for chess tournaments. Browse upcoming open events, register online, and pay in one step.",
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
