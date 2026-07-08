"use client";

import { Fragment } from "react";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { calculateLineSubtotal, calculateSaleTotal } from "@/lib/sales";
import type { PriceTier } from "@/lib/ventasCart";

export type PaymentMethod = "efectivo" | "qr";

export type CartLine = {
  productId: string;
  code: string;
  tier: PriceTier;
  unitPriceBs: string;
  quantity: string;
  maxStock: number;
};

// El legacy agrupa el carrito en 3 secciones independientes (una venta puede
// mezclar CF/SF/MAY). Las 3 cabeceras se muestran siempre, incluso vacías
// (actualizar_carrito_venta en ventas.js pinta el header con solo chequear
// que la sección no sea null, no que tenga líneas) — el panel del carrito es
// visible desde el inicio, no aparece recién al agregar el primer producto.
const TIER_SECTION_LABEL: Record<PriceTier, string> = {
  cf: "Productos Venta con Factura",
  sf: "Productos Venta sin Factura",
  may: "Productos Venta al por Mayor",
};
// Mismos colores exactos que ProductsTable.tsx (public/css/table.css:
// .verde/.amarillo/.rojo del legacy) — el carrito colorea cada línea según su
// tier, igual que la tabla de productos.
const TIER_ROW_CLASS: Record<PriceTier, string> = {
  cf: "bg-[#c2dfc2]",
  sf: "bg-[#fffccf]",
  may: "bg-[#ffd6d6]",
};
const TIER_ORDER: PriceTier[] = ["cf", "sf", "may"];

export function CartPanel({
  paymentMethod,
  onChangePaymentMethod,
  cart,
  onRemoveLine,
  loading,
  onConfirm,
}: {
  paymentMethod: PaymentMethod;
  onChangePaymentMethod: (next: PaymentMethod) => void;
  cart: CartLine[];
  onRemoveLine: (index: number) => void;
  loading: boolean;
  onConfirm: () => void;
}) {
  const total = calculateSaleTotal(
    cart.map((l) => ({
      unitPriceBs: Number(l.unitPriceBs) || 0,
      quantity: Number(l.quantity) || 0,
    })),
  );

  return (
    <Card className="space-y-4 p-4">
      <h3 className="text-lg text-slate-800">Productos para la Venta</h3>

      {/* Método de pago (efectivo/QR): capa nuestra encima del tier, sin
          equivalente en el legacy — el nombre/NIT del cliente para ventas con
          factura se piden en el modal "Datos de Venta con Factura" al
          confirmar, igual que el legacy (modal_formulario_cliente.blade.php),
          no en un campo siempre visible aquí. */}
      <label className="block max-w-xs text-sm">
        <span className="mb-1 block text-slate-600">Método de pago</span>
        <select
          value={paymentMethod}
          onChange={(e) => onChangePaymentMethod(e.target.value as PaymentMethod)}
          className={fieldInputClass}
        >
          <option value="efectivo">Efectivo</option>
          <option value="qr">QR</option>
        </select>
      </label>

      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2">Código</th>
            <th className="px-3 py-2">Cantidad</th>
            <th className="px-3 py-2">Precio Establecido</th>
            <th className="px-3 py-2">Sub Total</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {TIER_ORDER.map((tier) => {
            const lines = cart
              .map((line, index) => ({ line, index }))
              .filter(({ line }) => line.tier === tier);
            return (
              <Fragment key={tier}>
                <tr className="bg-slate-50">
                  <td colSpan={5} className="px-3 py-2 font-medium text-slate-700">
                    {TIER_SECTION_LABEL[tier]}
                  </td>
                </tr>
                {lines.map(({ line, index }) => (
                  <tr key={index} className={TIER_ROW_CLASS[tier]}>
                    <td className="px-3 py-2 font-medium text-slate-800">{line.code}</td>
                    <td className="px-3 py-2 text-slate-600">{line.quantity}</td>
                    <td className="px-3 py-2 text-slate-600">{line.unitPriceBs}</td>
                    <td className="px-3 py-2 text-slate-600">
                      {calculateLineSubtotal({
                        unitPriceBs: Number(line.unitPriceBs) || 0,
                        quantity: Number(line.quantity) || 0,
                      })}
                    </td>
                    <td className="px-3 py-2 text-right">
                      {/* .btn-danger del legacy: rojo Bootstrap sólido. */}
                      <button
                        type="button"
                        onClick={() => onRemoveLine(index)}
                        className="rounded bg-[#d9534f] px-2 py-1 text-xs font-medium text-white hover:bg-[#c9302c]"
                      >
                        Quitar
                      </button>
                    </td>
                  </tr>
                ))}
              </Fragment>
            );
          })}
          <tr>
            <td colSpan={3} className="px-3 py-2 font-semibold text-slate-800">
              Total de la Venta
            </td>
            <td className="px-3 py-2 font-semibold text-slate-800">{total}</td>
            <td />
          </tr>
        </tbody>
      </table>

      <div className="flex justify-center">
        <Button disabled={loading} onClick={onConfirm}>
          {loading ? "Confirmando…" : "Venta"}
        </Button>
      </div>
    </Card>
  );
}
