/**
 * Fixed, non-interactive background system rendered once behind all content:
 * gradient mesh wash + masked grid + two floating accent glows + grain overlay.
 */
export function Background() {
  return (
    <div className="bg-layers" aria-hidden="true">
      <div className="bg-mesh" />
      <div className="bg-grid" />
      <div
        className="bg-glow animate-float"
        style={{
          top: "-8rem",
          left: "-6rem",
          width: "34rem",
          height: "34rem",
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--accent) 32%, transparent), transparent 65%)",
        }}
      />
      <div
        className="bg-glow animate-float"
        style={{
          top: "8rem",
          right: "-8rem",
          width: "36rem",
          height: "36rem",
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--accent-2) 38%, transparent), transparent 65%)",
          animationDelay: "-3.5s",
        }}
      />
      {/* soft central emerald wash — keeps lower sections from going flat-black */}
      <div
        className="bg-glow"
        style={{
          top: "52%",
          left: "50%",
          width: "52rem",
          height: "42rem",
          transform: "translate(-50%, -28%)",
          background:
            "radial-gradient(circle, color-mix(in srgb, var(--accent) 20%, transparent), transparent 68%)",
        }}
      />
      <div className="bg-grain" />
    </div>
  );
}
