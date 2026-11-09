import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  cacheComponents: true,
  partialPrefetching: true,
  async redirects() {
    return [
      { source: "/", destination: "/tasks", permanent: false },
      // Team management moved into the settings page.
      { source: "/team", destination: "/settings", permanent: false },
    ];
  },
  async rewrites() {
    // Universal Links (iOS): must be served from this exact path, without redirect.
    return [{ source: "/.well-known/apple-app-site-association", destination: "/api/apple-app-site-association" }];
  },
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
          // HTTPS only (Vercel serves HTTPS; this pins it in the browser for two years).
          { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains" },
          // Baseline CSP without nonces: no framing, no <base> or plugin injection,
          // forms only to this origin. Scripts are covered by React escaping and
          // the markdown renderer (no raw HTML), see docs/security.md.
          {
            key: "Content-Security-Policy",
            value: "frame-ancestors 'none'; base-uri 'self'; object-src 'none'; form-action 'self'",
          },
        ],
      },
    ];
  },
  turbopack: {
    rules: {
      "*.css": {
        loaders: ["@tailwindcss/turbopack"],
        as: "*.css",
      },
    },
  },
};

export default nextConfig;
