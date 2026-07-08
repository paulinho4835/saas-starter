// lib/transferStatus.ts
// Máquina de estados de Traspasos — mirror en TypeScript de
// traspaso_model::estados del legacy. Usado tanto por la UI (label +
// acciones disponibles según type/status/role) como para validar antes de
// llamar al RPC `advance_transfer`, que vuelve a validar en SQL. Ver
// docs/superpowers/specs/2026-07-08-traspasos-workflow-design.md

export type TransferType = "pedido" | "envio";
export type TransferStatus = "en_cola" | "enviando" | "entregado" | "rechazado" | "cancelado";
// origin = quien decide enviar/rechazar (from_branch_id).
// destination = quien creó el traspaso y lo recibirá (to_branch_id).
export type TransferRole = "origin" | "destination";

export type TransferAction = { nextStatus: TransferStatus; label: string };
export type TransferView = { label: string; actions: TransferAction[] };

type ViewsByStatus = Partial<Record<TransferStatus, TransferView>>;
type ViewsByRole = Partial<Record<TransferRole, ViewsByStatus>>;

const VIEWS: Record<TransferType, ViewsByRole> = {
  pedido: {
    destination: {
      en_cola: { label: "En Cola", actions: [{ nextStatus: "cancelado", label: "Cancelar" }] },
      enviando: { label: "En Camino", actions: [{ nextStatus: "entregado", label: "Recepcionar" }] },
    },
    origin: {
      en_cola: {
        label: "En Cola",
        actions: [
          { nextStatus: "enviando", label: "Enviar" },
          { nextStatus: "rechazado", label: "Rechazar" },
        ],
      },
      enviando: { label: "Enviando", actions: [] },
    },
  },
  envio: {
    origin: {
      enviando: { label: "Enviando", actions: [] },
    },
    destination: {
      enviando: { label: "En Camino", actions: [{ nextStatus: "entregado", label: "Recepcionar" }] },
    },
  },
};

export function getTransferView(
  type: TransferType,
  status: TransferStatus,
  role: TransferRole,
): TransferView {
  return VIEWS[type]?.[role]?.[status] ?? { label: status, actions: [] };
}

export function isTerminalStatus(status: TransferStatus): boolean {
  return status === "entregado" || status === "rechazado" || status === "cancelado";
}
