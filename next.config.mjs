/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Keep native/heavy server-only packages external to the bundle (Prisma's
  // query engine; the IMAP/SMTP/CalDAV stack used by the generic provider).
  serverExternalPackages: [
    "@prisma/client",
    "prisma",
    "imapflow",
    "mailparser",
    "nodemailer",
    "tsdav",
  ],
  // Lint is run explicitly via `npm run lint`; don't fail production builds on it.
  eslint: { ignoreDuringBuilds: true },
};

export default nextConfig;
