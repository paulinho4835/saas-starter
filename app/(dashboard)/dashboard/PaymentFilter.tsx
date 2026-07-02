"use client";

import { useRouter } from "next/navigation";
import { fieldInputClass } from "@/components/ui/Field";

export type PaymentFilterValue = "total" | "efectivo" | "qr";

export const PAYMENT_FILTER_LABEL: Record<PaymentFilterValue, string> = {
  total: "Ventas Totales",
  efectivo: "Ventas Efectivo",
  qr: "Ventas QR",
};

export function PaymentFilter({ value, period }: { value: PaymentFilterValue; period: string }) {
  const router = useRouter();

  return (
    <select
      value={value}
      onChange={(e) =>
        router.replace(`/dashboard?period=${period}&payment=${e.target.value}`, { scroll: false })
      }
      className={`${fieldInputClass} w-auto`}
    >
      {(Object.keys(PAYMENT_FILTER_LABEL) as PaymentFilterValue[]).map((v) => (
        <option key={v} value={v}>
          {PAYMENT_FILTER_LABEL[v]}
        </option>
      ))}
    </select>
  );
}
