import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";
import { CSPostHogProvider } from "./providers";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

// Set NEXT_PUBLIC_SITE_URL in Vercel once the production domain is live —
// enables absolute OG/Twitter card resolution. Omitted (not guessed) until set.
const siteUrl = process.env.NEXT_PUBLIC_SITE_URL;
const title = "Orbitae - The Native Workspace for Developers";
const description = "Stop context switching. Manage projects, terminals, databases, and secrets in one native, high-performance workspace.";

export const metadata: Metadata = {
  title,
  description,
  ...(siteUrl ? { metadataBase: new URL(siteUrl) } : {}),
  icons: {
    icon: '/favicon.ico',
  },
  openGraph: {
    title,
    description,
    type: 'website',
    siteName: 'Orbitae',
    ...(siteUrl ? { url: siteUrl } : {}),
  },
  twitter: {
    card: 'summary',
    title,
    description,
  },
};

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html lang="en">
      <body
        className={`${geistSans.variable} ${geistMono.variable} antialiased`}
      >
        <CSPostHogProvider>
          {children}
        </CSPostHogProvider>
      </body>
    </html>
  );
}
