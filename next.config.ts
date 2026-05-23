import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Content-Security-Policy. Shipped in Report-Only mode first so a missed
 * source surfaces as a console report instead of a broken page. After
 * verifying zero violations across the core flows (fetch / generate /
 * PDF preview / discover), flip the header name to `Content-Security-Policy`
 * to enforce.
 *
 * unsafe-inline / unsafe-eval on script-src are required by Next.js's
 * inline hydration bootstrap without a nonce pipeline; style-src needs
 * unsafe-inline for Tailwind + framer-motion injected styles.
 */
const cspReportOnly = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://i.ytimg.com https://github.com https://avatars.githubusercontent.com https://*.public.blob.vercel-storage.com",
  "font-src 'self' data:",
  "connect-src 'self' https://generativelanguage.googleapis.com https://*.public.blob.vercel-storage.com https://vitals.vercel-insights.com",
  "frame-src 'self' blob:",
  "frame-ancestors 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "object-src 'none'",
].join("; ");

const securityHeaders = [
  {
    key: "Strict-Transport-Security",
    value: "max-age=63072000; includeSubDomains; preload",
  },
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  {
    key: "Permissions-Policy",
    value: "camera=(), microphone=(), geolocation=(), browsing-topics=()",
  },
  { key: "Content-Security-Policy-Report-Only", value: cspReportOnly },
];

const nextConfig: NextConfig = {
  async headers() {
    return [
      {
        // Apply to every route. API routes also get the baseline hardening
        // headers; CSP is harmless on JSON responses.
        source: "/:path*",
        headers: securityHeaders,
      },
    ];
  },
  experimental: {
    optimizePackageImports: [
      "lucide-react",
      "framer-motion",
      "react-markdown",
      "@tanstack/react-query",
      "@tanstack/react-virtual",
      "@radix-ui/react-dialog",
      "@radix-ui/react-select",
      "@radix-ui/react-dropdown-menu",
      "@radix-ui/react-alert-dialog",
      "@radix-ui/react-popover",
      "@radix-ui/react-scroll-area",
      "@radix-ui/react-toast",
    ],
  },
  images: {
    formats: ["image/avif", "image/webp"],
    remotePatterns: [
      // GitHub owner avatars (`https://github.com/{user}.png` 302 redirects to
      // `avatars.githubusercontent.com`). The optimizer follows the redirect,
      // but the lint/runtime hostname check uses the original URL — list both.
      { protocol: "https", hostname: "github.com", pathname: "/**" },
      {
        protocol: "https",
        hostname: "avatars.githubusercontent.com",
        pathname: "/**",
      },
      // YouTube video thumbnails used on the discover page.
      { protocol: "https", hostname: "i.ytimg.com", pathname: "/**" },
      // User-uploaded resume photos served from Vercel Blob.
      {
        protocol: "https",
        hostname: "*.public.blob.vercel-storage.com",
        pathname: "/**",
      },
    ],
  },
};

export default withNextIntl(nextConfig);
