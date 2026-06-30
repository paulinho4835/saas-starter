import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/legal";

// Layout centrado para todas las pantallas de autenticación.
export default function AuthLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 px-4 py-10">
      <div className="w-full max-w-sm">
        <h1 className="mb-6 text-center text-2xl font-bold text-brand-fg">
          {PLATFORM_NAME}
        </h1>
        {children}
      </div>
      <footer className="text-center text-xs text-slate-400">
        <Link href="/terminos" className="hover:underline">
          Términos
        </Link>
        {" · "}
        <Link href="/privacidad" className="hover:underline">
          Privacidad
        </Link>
      </footer>
    </main>
  );
}
