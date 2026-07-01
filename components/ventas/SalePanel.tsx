"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { toast } from "@/lib/toast";
import { calculateLineSubtotal, calculateSaleTotal } from "@/lib/sales";
import { createSale } from "@/app/(dashboard)/ventas/actions";

type ProductResult = {
  id: string;
  code: string;
  application: string | null;
  brandName: string;
  priceSfBs: number;
  priceCfBs: number;
  priceMayBs: number;
  stock: number;
};

type PriceTier = "sf" | "cf" | "may";

type CartLine = {
  productId: string;
  code: string;
  priceTier: PriceTier;
  unitPriceBs: string;
  quantity: string;
  maxStock: number;
};

const TIER_LABEL: Record<PriceTier, string> = { sf: "SF", cf: "CF", may: "MAY" };

function priceForTier(product: ProductResult, tier: PriceTier): number {
  if (tier === "sf") return product.priceSfBs;
  if (tier === "cf") return product.priceCfBs;
  return product.priceMayBs;
}

export function SalePanel({
  products,
  customers,
}: {
  products: ProductResult[];
  customers: { id: string; full_name: string }[];
}) {
  const [cart, setCart] = useState<CartLine[]>([]);
  const [customerId, setCustomerId] = useState("");
  const [loading, setLoading] = useState(false);
  const router = useRouter();

  function addToCart(product: ProductResult, tier: PriceTier) {
    setCart((prev) => [
      ...prev,
      {
        productId: product.id,
        code: product.code,
        priceTier: tier,
        unitPriceBs: String(priceForTier(product, tier)),
        quantity: "1",
        maxStock: product.stock,
      },
    ]);
  }

  function updateLine(index: number, patch: Partial<CartLine>) {
    setCart((prev) => prev.map((line, i) => (i === index ? { ...line, ...patch } : line)));
  }

  function removeLine(index: number) {
    setCart((prev) => prev.filter((_, i) => i !== index));
  }

  const total = calculateSaleTotal(
    cart.map((l) => ({
      unitPriceBs: Number(l.unitPriceBs) || 0,
      quantity: Number(l.quantity) || 0,
    })),
  );

  async function onConfirm() {
    if (cart.length === 0) {
      toast("Agrega al menos un producto.", "error");
      return;
    }
    const invalidLine = cart.find(
      (l) =>
        !Number.isFinite(Number(l.unitPriceBs)) ||
        !Number.isInteger(Number(l.quantity)) ||
        Number(l.quantity) <= 0,
    );
    if (invalidLine) {
      toast("Revisa precios y cantidades del carrito.", "error");
      return;
    }

    setLoading(true);
    const formData = new FormData();
    if (customerId) formData.set("customerId", customerId);
    formData.set(
      "items",
      JSON.stringify(
        cart.map((l) => ({
          productId: l.productId,
          priceTier: l.priceTier,
          unitPriceBs: Number(l.unitPriceBs),
          quantity: Number(l.quantity),
        })),
      ),
    );
    const res = await createSale(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast(`Venta registrada: ${res.total} Bs.`);
    setCart([]);
    setCustomerId("");
    router.refresh();
  }

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <Card className="lg:col-span-2">
        <ul className="divide-y divide-slate-200">
          {products.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0">
                <p className="truncate font-medium text-slate-800">
                  {p.code} <span className="font-normal text-slate-400">· {p.brandName}</span>
                </p>
                <p className="truncate text-xs text-slate-500">{p.application || "—"}</p>
                <p className="text-xs text-slate-400">
                  Stock: {p.stock} · SF {p.priceSfBs} Bs · CF {p.priceCfBs} Bs · MAY{" "}
                  {p.priceMayBs} Bs
                </p>
              </div>
              <div className="flex shrink-0 gap-1">
                {(["sf", "cf", "may"] as PriceTier[]).map((tier) => (
                  <Button
                    key={tier}
                    size="sm"
                    variant="secondary"
                    disabled={p.stock <= 0}
                    onClick={() => addToCart(p, tier)}
                  >
                    + {TIER_LABEL[tier]}
                  </Button>
                ))}
              </div>
            </li>
          ))}
        </ul>
      </Card>

      <Card className="h-fit space-y-4 p-4">
        <h3 className="font-semibold text-slate-800">Carrito</h3>

        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Cliente (opcional)</span>
          <select
            value={customerId}
            onChange={(e) => setCustomerId(e.target.value)}
            className={fieldInputClass}
          >
            <option value="">Venta de mostrador</option>
            {customers.map((c) => (
              <option key={c.id} value={c.id}>
                {c.full_name}
              </option>
            ))}
          </select>
        </label>

        {cart.length === 0 ? (
          <p className="text-sm text-slate-500">Agrega productos de la lista.</p>
        ) : (
          <ul className="space-y-3">
            {cart.map((line, i) => (
              <li key={i} className="space-y-1 border-b border-slate-100 pb-2 text-sm">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-medium text-slate-700">
                    {line.code} · {TIER_LABEL[line.priceTier]}
                  </span>
                  <button
                    type="button"
                    onClick={() => removeLine(i)}
                    className="text-xs text-red-500 hover:underline"
                  >
                    Quitar
                  </button>
                </div>
                <div className="flex gap-2">
                  <input
                    type="number"
                    step="0.01"
                    value={line.unitPriceBs}
                    onChange={(e) => updateLine(i, { unitPriceBs: e.target.value })}
                    className={`${fieldInputClass} w-24`}
                  />
                  <input
                    type="number"
                    min={1}
                    max={line.maxStock}
                    value={line.quantity}
                    onChange={(e) => updateLine(i, { quantity: e.target.value })}
                    className={`${fieldInputClass} w-20`}
                  />
                  <span className="flex items-center text-slate-500">
                    ={" "}
                    {calculateLineSubtotal({
                      unitPriceBs: Number(line.unitPriceBs) || 0,
                      quantity: Number(line.quantity) || 0,
                    })}{" "}
                    Bs
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}

        <p className="text-right text-lg font-semibold text-slate-800">Total: {total} Bs</p>

        <Button className="w-full" disabled={loading || cart.length === 0} onClick={onConfirm}>
          {loading ? "Confirmando…" : "Confirmar venta"}
        </Button>
      </Card>
    </div>
  );
}
