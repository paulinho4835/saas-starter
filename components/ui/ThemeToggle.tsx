"use client";

import { useEffect, useState } from "react";
import { Moon, Sun } from "lucide-react";

// Alterna entre tema claro y oscuro. El tema inicial ya lo aplica el script
// inline del layout (sin parpadeo); aquí solo lo leemos y lo cambiamos.
export function ThemeToggle() {
  const [dark, setDark] = useState(false);
  const [mounted, setMounted] = useState(false);

  useEffect(() => {
    setMounted(true);
    setDark(document.documentElement.classList.contains("dark"));
  }, []);

  function toggle() {
    const next = !dark;
    setDark(next);
    document.documentElement.classList.toggle("dark", next);
    try {
      localStorage.setItem("theme", next ? "dark" : "light");
    } catch {
      /* almacenamiento no disponible */
    }
  }

  const label = dark ? "Activar modo claro" : "Activar modo oscuro";

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={label}
      title={label}
      className="flex w-full items-center gap-2 rounded-md px-3 py-2 text-sm text-slate-600 transition hover:bg-slate-100"
    >
      {mounted && dark ? (
        <>
          <Sun className="h-4 w-4" /> Modo claro
        </>
      ) : (
        <>
          <Moon className="h-4 w-4" /> Modo oscuro
        </>
      )}
    </button>
  );
}
