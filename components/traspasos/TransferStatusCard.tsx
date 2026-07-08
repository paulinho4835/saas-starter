"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import { toast } from "@/lib/toast";
import { getTransferView, type TransferRole, type TransferStatus, type TransferType } from "@/lib/transferStatus";
import { advanceTransferStatus } from "@/app/(dashboard)/traspasos/actions";

export type TransferCardItem = {
  productId: string;
  code: string;
  application: string | null;
  quantityRequested: number;
  quantitySent: number | null;
  currentStock: number | null;
};

export type TransferCardData = {
  id: string;
  createdAt: string;
  counterBranchName: string;
  status: TransferStatus;
  role: TransferRole;
  type: TransferType;
  items: TransferCardItem[];
};

const DATE_FORMATTER = new Intl.DateTimeFormat("es-BO", {
  day: "2-digit",
  month: "2-digit",
  year: "numeric",
  hour: "2-digit",
  minute: "2-digit",
});

const READONLY_FIELD_CLASS =
  "w-full rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600";

export function TransferStatusCard({
  transfer,
  canManage,
}: {
  transfer: TransferCardData;
  canManage: boolean;
}) {
  const [loading, setLoading] = useState(false);
  const router = useRouter();
  const view = getTransferView(transfer.type, transfer.status, transfer.role);
  // "Cant. enviada" solo tiene sentido una vez que el pedido salió de 'en
  // cola' (o siempre en un Envío, que nace con cantidad_enviada = solicitada).
  const showSentColumn = transfer.type === "envio" || transfer.status !== "en_cola";
  // "Stock actual" solo aplica al fulfiller de un Pedido (rol origin) —
  // igual que la columna del legacy en vista_entrantes.blade.php.
  const showStockColumn = transfer.type === "pedido" && transfer.role === "origin";

  async function handleAction(nextStatus: string) {
    setLoading(true);
    const formData = new FormData();
    formData.set("transferId", transfer.id);
    formData.set("nextStatus", nextStatus);
    const res = await advanceTransferStatus(formData);
    setLoading(false);
    if (!res.ok) {
      toast(res.error, "error");
      return;
    }
    toast("Se actualizó el estado");
    router.refresh();
  }

  return (
    <Card className="grid gap-4 p-4 md:grid-cols-[1fr_2fr]">
      <div className="space-y-3">
        <p className="text-sm font-semibold text-slate-500"># {transfer.id.slice(0, 8)}</p>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Fecha</span>
          <input type="text" readOnly value={DATE_FORMATTER.format(new Date(transfer.createdAt))} className={READONLY_FIELD_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Sucursal</span>
          <input type="text" readOnly value={transfer.counterBranchName} className={READONLY_FIELD_CLASS} />
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-slate-600">Estado</span>
          <input type="text" readOnly value={view.label} className={READONLY_FIELD_CLASS} />
        </label>
        {canManage && view.actions.length > 0 && (
          <div className="flex flex-wrap gap-2">
            {view.actions.map((action) => (
              <Button
                key={action.nextStatus}
                size="sm"
                variant="danger"
                disabled={loading}
                onClick={() => handleAction(action.nextStatus)}
              >
                {action.label}
              </Button>
            ))}
          </div>
        )}
      </div>

      <div className="overflow-x-auto">
        <table className="w-full text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
              <th className="px-3 py-2">Código</th>
              <th className="px-3 py-2">Aplicación</th>
              <th className="px-3 py-2">Cant. solicitada</th>
              {showSentColumn && <th className="px-3 py-2">Cant. enviada</th>}
              {showStockColumn && <th className="px-3 py-2">Stock actual</th>}
            </tr>
          </thead>
          <tbody>
            {transfer.items.map((item) => (
              <tr key={item.productId} className="border-b border-slate-100">
                <td className="px-3 py-2 font-medium text-slate-800">{item.code}</td>
                <td className="px-3 py-2 text-slate-500">{item.application ?? "—"}</td>
                <td className="px-3 py-2 text-slate-600">{item.quantityRequested}</td>
                {showSentColumn && <td className="px-3 py-2 text-slate-600">{item.quantitySent ?? "—"}</td>}
                {showStockColumn && <td className="px-3 py-2 text-slate-600">{item.currentStock ?? "—"}</td>}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Card>
  );
}
