"use client";

import { useState } from "react";
import { Card } from "@/components/ui/Card";

export type PedidoRow = {
  key: string;
  code: string;
  brand: string | null;
  application: string | null;
  branch: string | null;
  quantity: number;
  internalMm: number | null;
  externalMm: number | null;
  heightMm: number | null;
  flangeMm: number | null;
  stopMm: number | null;
};

export type PedidoGroup = {
  supplier: string;
  rows: PedidoRow[];
};

function formatMm(value: number | null): string {
  if (value === null) return "—";
  return String(Number(value.toFixed(2)));
}

export function PedidosList({ groups }: { groups: PedidoGroup[] }) {
  const allKeys = groups.flatMap((g) => g.rows.map((r) => r.key));
  const [selected, setSelected] = useState<Set<string>>(new Set(allKeys));

  function toggle(key: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }

  function toggleGroup(group: PedidoGroup, checked: boolean) {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const row of group.rows) {
        if (checked) next.add(row.key);
        else next.delete(row.key);
      }
      return next;
    });
  }

  function toggleAll(checked: boolean) {
    setSelected(checked ? new Set(allKeys) : new Set());
  }

  return (
    <div className="space-y-4">
      <label className="flex items-center gap-2 text-sm text-slate-600 print:hidden">
        <input
          type="checkbox"
          checked={selected.size === allKeys.length}
          onChange={(e) => toggleAll(e.target.checked)}
        />
        Seleccionar todos
      </label>

      {groups.map((group) => {
        const groupChecked = group.rows.every((r) => selected.has(r.key));
        return (
          <Card key={group.supplier}>
            <div className="flex items-center justify-between border-b border-slate-200 px-4 py-2">
              <h3 className="font-semibold text-slate-800">{group.supplier}</h3>
              <label className="flex items-center gap-2 text-sm text-slate-600 print:hidden">
                <input
                  type="checkbox"
                  checked={groupChecked}
                  onChange={(e) => toggleGroup(group, e.target.checked)}
                />
                Seleccionar proveedor
              </label>
            </div>
            <div className="hidden print:block print:px-4 print:pt-2 print:text-sm print:font-semibold">
              Proveedor: {group.supplier}
            </div>
            <table className="w-full text-sm">
              <thead className="border-b border-slate-200 text-left text-xs uppercase text-slate-400">
                <tr>
                  <th className="w-8 px-4 py-2 print:hidden"></th>
                  <th className="px-4 py-2">Código</th>
                  <th className="px-4 py-2">Marca</th>
                  <th className="px-4 py-2">Aplicación</th>
                  <th className="px-4 py-2">Sucursal</th>
                  <th className="px-4 py-2 text-right">Stock</th>
                  <th className="px-4 py-2">MI</th>
                  <th className="px-4 py-2">ME</th>
                  <th className="px-4 py-2">ALT</th>
                  <th className="px-4 py-2">PEST</th>
                  <th className="px-4 py-2">TOPE</th>
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-200">
                {group.rows.map((row) => {
                  const checked = selected.has(row.key);
                  return (
                    <tr key={row.key} className={checked ? "" : "print:hidden"}>
                      <td className="px-4 py-2 print:hidden">
                        <input
                          type="checkbox"
                          checked={checked}
                          onChange={() => toggle(row.key)}
                        />
                      </td>
                      <td className="px-4 py-2 font-medium text-slate-800">{row.code}</td>
                      <td className="px-4 py-2 text-slate-500">{row.brand ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-500">{row.application ?? "—"}</td>
                      <td className="px-4 py-2 text-slate-500">{row.branch ?? "—"}</td>
                      <td className="px-4 py-2 text-right font-semibold text-red-600">{row.quantity}</td>
                      <td className="px-4 py-2 text-slate-500">{formatMm(row.internalMm)}</td>
                      <td className="px-4 py-2 text-slate-500">{formatMm(row.externalMm)}</td>
                      <td className="px-4 py-2 text-slate-500">{formatMm(row.heightMm)}</td>
                      <td className="px-4 py-2 text-slate-500">{formatMm(row.flangeMm)}</td>
                      <td className="px-4 py-2 text-slate-500">{formatMm(row.stopMm)}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </Card>
        );
      })}
    </div>
  );
}
