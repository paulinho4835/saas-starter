"use client";

import { useEffect, useState } from "react";
import { Card } from "@/components/ui/Card";
import { FieldLabel, fieldInputClass } from "@/components/ui/Field";
import { getTransferProductStock } from "@/app/(dashboard)/traspasos/actions";

export type TransferInfoProduct = { id: string; code: string; application: string | null };

// "Datos adicionales" del legacy: aplicación del producto + stock en las
// demás sucursales, para el producto seleccionado en la tabla.
export function ProductInfoPanel({ product }: { product: TransferInfoProduct | null }) {
  const [rows, setRows] = useState<{ branchName: string; quantity: number }[]>([]);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!product) {
      setRows([]);
      setError(null);
      return;
    }
    let cancelled = false;
    getTransferProductStock(product.id).then((res) => {
      if (cancelled) return;
      if (!res.ok) {
        setError(res.error);
        setRows([]);
        return;
      }
      setError(null);
      setRows(res.rows);
    });
    return () => {
      cancelled = true;
    };
  }, [product]);

  return (
    <Card className="space-y-3 p-4">
      <div>
        <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-400">
          Sucursal / Stock
        </h3>
        {error && <p className="text-sm text-red-600">{error}</p>}
        {!error && rows.length === 0 && (
          <p className="text-sm text-slate-400">Selecciona un producto para ver su stock.</p>
        )}
        {!error && rows.length > 0 && (
          <table className="w-full text-sm">
            <tbody>
              {rows.map((r) => (
                <tr key={r.branchName} className="border-b border-slate-100">
                  <td className="py-1 text-slate-700">{r.branchName}</td>
                  <td className="py-1 text-right font-medium text-slate-800">{r.quantity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      <label className="block text-sm">
        <FieldLabel>Aplicación producto</FieldLabel>
        <textarea
          disabled
          rows={5}
          value={product?.application ?? ""}
          placeholder={product ? "Este producto no tiene aplicación registrada." : "Selecciona un producto."}
          className={fieldInputClass}
        />
      </label>
    </Card>
  );
}
