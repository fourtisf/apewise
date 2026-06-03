/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // NOTE: intentionally NOT using output: 'export'.
  // The /api/waitlist route needs a Node server (next start) behind Nginx on the VPS.

  // Always revalidate the HTML documents so a deploy shows up on a normal reload.
  // Hashed /_next/static assets stay long-cached (untouched here), so it's still fast.
  async headers() {
    const revalidate = [
      { key: "Cache-Control", value: "no-cache, must-revalidate" },
    ];
    return [
      { source: "/", headers: revalidate },
      { source: "/terminal", headers: revalidate },
      { source: "/privacy", headers: revalidate },
      { source: "/terms", headers: revalidate },
    ];
  },
};

export default nextConfig;
