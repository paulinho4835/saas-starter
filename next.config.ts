import type { NextConfig } from "next";

const isDev = process.env.NODE_ENV === "development";

const supabaseConnect = `${process.env.NEXT_PUBLIC_SUPABASE_URL ?? "https://*.supabase.co"} wss://*.supabase.co`;

// Cloudflare R2 (opcional): las URLs firmadas usan el subdominio del bucket.
// Se necesita en connect-src/img-src para subir (PUT) y ver (GET) archivos.
const r2Connect = "https://*.r2.cloudflarestorage.com";

// ── CSP estricta para toda la app ────────────────────────────────────────────
// 'unsafe-inline' en style-src: necesario para Tailwind. 'unsafe-inline' en
// script-src: el script anti-flash de dark mode. 'unsafe-eval' solo en dev (HMR).
const csp = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline'${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: blob: ${r2Connect}`,
  "font-src 'self'",
  "worker-src 'self' blob:",
  `connect-src 'self' ${supabaseConnect} ${r2Connect}`,
  "frame-src 'none'",
  "frame-ancestors 'none'",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
].join("; ");

const securityHeaders = [
  { key: "X-Frame-Options", value: "DENY" },
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=()" },
  { key: "Strict-Transport-Security", value: "max-age=31536000; includeSubDomains" },
  { key: "Content-Security-Policy", value: csp },
];

const nextConfig: NextConfig = {
  reactStrictMode: true,
  outputFileTracingRoot: process.cwd(),
  async headers() {
    return [{ source: "/(.*)", headers: securityHeaders }];
  },
};

export default nextConfig;
