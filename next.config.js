/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'edlhcsujawhruoaducyq.supabase.co',
        pathname: '/storage/v1/object/public/**',
      },
    ],
  },
  allowedDevOrigins: [
    'http://localhost:3000',
    'http://127.0.0.1:3000',
    'http://192.168.1.135:3000',
    'http://192.168.1.102:3000',
    '192.168.1.102',
  ],
};

module.exports = nextConfig;
