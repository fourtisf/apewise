/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // NOTE: intentionally NOT using output: 'export'.
  // The /api/waitlist route needs a Node server (next start) behind Nginx on the VPS.
};

export default nextConfig;
