"use client";

import { useEffect, useRef } from "react";
import { createPortal } from "react-dom";
import { X } from "lucide-react";
import { cn } from "@/lib/cn";

// Modal accesible reutilizable:
// - cierra con Escape y con click en el fondo
// - bloquea el scroll del body mientras está abierto
// - role="dialog" + aria-modal + foco inicial al abrir
const SIZES = {
  sm: "max-w-sm",
  md: "max-w-md",
  lg: "max-w-lg",
  xl: "max-w-2xl",
} as const;

export function Modal({
  open,
  onClose,
  title,
  subtitle,
  children,
  size = "md",
  className,
}: {
  open: boolean;
  onClose: () => void;
  title?: React.ReactNode;
  subtitle?: React.ReactNode;
  children: React.ReactNode;
  size?: keyof typeof SIZES;
  className?: string;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  // onClose suele ser un arrow function inline que el padre recrea en cada
  // render (ej. cada tecla escrita en un input controlado). Si lo ponemos en
  // las deps del effect, este se re-ejecuta en cada tecla y panelRef.focus()
  // le roba el foco al input. Con la ref evitamos que ese re-render dispare
  // el effect de nuevo.
  const onCloseRef = useRef(onClose);
  onCloseRef.current = onClose;

  // Escape para cerrar + bloqueo de scroll del body.
  useEffect(() => {
    if (!open) return;
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCloseRef.current();
    }
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    // Foco inicial dentro del modal (accesibilidad de teclado).
    panelRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4"
      onClick={onClose}
    >
      <div
        ref={panelRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        onClick={(e) => e.stopPropagation()}
        className={cn(
          "max-h-[90vh] w-full overflow-y-auto rounded-lg bg-white p-5 shadow-xl outline-none",
          SIZES[size],
          className,
        )}
      >
        {(title || subtitle) && (
          <div className="mb-3 flex items-start justify-between">
            <div>
              {title && (
                <h3 className="text-lg font-semibold text-slate-800">{title}</h3>
              )}
              {subtitle && <p className="text-sm text-slate-500">{subtitle}</p>}
            </div>
            <button
              type="button"
              onClick={onClose}
              aria-label="Cerrar"
              className="rounded p-1 text-slate-400 transition hover:bg-slate-100 hover:text-slate-600"
            >
              <X className="h-5 w-5" />
            </button>
          </div>
        )}
        {children}
      </div>
    </div>,
    document.body,
  );
}
