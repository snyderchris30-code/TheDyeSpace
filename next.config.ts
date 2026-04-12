import type { NextConfig } from "next";

const buildDate = new Date().toISOString().slice(0, 10);
const buildSeed = process.env.VERCEL_GIT_COMMIT_SHA || process.env.GITHUB_RUN_ID || String(Date.now());
const supabaseHost = (() => {
  try {
    const value = process.env.NEXT_PUBLIC_SUPABASE_URL;
    if (!value) return null;
    return new URL(value).hostname;
  } catch {
    return null;
  }
})();

const nextConfig: NextConfig = {
  reactStrictMode: true,
  env: {
    NEXT_PUBLIC_BUILD_DATE: buildDate,
    NEXT_PUBLIC_BUILD_SEED: buildSeed,
  },
  images: {
    remotePatterns: [
      ...(supabaseHost
        ? [
            {
              protocol: "https" as const,
              hostname: supabaseHost,
              pathname: "/storage/v1/object/public/**",
            },
          ]
        : []),
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
    const cspReportOnly = [
      "default-src 'self'",
      "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://www.youtube.com https://www.youtube-nocookie.com",
      "style-src 'self' 'unsafe-inline' https://fonts.googleapis.com",
      "img-src 'self' data: blob: https:",
      "font-src 'self' data: https://fonts.gstatic.com",
      "connect-src 'self' https://*.supabase.co wss://*.supabase.co https://open.spotify.com https://api.spotify.com https://www.youtube.com https://www.youtube-nocookie.com https://*.youtube.com",
      "frame-src 'self' https://www.youtube.com https://www.youtube-nocookie.com https://open.spotify.com",
      "object-src 'none'",
      "base-uri 'self'",
      "frame-ancestors 'none'",
    ].join("; ");

    const securityHeaders = [
      { key: "X-Frame-Options", value: "DENY" },
      { key: "X-Content-Type-Options", value: "nosniff" },
      { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
      { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
      { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
    ];

    return [
      {
        source: "/api/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          },
          ...securityHeaders,
        ],
      },
      {
        source: "/:path*",
        headers: [
          {
            key: "Cache-Control",
            value: "no-store, no-cache, must-revalidate, proxy-revalidate, max-age=0",
          },
          ...securityHeaders,
        ],
      },
    ];
  },
};

export default nextConfig;