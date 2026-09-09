/** @type {import('next').NextConfig} */
const nextConfig = {
  // better-sqlite3 and kuromoji are native/filesystem-bound: keep them external
  // to the server bundle so their .node binaries and dictionary files resolve.
  serverExternalPackages: ['better-sqlite3', 'kuromoji'],
  experimental: {
    // Recordings and dictionary reads happen through route handlers only.
  },
};

export default nextConfig;
