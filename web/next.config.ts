import type { NextConfig } from "next";

/**
 * Security headers.
 *
 * The transaction confirm dialog is an in-page overlay, not a wallet popup, so a
 * framing attacker could otherwise position an invisible copy of this app over
 * their own page and harvest a Confirm click. `frame-ancestors` is the fix.
 *
 * The CSP is deliberately scoped to `frame-ancestors` only: Next 16 ships an inline
 * bootstrap script and the Para SDK injects inline styles and talks to its own
 * origins, so a strict `script-src`/`connect-src` would need `unsafe-inline` (worth
 * nothing) or a nonce on every Para-injected node (which we do not control). A
 * narrow directive that is actually enforced beats a broad one that has to be
 * neutered to keep the app running.
 */
const securityHeaders = [
  { key: "Content-Security-Policy", value: "frame-ancestors 'none'" },
  // Belt and braces for anything that still only understands the legacy header.
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
];

const nextConfig: NextConfig = {
  async headers() {
    return [{ source: "/:path*", headers: securityHeaders }];
  },
};

export default nextConfig;
