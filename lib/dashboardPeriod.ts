import type { Period } from "@/app/(dashboard)/dashboard/PeriodSelect";

// Resuelve un período del dashboard a la fecha desde la que filtrar
// `sales.created_at` / `sale_items` (vía `sales.created_at`). `null` para
// "all" significa "sin filtro de fecha".
export function periodSince(period: Period, now: Date = new Date()): Date | null {
  switch (period) {
    case "7d":
      return new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);
    case "30d":
      return new Date(now.getTime() - 30 * 24 * 60 * 60 * 1000);
    case "month":
      return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    case "all":
      return null;
  }
}
