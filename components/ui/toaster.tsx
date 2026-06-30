"use client";
import { useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { CheckCircle2, XCircle, Info, X } from "lucide-react";
import { _subscribe, type ToastItem } from "@/lib/toast";

const MAX_VISIBLE = 4; // evita que se acumulen infinitos toasts en pantalla

const STYLES = {
  success: { ring: "ring-emerald-700 bg-emerald-600", Icon: CheckCircle2 },
  error: { ring: "ring-red-700 bg-red-600", Icon: XCircle },
  info: { ring: "ring-night bg-night-soft", Icon: Info },
} as const;

export function Toaster() {
  const [items, setItems] = useState<ToastItem[]>([]);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    return _subscribe((t) => {
      // Mantiene solo los últimos MAX_VISIBLE.
      setItems((prev) => [...prev, t].slice(-MAX_VISIBLE));
      setTimeout(() => setItems((p) => p.filter((x) => x.id !== t.id)), 3500);
    });
  }, []);

  if (!mounted) return null;

  function dismiss(id: number) {
    setItems((p) => p.filter((x) => x.id !== id));
  }

  return createPortal(
    <div className="pointer-events-none fixed bottom-4 right-4 z-[200] flex flex-col-reverse gap-2">
      {items.map((t) => {
        const { ring, Icon } = STYLES[t.type];
        return (
          <div
            key={t.id}
            role="status"
            style={{ animation: "toast-in 0.2s ease-out" }}
            className={`pointer-events-auto flex items-center gap-2.5 rounded-lg px-4 py-3 text-sm font-medium text-white shadow-lg ring-1 ${ring}`}
          >
            <Icon className="h-4 w-4 shrink-0" />
            <span className="flex-1">{t.message}</span>
            <button
              type="button"
              onClick={() => dismiss(t.id)}
              aria-label="Cerrar notificación"
              className="shrink-0 rounded p-0.5 text-white/70 transition hover:bg-white/20 hover:text-white"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        );
      })}
      <style>{`
        @keyframes toast-in {
          from { opacity: 0; transform: translateY(8px); }
          to   { opacity: 1; transform: translateY(0); }
        }
      `}</style>
    </div>,
    document.body,
  );
}
