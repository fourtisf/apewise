import Script from "next/script";

/**
 * Privacy-friendly analytics. Renders nothing unless NEXT_PUBLIC_PLAUSIBLE_DOMAIN
 * is set, so local/dev builds stay clean. Set it to your site domain (e.g.
 * "apewise.ai") after creating a Plausible site to get pageviews + the
 * "Waitlist Signup" goal. Self-hosting? Point NEXT_PUBLIC_PLAUSIBLE_SRC at your
 * script URL.
 */
export function Analytics() {
  const domain = process.env.NEXT_PUBLIC_PLAUSIBLE_DOMAIN;
  if (!domain) return null;

  const src =
    process.env.NEXT_PUBLIC_PLAUSIBLE_SRC ||
    "https://plausible.io/js/script.tagged-events.js";

  return (
    <>
      {/* Queue stub so custom events fired before the script loads aren't lost. */}
      <Script id="plausible-init" strategy="afterInteractive">
        {`window.plausible=window.plausible||function(){(window.plausible.q=window.plausible.q||[]).push(arguments)}`}
      </Script>
      <Script defer data-domain={domain} src={src} strategy="afterInteractive" />
    </>
  );
}
