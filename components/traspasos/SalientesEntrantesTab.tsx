import { ArrowLeftRight } from "lucide-react";
import { EmptyState } from "@/components/ui/EmptyState";
import { TransferStatusCard, type TransferCardData } from "@/components/traspasos/TransferStatusCard";

export function SalientesEntrantesTab({
  pedidoTitle,
  envioTitle,
  pedidos,
  envios,
  canManage,
}: {
  pedidoTitle: string;
  envioTitle: string;
  pedidos: TransferCardData[];
  envios: TransferCardData[];
  canManage: boolean;
}) {
  if (pedidos.length === 0 && envios.length === 0) {
    return (
      <EmptyState
        icon={<ArrowLeftRight className="h-6 w-6" />}
        title="Sin traspasos pendientes"
        description="No hay traspasos activos en esta sección."
      />
    );
  }

  return (
    <div className="space-y-6">
      {pedidos.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-800">{pedidoTitle}</h3>
          {pedidos.map((t) => (
            <TransferStatusCard key={t.id} transfer={t} canManage={canManage} />
          ))}
        </div>
      )}
      {envios.length > 0 && (
        <div className="space-y-3">
          <h3 className="text-lg font-semibold text-slate-800">{envioTitle}</h3>
          {envios.map((t) => (
            <TransferStatusCard key={t.id} transfer={t} canManage={canManage} />
          ))}
        </div>
      )}
    </div>
  );
}
