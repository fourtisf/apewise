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
          "This is a placeholder privacy policy for the ApeWise landing page. Replace it with your reviewed legal copy before public launch."
        }
      </p>

      <h2>What we collect</h2>
      <p>
        {
          "If you join the waitlist, we collect the email address you submit so we can notify you when ApeWise opens. We do not collect wallet keys, and we never ask you to connect a wallet on this site."
        }
      </p>

      <h2>How we use it</h2>
      <p>
        {
          "We use your email solely to send early-access and product updates related to ApeWise. You can unsubscribe at any time."
        }
      </p>

      <h2>Contact</h2>
      <p>
        {"Questions? Reach the team via "}
        <a href="https://t.me/apewiseai">@apewiseai</a>
        {" on Telegram."}
      </p>
    </LegalPage>
  );
}
