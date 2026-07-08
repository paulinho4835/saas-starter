"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import { calculateLineSubtotal, calculateSaleTotal } from "@/lib/sales";
import { SALE_TYPES, SALE_TYPE_LABEL, type SaleType } from "@/lib/saleType";

export type CartLine = {
  productId: string;
  code: string;
  unitPriceBs: string;
  quantity: string;
  maxStock: number;
};

export function CartPanel({
  saleType,
  onChangeSaleType,
  cart,
  onRemoveLine,
  customerName,
  onChangeCustomerName,
  customerNit,
  onChangeCustomerNit,
  loading,
  onConfirm,
}: {
  saleType: SaleType;
  onChangeSaleType: (next: SaleType) => void;
  cart: CartLine[];
  onRemoveLine: (index: number) => void;
  customerName: string;
  onChangeCustomerName: (value: string) => void;
  customerNit: string;
  onChangeCustomerNit: (value: string) => void;
  loading: boolean;
  onConfirm: () => void;
}) {
  if (cart.length === 0) return null;

  const total = calculateSaleTotal(
    cart.map((l) => ({
      unitPriceBs: Number(l.unitPriceBs) || 0,
      quantity: Number(l.quantity) || 0,
    })),
  );

  return (
    <Card className="space-y-4 p-4">
      <h3 className="text-lg text-slate-800">Productos para la Venta</h3>

      <div className="grid gap-3 sm:grid-cols-3">
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Tipo de venta</span>
          <select
            value={saleType}
            onChange={(e) => onChangeSaleType(e.target.value as SaleType)}
            className={fieldInputClass}
          >
            {SALE_TYPES.map((t) => (
              <option key={t} value={t}>
                {SALE_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Nombre del cliente (opcional)</span>
          <input
            type="text"
            value={customerName}
            onChange={(e) => onChangeCustomerName(e.target.value)}
            placeholder="Venta de mostrador"
            className={fieldInputClass}
          />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">NIT (opcional)</span>
          <input
            type="text"
            value={customerNit}
            onChange={(e) => onChangeCustomerNit(e.target.value)}
            className={fieldInputClass}
          />
        </label>
      </div>

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
          <tr className="bg-slate-50">
            <td colSpan={5} className="px-3 py-2 font-medium text-slate-700">
              Productos Venta {SALE_TYPE_LABEL[saleType]}
            </td>
          </tr>
          {cart.map((line, i) => (
            <tr key={i} className="border-b border-slate-100">
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
                <button
                  type="button"
                  onClick={() => onRemoveLine(i)}
                  className="rounded bg-rose-200 px-2 py-1 text-xs font-medium text-rose-800 hover:bg-rose-300"
                >
                  Quitar
                </button>
              </td>
            </tr>
          ))}
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
