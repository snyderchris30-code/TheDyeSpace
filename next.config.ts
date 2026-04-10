import type { NextConfig } from "next";

console.log('[NEXT.CONFIG] TheDyeSpace project loaded:', process.env.VERCEL_URL || process.env.NEXT_PUBLIC_VERCEL_URL || 'localhost');
const buildDate = new Date().toISOString().slice(0, 10);
const buildSeed = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_RUN_ID || String(Date.now());

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BUILD_DATE: buildDate,
    NEXT_PUBLIC_BUILD_SEED: buildSeed,
  },
  images: {
    remotePatterns: [
      {
        protocol: "https",
        hostname: "edlhcsujawhruoaducyq.supabase.co",
        pathname: "/storage/v1/object/public/**",
      },
      {
        protocol: "https",
        hostname: "images.unsplash.com",
        pathname: "/**",
      },
    ],
  },
  allowedDevOrigins: [
    "http://localhost:3000",
    "http://127.0.0.1:3000",
    "http://192.168.1.135:3000",
    "http://192.168.1.102:3000",
    "192.168.1.102",
    "172.31.0.1",
  ],
  async headers() {
    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          },
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          },
        ],
      },
    ];
  },
};

export default nextConfig;