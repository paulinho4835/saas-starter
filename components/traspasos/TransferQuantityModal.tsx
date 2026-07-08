"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { isPositiveInteger } from "@/lib/transferCart";
import { validateTransferQuantity } from "@/app/(dashboard)/traspasos/actions";

export type TransferProceso = "pedido" | "envio";
export type TransferModalProduct = { id: string; code: string };
export type TransferModalLine = {
  productId: string;
  code: string;
  branchId: string;
  branchName: string;
  quantity: number;
};

export function TransferQuantityModal({
  product,
  proceso,
  branches,
  ownBranchId,
  onClose,
  onAdd,
}: {
  product: TransferModalProduct | null;
  proceso: TransferProceso | null;
  branches: { id: string; name: string }[];
  ownBranchId: string;
  onClose: () => void;
  onAdd: (line: TransferModalLine) => void;
}) {
  const [branchId, setBranchId] = useState(branches[0]?.id ?? "");
  const [quantity, setQuantity] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  // Cada vez que se abre el modal con un producto/proceso distinto, limpia
  // los campos y el error de la vez anterior.
  useEffect(() => {
    setBranchId(branches[0]?.id ?? "");
    setQuantity("");
    setError(null);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [product?.id, proceso]);

  if (!product || !proceso) return null;

  const qtyNumber = Number(quantity);
  const qtyValid = isPositiveInteger(qtyNumber);

  async function handleAdd() {
    if (!product || !proceso || !qtyValid || !branchId) return;
    setLoading(true);
    setError(null);
    const formData = new FormData();
    formData.set("productId", product.id);
    // Envío valida contra el stock PROPIO (siempre se manda desde la propia
    // sucursal); Pedido valida contra el stock de la sucursal elegida (a
    // quien se le pide) — igual que agregar_producto_carrito() del legacy.
    formData.set("branchId", proceso === "envio" ? ownBranchId : branchId);
    formData.set("quantity", quantity);
    const res = await validateTransferQuantity(formData);
    setLoading(false);
    if (!res.ok) {
      setError(res.error);
      return;
    }
    const branch = branches.find((b) => b.id === branchId);
    onAdd({
      productId: product.id,
      code: product.code,
      branchId,
      branchName: branch?.name ?? "—",
      quantity: qtyNumber,
    });
    onClose();
  }

  const title = proceso === "pedido" ? "Pedido de Productos" : "Envío de Productos";
  const branchLabel = proceso === "pedido" ? "Seleccione Sucursal (origen)" : "Seleccione Sucursal (destino)";
  const procesoLabel = proceso === "pedido" ? "Pedido" : "Envío";

  return (
    <Modal open={Boolean(product) && Boolean(proceso)} onClose={onClose} title={title}>
      <div className="space-y-3">
        <label className="block text-sm">
          <FieldLabel>{branchLabel}</FieldLabel>
          <select value={branchId} onChange={(e) => setBranchId(e.target.value)} className={fieldInputClass}>
            {branches.map((b) => (
              <option key={b.id} value={b.id}>
                {b.name}
              </option>
            ))}
          </select>
        </label>

        <label className="block text-sm">
          <FieldLabel>Código de Producto</FieldLabel>
          <input type="text" disabled value={product.code} className={fieldInputClass} />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <label className="block text-sm">
          <FieldLabel>Seleccione Cantidad de {procesoLabel}</FieldLabel>
          <input
            type="number"
            min={1}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={fieldInputClass}
            autoComplete="off"
          />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="button" disabled={!qtyValid || !branchId || loading} onClick={handleAdd}>
            {loading ? "Verificando…" : `Agregar al carrito de ${procesoLabel}`}
          </Button>
        </div>
      </div>
    </Modal>
  );
}
