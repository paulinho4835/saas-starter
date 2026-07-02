"use client";

import { useRouter } from "next/navigation";
import { fieldInputClass } from "@/components/ui/Field";

export type Period = "7d" | "30d" | "month" | "all";

export const PERIOD_LABEL: Record<Period, string> = {
  "7d": "Últimos 7 días",
  "30d": "Últimos 30 días",
  month: "Este mes",
  all: "Todo el tiempo",
};

export function PeriodSelect({ value }: { value: Period }) {
  const router = useRouter();

  return (
    <select
      value={value}
      onChange={(e) => router.replace(`/dashboard?period=${e.target.value}`, { scroll: false })}
      className={`${fieldInputClass} w-auto`}
    >
      {(Object.keys(PERIOD_LABEL) as Period[]).map((p) => (
        <option key={p} value={p}>
          {PERIOD_LABEL[p]}
        </option>
      ))}
    </select>
  );
}
