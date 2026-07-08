"use client";

import { useEffect, useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { fieldInputClass } from "@/components/ui/Field";

const DEBOUNCE_MS = 300;

export function TraspasosFilters({ initialCode }: { initialCode: string }) {
  const router = useRouter();
  const [code, setCode] = useState(initialCode);
  const [isPending, startTransition] = useTransition();
  const timeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    return () => {
      if (timeoutRef.current) clearTimeout(timeoutRef.current);
    };
  }, []);

  function update(value: string) {
    setCode(value);
    if (timeoutRef.current) clearTimeout(timeoutRef.current);
    timeoutRef.current = setTimeout(() => {
      const params = new URLSearchParams();
      params.set("tab", "sol_env");
      if (value) params.set("code", value);
      startTransition(() => {
        router.replace(`/traspasos?${params.toString()}`, { scroll: false });
      });
    }, DEBOUNCE_MS);
  }

  return (
    <Card className="p-4">
      <label className="block text-sm">
        <span className="mb-1 block text-slate-600">Código de producto</span>
        <input
          type="text"
          value={code}
          onChange={(e) => update(e.target.value)}
          className={fieldInputClass}
          autoFocus
          autoComplete="off"
        />
      </label>
      <span className="mt-1 block text-xs text-slate-400" aria-live="polite">
        {isPending ? "Buscando…" : ""}
      </span>
    </Card>
  );
}
