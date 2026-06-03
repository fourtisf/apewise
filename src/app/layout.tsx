import type { Metadata, Viewport } from "next";
import "./globals.css";
import { StringsProvider } from "@/lib/strings";
import { Background } from "@/components/Background";
import { JsonLd } from "@/components/JsonLd";
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
    images: [
      {
        url: "/og.svg",
        width: 1200,
        height: 630,
        alt: "ApeWise — the smart-money tracker for Solana memecoins",
      },
    ],
    locale: "en_US",
  },
  twitter: {
    card: "summary_large_image",
    site: `@${X_HANDLE}`,
    creator: `@${X_HANDLE}`,
    title: TITLE,
    description: SITE_DESCRIPTION,
    images: ["/og.svg"],
  },
  robots: {
    index: true,
    follow: true,
    googleBot: { index: true, follow: true, "max-image-preview": "large" },
  },
};

export const viewport: Viewport = {
  themeColor: "#08090A",
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
      <body>
        <JsonLd />
        <Background />
        <StringsProvider>{children}</StringsProvider>
      </body>
    </html>
  );
}
