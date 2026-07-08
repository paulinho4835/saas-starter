"use client";
import Link, { useLinkStatus } from "next/link";
import { usePathname } from "next/navigation";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";

// Muestra un spinner en lugar del icono mientras la navegación a este enlace
// está en curso. Da feedback inmediato y elimina la sensación de clic muerto.
function NavIcon({ icon }: { icon: React.ReactNode }) {
  const { pending } = useLinkStatus();
  return (
    <span className="shrink-0 text-white/70">
      {pending ? <Loader2 className="h-[18px] w-[18px] animate-spin" /> : icon}
    </span>
  );
}

export function NavLink({
  href,
  label,
  icon,
  badge,
  onNavigate,
}: {
  href: string;
  label: string;
  icon: React.ReactNode;
  badge?: number;
  onNavigate?: () => void;
}) {
  const pathname = usePathname();
  const active = pathname === href || pathname.startsWith(href + "/");
  return (
    <Link
      href={href}
      onClick={onNavigate}
      aria-current={active ? "page" : undefined}
      className={cn(
        "flex items-center gap-2.5 rounded-md px-3 py-2 text-sm font-medium text-white transition",
        active
          ? "bg-white font-semibold text-sidebar-to [&_span]:text-sidebar-to"
          : "hover:bg-white/10",
      )}
    >
      <NavIcon icon={icon} />
      {label}
      {badge != null && badge > 0 && (
        <span className="ml-auto flex h-5 min-w-5 items-center justify-center rounded-full bg-red-500 px-1 text-[10px] font-bold text-white">
          {badge > 99 ? "99+" : badge}
        </span>
      )}
    </Link>
  );
}
