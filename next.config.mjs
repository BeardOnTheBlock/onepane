/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Prisma's query engine is a native binary; keep it external to the server bundle.
  serverExternalPackages: ["@prisma/client", "prisma"],
  // Lint is run explicitly via `npm run lint`; don't fail production builds on it.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
