import type { NextConfig } from "next";

// A moderate, safe-by-default CSP: 'unsafe-inline' stays on script/style
// because Next.js's hydration bootstrap and PostHog rely on it, and this repo
// has no live browser to verify a stricter nonce-based policy against — but
// object-src/frame-ancestors/base-uri/form-action are locked down, which
// blocks the most common exploitation paths (clickjacking, base-tag
// hijacking, arbitrary form hijack) regardless. Tighten to nonces once this
// can be tested in a real browser.
const CSP = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' https://us.i.posthog.com https://us-assets.i.posthog.com",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: https:",
  "font-src 'self' data:",
  "connect-src 'self' https://us.i.posthog.com https://us-assets.i.posthog.com",
  "object-src 'none'",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join('; ');

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'Content-Security-Policy', value: CSP },
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'X-Frame-Options', value: 'DENY' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
          { key: 'Strict-Transport-Security', value: 'max-age=63072000; includeSubDomains; preload' },
        ],
      },
    ];
  },
};

export default nextConfig;
