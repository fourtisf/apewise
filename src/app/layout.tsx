import type { Metadata, Viewport } from "next";
import "./globals.css";
import { StringsProvider } from "@/lib/strings";
import { Background } from "@/components/Background";
import { JsonLd } from "@/components/JsonLd";
import { Analytics } from "@/components/Analytics";
import {
  SITE_URL,
  SITE_NAME,
  SITE_DESCRIPTION,
  X_HANDLE,
} from "@/lib/site";

const TITLE = "ApeWise — Follow the smartest money on Solana";

export const metadata: Metadata = {
  metadataBase: new URL(SITE_URL),
  title: {
    default: TITLE,
    template: "%s · ApeWise",
  },
  description: SITE_DESCRIPTION,
  applicationName: SITE_NAME,
  keywords: [
    "Solana smart money tracker",
    "memecoin tracker",
    "smart money wallets",
    "on-chain wallet tracking",
    "Telegram crypto alerts",
    "anti-rug",
    "Solana memecoins",
    "ApeWise",
    "Fourtis",
  ],
  authors: [{ name: "Fourtis", url: "https://fourtis.io" }],
  creator: "Fourtis",
  publisher: "Fourtis",
  category: "technology",
  alternates: { canonical: "/" },
  openGraph: {
    type: "website",
    url: SITE_URL,
    siteName: SITE_NAME,
    title: TITLE,
    description: SITE_DESCRIPTION,
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: `@${X_HANDLE}`,
    creator: `@${X_HANDLE}`,
    title: TITLE,
    description: SITE_DESCRIPTION,
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export const viewport: Viewport = {
  themeColor: "#060608",
  colorScheme: "dark",
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="en" dir="ltr" suppressHydrationWarning>
      <head>
        {/* Fonts via parallel-fetched <link> + preconnect (not CSS @import) so they
            don't block first paint. */}
        <link
          rel="preconnect"
          href="https://api.fontshare.com"
          crossOrigin="anonymous"
        />
        <link rel="preconnect" href="https://fonts.googleapis.com" />
        <link
          rel="preconnect"
          href="https://fonts.gstatic.com"
          crossOrigin="anonymous"
        />
        <link
          rel="stylesheet"
          href="https://api.fontshare.com/v2/css?f[]=clash-display@500,600,700&f[]=satoshi@400,500,700&display=swap"
        />
        <link
          rel="stylesheet"
          href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
        />
      </head>
      <body>
        <Analytics />
        <JsonLd />
        <Background />
        <StringsProvider>{children}</StringsProvider>
      </body>
    </html>
  );
}
