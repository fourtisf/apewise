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
            "linear-gradient(135deg, #0a0c12 0%, #0e1322 55%, #0a0c12 100%)",
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
              background: "#141821",
              border: "1px solid #2a3142",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
            }}
          >
            <svg width="34" height="34" viewBox="0 0 32 32" fill="none">
              <path
                d="M6 22 L13 15 L17 18 L25 9"
                stroke="#6ea8ff"
                strokeWidth="3"
                strokeLinecap="round"
                strokeLinejoin="round"
              />
              <circle cx="25" cy="9" r="2.6" fill="#6ea8ff" />
            </svg>
          </div>
          <div style={{ fontSize: 36, fontWeight: 700 }}>ApeWise</div>
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          <div
            style={{
              fontSize: 26,
              letterSpacing: 4,
              color: "#6ea8ff",
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
