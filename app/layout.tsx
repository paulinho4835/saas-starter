import type { Metadata, Viewport } from "next";
import { Inter } from "next/font/google";
import { PLATFORM_NAME } from "@/lib/legal";
import "./globals.css";

const inter = Inter({
  subsets: ["latin"],
  display: "swap",
  variable: "--font-sans",
});

// Se ejecuta antes de pintar: aplica el tema guardado (o el del sistema) para
// evitar el parpadeo claro→oscuro en la carga.
const themeScript = `(function(){try{var t=localStorage.getItem('theme');var d=t==='dark'||(!t&&window.matchMedia('(prefers-color-scheme: dark)').matches);if(d)document.documentElement.classList.add('dark');}catch(e){}})();`;

export const metadata: Metadata = {
  title: PLATFORM_NAME,
  description: "Plataforma SaaS multi-tenant.",
  appleWebApp: {
    capable: true,
    statusBarStyle: "default",
    title: PLATFORM_NAME,
  },
};

export const viewport: Viewport = {
  themeColor: "#4f46e5",
};

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <html lang="es" className={inter.variable} suppressHydrationWarning>
      <body>
        <script dangerouslySetInnerHTML={{ __html: themeScript }} />
        {children}
      </body>
    </html>
  );
}
