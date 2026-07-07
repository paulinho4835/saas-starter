import { ArrowRight } from "lucide-react";

// Aviso de "esto se desliza" para tablas anchas con overflow-x-auto. Solo se
// ve en pantallas angostas (md:hidden) — en desktop la tabla ya entra
// completa o el scroll es obvio con mouse/trackpad.
export function ScrollHint() {
  return (
    <p className="flex items-center gap-1 border-b border-slate-100 bg-slate-50 px-3 py-1.5 text-xs text-slate-400 md:hidden">
      Desliza para ver más <ArrowRight className="h-3 w-3" />
    </p>
  );
}
