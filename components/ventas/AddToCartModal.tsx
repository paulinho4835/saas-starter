"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { isValidCartQuantity, isValidCartPrice, type PriceTier } from "@/lib/ventasCart";

export type AddToCartModalProduct = {
  id: string;
  code: string;
  tier: PriceTier;
  priceBs: number;
  stock: number;
};

export type AddToCartLine = {
  productId: string;
  code: string;
  tier: PriceTier;
  unitPriceBs: number;
  quantity: number;
};

const TIER_PRICE_LABEL: Record<PriceTier, string> = {
  cf: "Precio Con Factura (CF)",
  sf: "Precio Sin Factura (SF)",
  may: "Precio Mayorista (MAY)",
};

export function AddToCartModal({
  product,
  onClose,
  onAdd,
}: {
  product: AddToCartModalProduct | null;
  onClose: () => void;
  onAdd: (line: AddToCartLine) => string | null;
}) {
  const [customPrice, setCustomPrice] = useState("");
  const [quantity, setQuantity] = useState("");
  const [error, setError] = useState<string | null>(null);

  // Cada vez que se abre el modal con un producto distinto, limpia los
  // campos y el error de la vez anterior.
  useEffect(() => {
    setCustomPrice("");
    setQuantity("");
    setError(null);
  }, [product?.id, product?.tier]);

  if (!product) return null;

  const qtyNumber = Number(quantity);
  const qtyValid = isValidCartQuantity(qtyNumber, product.stock);
  const priceNumber = customPrice === "" ? product.priceBs : Number(customPrice);
  const priceValid = isValidCartPrice(priceNumber);

  function handleAdd() {
    if (!product || !qtyValid || !priceValid) return;
    const err = onAdd({
      productId: product.id,
      code: product.code,
      tier: product.tier,
      unitPriceBs: priceNumber,
      quantity: qtyNumber,
    });
    if (err) {
      setError(err);
      return;
    }
    onClose();
  }

  return (
    <Modal open={Boolean(product)} onClose={onClose} title="Cantidad de producto">
      <div className="space-y-3">
        <label className="block text-sm">
          <FieldLabel>Código de producto</FieldLabel>
          <input type="text" disabled value={product.code} className={fieldInputClass} />
        </label>

        <label className="block text-sm">
          <FieldLabel>{TIER_PRICE_LABEL[product.tier]}</FieldLabel>
          <input type="text" disabled value={product.priceBs} className={fieldInputClass} />
        </label>

        <label className="block text-sm">
          <FieldLabel>Stock de Sucursal Actual</FieldLabel>
          <input type="text" disabled value={product.stock} className={fieldInputClass} />
        </label>

        <label className="block text-sm">
          <FieldLabel>Establecer precio</FieldLabel>
          <input
            type="number"
            step="0.01"
            min={0}
            value={customPrice}
            onChange={(e) => setCustomPrice(e.target.value)}
            placeholder={String(product.priceBs)}
            className={fieldInputClass}
          />
        </label>

        <label className="block text-sm">
          <FieldLabel>Cantidad</FieldLabel>
          <input
            type="number"
            min={1}
            max={product.stock}
            value={quantity}
            onChange={(e) => setQuantity(e.target.value)}
            className={fieldInputClass}
          />
        </label>

        {error && <p className="text-sm text-red-600">{error}</p>}

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose}>
            Cancelar
          </Button>
          <Button type="button" disabled={!qtyValid || !priceValid} onClick={handleAdd}>
            Agregar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
