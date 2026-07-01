"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { adjustStock } from "@/app/(dashboard)/ajuste-inventario/actions";

export function AdjustStockButton({
  productId,
  branchId,
  direction,
}: {
  productId: string;
  branchId: string;
  direction: "add" | "reduce";
}) {
  const [open, setOpen] = useState(false);
  const [amount, setAmount] = useState("1");
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onConfirm() {
    setLoading(true);
    const formData = new FormData();
    formData.set("productId", productId);
    formData.set("branchId", branchId);
    formData.set("direction", direction);
    formData.set("amount", amount);
    formData.set("reason", reason);
    const res = await adjustStock(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast(direction === "add" ? "Stock agregado." : "Stock reducido.");
    setOpen(false);
    setAmount("1");
    setReason("");
    router.refresh();
  }

  return (
    <>
      <Button
        size="sm"
        variant={direction === "add" ? "secondary" : "danger"}
        onClick={() => setOpen(true)}
      >
        {direction === "add" ? "Agregar" : "Reducir"}
      </Button>
      <Modal
        open={open}
        onClose={() => setOpen(false)}
        title={direction === "add" ? "Agregar stock" : "Reducir stock"}
      >
        <div className="space-y-3">
          <Field
            label="Cantidad"
            type="number"
            min={1}
            value={amount}
            onChange={(e) => setAmount(e.target.value)}
          />
          <Field
            label="Motivo"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Ej. Conteo físico, mercadería dañada, corrección de captura"
          />
          <Button
            className="w-full"
            disabled={loading || !reason.trim() || Number(amount) <= 0}
            onClick={onConfirm}
          >
            {loading ? "Guardando…" : "Confirmar"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
