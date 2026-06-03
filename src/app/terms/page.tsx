import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Terms of Service",
  description: "The terms for using ApeWise.",
  robots: { index: false, follow: true },
};

export default function TermsPage() {
  return (
    <LegalPage title="Terms of Service" updated="June 2026">
      <p>
        {
          "This is a placeholder terms-of-service document for the ApeWise landing page. Replace it with your reviewed legal copy before public launch."
        }
      </p>

      <h2>No financial advice</h2>
      <p>
        {
          "ApeWise provides on-chain analytics and alerts for informational purposes only. Nothing here is financial, investment, or trading advice. Crypto assets are volatile and you trade entirely at your own risk."
        }
      </p>

      <h2>Early access</h2>
      <p>
        {
          "Features described on this site are in development and may change. Pricing and availability are not final and are subject to change before launch."
        }
      </p>

      <h2>Brand</h2>
      <p>
        {
          "ApeWise is an independent brand, powered by Fourtis. All trademarks belong to their respective owners."
        }
      </p>
    </LegalPage>
  );
}
