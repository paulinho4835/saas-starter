import Link from "next/link";
import { PLATFORM_NAME } from "@/lib/legal";

// Layout de lectura para los documentos legales públicos.
export default function LegalLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <main className="mx-auto min-h-screen max-w-2xl px-5 py-10">
      <Link
        href="/login"
        className="text-sm text-brand hover:underline"
      >
        ← {PLATFORM_NAME}
      </Link>
      <div className="mt-6">{children}</div>
    </main>
  );
}
