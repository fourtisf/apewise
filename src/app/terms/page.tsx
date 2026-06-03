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
          "These terms govern your use of the ApeWise website and product (the “Service”). By using the Service you agree to them. ApeWise is an independent brand, powered by Fourtis."
        }
      </p>

      <h2>No financial advice</h2>
      <p>
        {
          "ApeWise provides on-chain analytics, scoring and alerts for informational purposes only. Nothing in the Service is financial, investment, legal, or tax advice, an offer, or a recommendation to buy or sell any asset. Crypto assets — memecoins especially — are extremely volatile and can go to zero. You make your own decisions and trade entirely at your own risk."
        }
      </p>

      <h2>No guarantees</h2>
      <p>
        {
          "Signals, wallet scores, “smart money” labels and anti-rug checks are heuristics built on public, sometimes incomplete or delayed on-chain data and third-party sources. They can be wrong, late, or incomplete. We do not guarantee accuracy, availability, profitability, or that a token is safe. Wallet labels do not imply any endorsement by, or affiliation with, the wallet owner."
        }
      </p>

      <h2>Early access &amp; changes</h2>
      <p>
        {
          "Features shown are in private beta and may change, break, or be removed. Pricing and availability are not final. We may modify or discontinue any part of the Service at any time."
        }
      </p>

      <h2>Acceptable use</h2>
      <p>
        {
          "Don’t abuse, scrape, overload, reverse-engineer, or resell the Service, and don’t use it for anything unlawful. We may suspend access that threatens the Service or other users."
        }
      </p>

      <h2>Third-party links</h2>
      <p>
        {
          "The Service may link to third parties (e.g. DexScreener, trading bots, Telegram). We don’t control and aren’t responsible for them; their terms apply. Referral links may earn us a fee at no extra cost to you."
        }
      </p>

      <h2>Liability</h2>
      <p>
        {
          "To the maximum extent permitted by law, the Service is provided “as is” without warranties, and ApeWise and Fourtis are not liable for any trading losses or damages arising from your use of it."
        }
      </p>

      <h2>Contact</h2>
      <p>
        {"Questions? Reach us via "}
        <a
          href="https://t.me/apewiseai"
          target="_blank"
          rel="noopener noreferrer"
        >
          @apewiseai
        </a>
        {" on Telegram."}
      </p>
    </LegalPage>
  );
}
