import type { PlatformUsage } from "@/lib/platformUsage";
import { Card } from "@/components/ui/Card";

function formatBytes(bytes: number): string {
  if (bytes >= 1024 * 1024 * 1024) {
    return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function barColor(pct: number): string {
  if (pct > 90) return "bg-red-500";
  if (pct >= 70) return "bg-amber-500";
  return "bg-emerald-500";
}

function UsageBar({
  label,
  used,
  limit,
}: {
  label: string;
  used: number;
  limit: number;
}) {
  const pct = limit > 0 ? Math.min(100, (used / limit) * 100) : 0;
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between text-sm">
        <span className="font-medium text-slate-700">{label}</span>
        <span className="text-slate-500">
          {formatBytes(used)} / {formatBytes(limit)} ({pct.toFixed(1)}%)
        </span>
      </div>
      <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
        <div
          className={`h-full rounded-full ${barColor(pct)}`}
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

export function UsagePanel({ usage }: { usage: PlatformUsage }) {
  return (
    <Card className="space-y-4 p-4">
      <h2 className="text-sm font-semibold text-slate-800">
        Uso de Supabase (plan Free)
      </h2>
      <div className="grid gap-4 md:grid-cols-2">
        <UsageBar
          label="Base de datos"
          used={usage.dbBytes}
          limit={usage.dbLimitBytes}
        />
        <UsageBar
          label="Storage"
          used={usage.storageBytes}
          limit={usage.storageLimitBytes}
        />
      </div>
    </Card>
  );
}
