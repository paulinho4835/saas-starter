"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { confirm } from "@/lib/confirm";
import { createReturn } from "@/app/(dashboard)/devoluciones/actions";

export function ReturnRowAction({ saleItemId, max }: { saleItemId: string; max: number }) {
  const [quantity, setQuantity] = useState(String(max));
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onReturn() {
    const qty = Number(quantity);
    const ok = await confirm({
      title: "Confirmar devolución",
      message: `¿Devolver ${qty} unidad(es)? Se repondrá el stock y se descontará el monto del total de la venta. Esta acción no se puede deshacer.`,
      tone: "danger",
      confirmText: "Devolver",
    });
    if (!ok) return;
    setLoading(true);
    const res = await createReturn(saleItemId, qty);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast("Devolución registrada.");
    router.refresh();
  }

  const qty = Number(quantity);
  const isValid = Number.isInteger(qty) && qty > 0 && qty <= max;

  return (
    <div className="flex items-center gap-2">
      <input
        type="number"
        min={1}
        max={max}
        value={quantity}
        onChange={(e) => setQuantity(e.target.value)}
        className={`${fieldInputClass} w-20`}
      />
      <Button size="sm" variant="secondary" disabled={loading || !isValid} onClick={onReturn}>
        {loading ? "Devolviendo…" : "Devolver"}
      </Button>
    </div>
  );
}
