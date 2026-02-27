import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "MY Chess Tour — Coming Soon",
  description:
    "Malaysia's premier competitive chess circuit. Join the waitlist.",
  icons: {
    icon: "/mct-logo-square.svg",
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
