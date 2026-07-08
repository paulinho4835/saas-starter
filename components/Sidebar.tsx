"use client";

import { useEffect, useState } from "react";
import { usePathname } from "next/navigation";
import {
  Home,
  Users,
  Package,
  Settings,
  ShieldCheck,
  Shield,
  Wrench,
  Truck,
  History,
  UserCog,
  Menu,
  X,
  type LucideIcon,
} from "lucide-react";
import { NavLink } from "@/components/NavLink";
import { SignOutButton } from "@/components/SignOutButton";
import { ButtonLink } from "@/components/ui/Button";
import { ThemeToggle } from "@/components/ui/ThemeToggle";

export type NavItem = { href: string; label: string; badge?: number };

const ICONS: Record<string, LucideIcon> = {
  "/dashboard": Home,
  "/clientes": Users,
  "/items": Package,
  "/productos": Wrench,
  "/proveedores": Truck,
  "/ajuste-inventario": History,
  "/usuarios": UserCog,
  "/ajustes": Settings,
  "/auditoria": ShieldCheck,
};

function navIcon(href: string) {
  const Icon = ICONS[href];
  return Icon ? <Icon className="h-[18px] w-[18px]" /> : <span>•</span>;
}

export function Sidebar({
  orgName,
  subtitle,
  initials,
  nav,
  superadmin,
}: {
  orgName: string;
  subtitle: string;
  initials: string | null;
  nav: NavItem[];
  superadmin: boolean;
}) {
  const [open, setOpen] = useState(false);
  const pathname = usePathname();

  // Cierra el drawer al navegar (móvil).
  useEffect(() => {
    setOpen(false);
  }, [pathname]);

  // Bloquea scroll del body cuando el drawer está abierto en móvil.
  useEffect(() => {
    if (!open) return;
    const prev = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = prev;
    };
  }, [open]);

  // Degradado rojo del sidebar legacy: fijo, no se invierte con el tema
  // claro/oscuro (como "night" en tailwind.config), igual que en el original.
  const content = (
    <div className="flex h-full flex-col bg-gradient-to-b from-sidebar-from to-sidebar-to p-4">
      <div className="mb-6 flex items-center gap-3">
        {initials && (
          <div className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-white text-sm font-bold text-sidebar-to">
            {initials}
          </div>
        )}
        <div className="min-w-0">
          <div className="truncate text-lg font-bold text-white">
            {orgName}
          </div>
          <div className="truncate text-xs text-white/70">{subtitle}</div>
        </div>
      </div>

      <nav className="space-y-1">
        {nav.map((item) => (
          <NavLink
            key={item.href}
            href={item.href}
            label={item.label}
            icon={navIcon(item.href)}
            badge={item.badge}
            onNavigate={() => setOpen(false)}
          />
        ))}
      </nav>

      {superadmin && (
        <div className="mt-6 border-t border-white/20 pt-4">
          <ButtonLink href="/superadmin" variant="dark" className="w-full">
            <Shield className="h-4 w-4" /> Superadmin
          </ButtonLink>
        </div>
      )}

      <div className="mt-auto space-y-1 border-t border-white/20 pt-4 [&_button]:!text-white [&_button]:hover:!bg-white/10">
        <ThemeToggle />
        <SignOutButton />
      </div>
    </div>
  );

  return (
    <>
      {/* Barra superior solo en móvil */}
      <header className="sticky top-0 z-30 flex items-center gap-3 border-b border-slate-200 bg-white/95 px-4 py-3 md:hidden">
        <button
          type="button"
          onClick={() => setOpen(true)}
          aria-label="Abrir menú"
          className="rounded-md p-1.5 text-slate-600 hover:bg-slate-100"
        >
          <Menu className="h-5 w-5" />
        </button>
        <span className="truncate font-semibold text-brand-fg">{orgName}</span>
      </header>

      {/* Sidebar fijo en escritorio */}
      <aside className="sticky top-0 hidden h-screen w-60 shrink-0 md:block">
        {content}
      </aside>

      {/* Drawer en móvil */}
      {open && (
        <div className="fixed inset-0 z-40 md:hidden">
          <div
            className="absolute inset-0 bg-black/40"
            onClick={() => setOpen(false)}
          />
          <div className="absolute left-0 top-0 h-full w-64 shadow-xl">
            <button
              type="button"
              onClick={() => setOpen(false)}
              aria-label="Cerrar menú"
              className="absolute right-2 top-2 rounded-md p-1.5 text-white/70 hover:bg-white/10 hover:text-white"
            >
              <X className="h-5 w-5" />
            </button>
            {content}
          </div>
        </div>
      )}
    </>
  );
}
