"use client";

import { Card } from "@/components/ui/Card";
import { Button } from "@/components/ui/Button";
import type { TransferCartLine } from "@/lib/transferCart";

function CartTable({
  title,
  cart,
  quantityLabel,
  onRemove,
  onSubmit,
  loading,
  submitLabel,
}: {
  title: string;
  cart: TransferCartLine[];
  quantityLabel: string;
  onRemove: (productId: string, branchId: string) => void;
  onSubmit: () => void;
  loading: boolean;
  submitLabel: string;
}) {
  return (
    <Card className="space-y-3 p-4">
      <h3 className="text-lg text-slate-800">{title}</h3>
      <table className="w-full text-sm">
        <thead>
          <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-400">
            <th className="px-3 py-2">Código</th>
            <th className="px-3 py-2">{quantityLabel}</th>
            <th className="px-3 py-2">Sucursal</th>
            <th className="px-3 py-2"></th>
          </tr>
        </thead>
        <tbody>
          {cart.map((line) => (
            <tr key={`${line.productId}-${line.branchId}`} className="border-b border-slate-100">
              <td className="px-3 py-2 font-medium text-slate-800">{line.code}</td>
              <td className="px-3 py-2 text-slate-600">{line.quantity}</td>
              <td className="px-3 py-2 text-slate-600">{line.branchName}</td>
              <td className="px-3 py-2 text-right">
                {/* .btn-danger del legacy: rojo Bootstrap sólido. */}
                <button
                  type="button"
                  onClick={() => onRemove(line.productId, line.branchId)}
                  className="rounded bg-[#d9534f] px-2 py-1 text-xs font-medium text-white hover:bg-[#c9302c]"
                >
                  Borrar
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {cart.length > 0 && (
        <Button disabled={loading} onClick={onSubmit}>
          {loading ? "Enviando…" : submitLabel}
        </Button>
      )}
    </Card>
  );
}

export function TransferCartPanel({
  pedidoCart,
  envioCart,
  onRemovePedido,
  onRemoveEnvio,
  onSubmitPedido,
  onSubmitEnvio,
  loadingPedido,
  loadingEnvio,
}: {
  pedidoCart: TransferCartLine[];
  envioCart: TransferCartLine[];
  onRemovePedido: (productId: string, branchId: string) => void;
  onRemoveEnvio: (productId: string, branchId: string) => void;
  onSubmitPedido: () => void;
  onSubmitEnvio: () => void;
  loadingPedido: boolean;
  loadingEnvio: boolean;
}) {
  return (
    <div className="grid gap-6 md:grid-cols-2">
      <CartTable
        title="Productos para Pedir"
        cart={pedidoCart}
        quantityLabel="Cantidad a Pedir"
        onRemove={onRemovePedido}
        onSubmit={onSubmitPedido}
        loading={loadingPedido}
        submitLabel="Pedir Productos"
      />
      <CartTable
        title="Productos para Enviar"
        cart={envioCart}
        quantityLabel="Cantidad a Enviar"
        onRemove={onRemoveEnvio}
        onSubmit={onSubmitEnvio}
        loading={loadingEnvio}
        submitLabel="Enviar Productos"
      />
    </div>
  );
}
