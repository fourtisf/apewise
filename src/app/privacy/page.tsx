import type { Metadata } from "next";
import { LegalPage } from "@/components/LegalPage";

export const metadata: Metadata = {
  title: "Privacy Policy",
  description: "How ApeWise handles your data.",
  robots: { index: false, follow: true },
};

export default function PrivacyPage() {
  return (
    <LegalPage title="Privacy Policy" updated="June 2026">
      <p>
        {
          "ApeWise (“we”, “us”) is an independent analytics brand, powered by Fourtis. This policy explains what we collect on this website and how we use it. By using the site you agree to it."
        }
      </p>

      <h2>What we collect</h2>
      <p>
        {
          "Waitlist email — if you submit one, we store the email address (with a timestamp, your language, and coarse request metadata such as IP and user agent) so we can notify you and prevent abuse. We never collect wallet private keys, seed phrases, or passwords, and we never ask you to connect a wallet on this site."
        }
      </p>

      <h2>How we use it</h2>
      <p>
        {
          "Solely to send early-access and product updates, to operate and secure the service, and to understand aggregate interest. We do not sell your personal data."
        }
      </p>

      <h2>Analytics</h2>
      <p>
        {
          "If enabled, we use a privacy-friendly analytics tool (Plausible) that does not use cookies and does not track you across sites. It records anonymous, aggregate usage only."
        }
      </p>

      <h2>Sharing</h2>
      <p>
        {
          "We share data only with processors that help us run the service (e.g. email/CRM or a webhook you connect), and where required by law. On-chain data shown in the product is public blockchain information, not personal data we hold about you."
        }
      </p>

      <h2>Retention &amp; your rights</h2>
      <p>
        {
          "We keep waitlist data until launch or until you ask us to remove it. You can request access to, correction of, or deletion of your data at any time — just contact us. You can unsubscribe from emails whenever you like."
        }
      </p>

      <h2>Contact</h2>
      <p>
        {"Questions or requests? Reach the team via "}
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
