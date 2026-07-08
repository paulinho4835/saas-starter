"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { updateExchangeRate } from "@/app/(dashboard)/ajustes/actions";

export function ExchangeRateModal({
  open,
  onClose,
  exchangeRate,
}: {
  open: boolean;
  onClose: () => void;
  exchangeRate: number;
}) {
  const [nextRate, setNextRate] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onActualizar() {
    if (!nextRate) return;
    setLoading(true);
    const formData = new FormData();
    formData.set("exchangeRate", nextRate);
    const res = await updateExchangeRate(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error ?? "No se pudo actualizar el tipo de cambio.", "error");
      return;
    }
    toast("Tipo de cambio actualizado. Los precios de todos los productos se recalcularon.");
    setNextRate("");
    onClose();
    router.refresh();
  }

  return (
    <Modal open={open} onClose={onClose} title="Tasa de Cambio">
      <div className="space-y-3">
        <label className="block text-sm">
          <FieldLabel>Tasa de Cambio actual Bs</FieldLabel>
          <input type="text" disabled value={exchangeRate} className={fieldInputClass} />
        </label>
        <label className="block text-sm">
          <FieldLabel>Nueva Tasa de cambio Bs</FieldLabel>
          <input
            type="number"
            step="0.01"
            min={0.01}
            value={nextRate}
            onChange={(e) => setNextRate(e.target.value)}
            className={fieldInputClass}
          />
        </label>
        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={loading || !nextRate} onClick={onActualizar}>
            {loading ? "Actualizando…" : "Actualizar"}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
