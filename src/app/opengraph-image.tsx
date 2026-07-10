import { ImageResponse } from "next/og";

export const alt = "ApeWise — Solana smart-money terminal";
export const size = { width: 1200, height: 630 };
export const contentType = "image/png";

/** Branded 1200×630 social card (replaces the old placeholder SVG). */
export default function OpengraphImage() {
  return new ImageResponse(
    (
      <div
        style={{
          width: "100%",
          height: "100%",
          display: "flex",
          flexDirection: "column",
          justifyContent: "space-between",
          padding: 76,
          background:
            "linear-gradient(135deg, #060608 0%, #0d0d10 55%, #060608 100%)",
          color: "#f0f2f6",
          fontFamily: "sans-serif",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 18 }}>
          <div
            style={{
              width: 60,
              height: 60,
              borderRadius: 16,
              background: "#000000",
              boxShadow: "0 0 22px rgba(47,233,168,0.5)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="38" height="38" viewBox="0 0 32 32" fill="none">
              <path
                d="M16,13.4 C14.2,11.6 11.4,9 5.6,7.2 C9,10.6 12.4,13.8 14.8,17.6 C15.3,20.2 15.7,22.6 16,24.8 C16.3,22.6 16.7,20.2 17.2,17.6 C19.6,13.8 23,10.6 26.4,7.2 C20.6,9 17.8,11.6 16,13.4 Z"
                fill="#2fe9a8"
              />
            </svg>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700 }}>ApeWise</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontSize: 26,
              letterSpacing: 4,
              color: "#cfd0d4",
              fontWeight: 600,
            }}
          >
            SOLANA SMART-MONEY TERMINAL
          </div>
          <div style={{ fontSize: 72, fontWeight: 800, lineHeight: 1.08 }}>
            Follow the smartest money on Solana.
          </div>
          <div style={{ fontSize: 30, color: "#8b93a3" }}>
            Scored wallets · anti-rug fused · real-time Telegram alerts.
          </div>
        </div>

        <div
          style={{
            display: "flex",
            justifyContent: "space-between",
            fontSize: 24,
            color: "#8b93a3",
          }}
        >
          <div>apewise.ai</div>
          <div>powered by Fourtis</div>
        </div>
      </div>
    ),
    { ...size },
  );
}
