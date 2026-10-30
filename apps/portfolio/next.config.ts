import type { NextConfig } from "next";

/**
 * Browser limits that hold even if model text gets past the app's own rendering. `img-src` stops
 * any image from another site loading, which an injected instruction could use to send conversation
 * text away. `frame-ancestors` stops other sites framing the page. This does not limit scripts,
 * which would need a nonce on every Next.js script.
 */
export const CONTENT_SECURITY_POLICY = "img-src 'self' data: blob:; frame-ancestors 'none'";

const nextConfig: NextConfig = {
  headers: async () => [
    {
      source: "/:path*",
      headers: [{ key: "Content-Security-Policy", value: CONTENT_SECURITY_POLICY }],
    },
  ],
};

export default nextConfig;
