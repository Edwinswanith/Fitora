/** @type {import('next').NextConfig} */
const nextConfig = {
  experimental: {
    externalDir: true,
  },
  rewrites() {
    return {
      // Runs after checking real files/public assets, so /support.html itself
      // is untouched — this only gives the extensionless /support path (the
      // App Store Connect Support URL convention) somewhere to resolve to.
      afterFiles: [
        {
          source: "/support",
          destination: "/support.html",
        },
      ],
      fallback: [
        {
          source: "/:path*",
          destination: "/index.html",
        },
      ],
    };
  },
};

module.exports = nextConfig;
