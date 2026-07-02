"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { Field, fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { transferStock } from "@/app/(dashboard)/almacen/actions";

export function TransferStockButton({
  productId,
  destinationBranches,
}: {
  productId: string;
  destinationBranches: { id: string; name: string }[];
}) {
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [toBranchId, setToBranchId] = useState(destinationBranches[0]?.id ?? "");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  async function onConfirm() {
    setLoading(true);
    const formData = new FormData();
    formData.set("productId", productId);
    formData.set("toBranchId", toBranchId);
    formData.set("quantity", quantity);
    const res = await transferStock(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast("Stock transferido.");
    setOpen(false);
    setQuantity("1");
    router.refresh();
  }

  return (
    <>
      <Button
        size="sm"
        variant="secondary"
        onClick={() => setOpen(true)}
        disabled={destinationBranches.length === 0}
      >
        Transferir
      </Button>
      <Modal open={open} onClose={() => setOpen(false)} title="Transferir a sucursal">
        <div className="space-y-3">
          <label className="block text-sm">
            <span className="mb-1 block text-slate-600">Sucursal destino</span>
            <select
              value={toBranchId}
              onChange={(e) => setToBranchId(e.target.value)}
              className={fieldInputClass}
            >
              {destinationBranches.map((b) => (
                <option key={b.id} value={b.id}>
                  {b.name}
                </option>
              ))}
            </select>
          </label>
          <Field
            label="Cantidad"
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
          />
          <Button
            className="w-full"
            disabled={loading || !toBranchId || Number(quantity) <= 0}
            onClick={onConfirm}
          >
            {loading ? "Transfiriendo…" : "Confirmar"}
          </Button>
        </div>
      </Modal>
    </>
  );
}
