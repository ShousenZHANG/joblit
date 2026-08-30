import type { NextConfig } from "next";
import createNextIntlPlugin from "next-intl/plugin";

const withNextIntl = createNextIntlPlugin("./i18n/request.ts");

/**
 * Content-Security-Policy — ENFORCED (was Report-Only, which gave zero actual
 * protection in prod). Enforcing now activates the high-value directives:
 * object-src 'none' (blocks plugin/flash injection), base-uri 'self' (blocks
 * <base> tag hijack), frame-ancestors 'none' (clickjacking), form-action 'self'
 * (form-target exfiltration), and the connect-src allowlist (data exfil).
 *
 * script-src / style-src still carry 'unsafe-inline' (+ 'unsafe-eval' for
 * scripts) because Next.js's inline hydration bootstrap and Tailwind/
 * framer-motion injected styles require it without a per-request nonce
 * pipeline. Next step to fully harden script-src: add nonce middleware and
 * drop 'unsafe-inline'/'unsafe-eval' — tracked as a follow-up. Enforcing the
 * rest now is the high-value, low-regression-risk move.
 */
const csp = [
  "default-src 'self'",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  "style-src 'self' 'unsafe-inline'",
  "img-src 'self' data: blob: https://i.ytimg.com https://github.com https://avatars.githubusercontent.com https://*.public.blob.vercel-storage.com",
  "font-src 'self' data:",
  // blob: is required so pdfjs/react-pdf can fetch the object URL it creates
  // from the rendered PDF blob (would silently break under an enforced policy
  // otherwise — Report-Only never surfaced it).
  //
  // The two loopback entries are the tailoring sidecar (ADR-0024). Generation
  // has to happen on the operator's own machine because the server holds no
  // model credential (ADR-0015), so the page fetches a process on this port.
  // What this costs: an XSS on this origin could also reach a service the
  // visitor happens to run on 8791. It cannot exfiltrate what it finds — every
  // outbound destination stays on this list — and the port is specific rather
  // than a wildcard, so the widening is one port, not the local network.
  "connect-src 'self' blob: http://127.0.0.1:8791 http://localhost:8791 https://generativelanguage.googleapis.com https://*.public.blob.vercel-storage.com https://vitals.vercel-insights.com",
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
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  // pdfjs ships a Node build that installs its own DOM shims (DOMMatrix,
  // Path2D, ImageData) by detecting the runtime at load time. Bundling it into
  // a serverless function defeats that detection, so page parsing died on
  // Vercel with "DOMMatrix is not defined" while the identical call worked in
  // plain Node locally. Leaving it external keeps the package's own
  // environment handling intact.
  serverExternalPackages: ["pdfjs-dist"],
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
