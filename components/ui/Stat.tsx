import { cn } from "@/lib/cn";

// Tarjeta de métrica (KPI).
export function Stat({
  label,
  value,
  icon,
  valueClassName,
}: {
  label: string;
  value: React.ReactNode;
  icon?: React.ReactNode;
  valueClassName?: string;
}) {
  return (
    <div className="rounded-lg bg-white p-5 shadow-sm ring-1 ring-slate-200">
      <div className="flex items-center justify-between">
        <p className="text-xs font-medium uppercase tracking-wide text-slate-500">
          {label}
        </p>
        {icon && <span className="text-slate-400">{icon}</span>}
      </div>
      <p
        className={cn(
          "mt-2 text-2xl font-bold tabular-nums text-slate-700",
          valueClassName,
        )}
      >
        {value}
      </p>
    </div>
  );
}
