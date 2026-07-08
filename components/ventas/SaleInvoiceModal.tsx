"use client";

import { useEffect, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";

// Replica modal_formulario_cliente.blade.php del legacy: cuando la venta
// incluye líneas "con factura" (CF), no se vende directo — se pide NIT y
// nombre del cliente en este modal antes de confirmar. La fecha es de solo
// lectura (informativa, como en el legacy) y el monto es el total SOLO de
// las líneas CF (no el total de la venta completa).
function formatFecha(date: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()} ${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}`;
}

export function SaleInvoiceModal({
  open,
  onClose,
  montoCf,
  loading,
  onConfirm,
}: {
  open: boolean;
  onClose: () => void;
  montoCf: number;
  loading: boolean;
  onConfirm: (customerName: string, customerNit: string) => void;
}) {
  const [fecha, setFecha] = useState("");
  const [nombreCliente, setNombreCliente] = useState("");
  const [nitCliente, setNitCliente] = useState("");

  // La fecha se fija al momento de abrir el modal, igual que
  // Carbon::now()->format('d/m/Y H:i:s') en el render del legacy.
  useEffect(() => {
    if (open) {
      setFecha(formatFecha(new Date()));
      setNombreCliente("");
      setNitCliente("");
    }
  }, [open]);

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (!nitCliente.trim() || !nombreCliente.trim()) return;
    onConfirm(nombreCliente.trim(), nitCliente.trim());
  }

  return (
    <Modal open={open} onClose={onClose} title="Datos de Venta con Factura">
      <form onSubmit={handleSubmit} className="space-y-3">
        <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 text-sm">
          <span className="font-medium text-slate-700">Fecha</span>
          <input type="text" readOnly value={fecha} className={`${fieldInputClass} bg-slate-50 text-slate-500`} />
        </label>
        <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 text-sm">
          <span className="font-medium text-slate-700">NIT del cliente</span>
          <input
            type="text"
            required
            placeholder="nit"
            autoComplete="off"
            value={nitCliente}
            onChange={(e) => setNitCliente(e.target.value)}
            className={fieldInputClass}
          />
        </label>
        <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 text-sm">
          <span className="font-medium text-slate-700">Nombre Cliente</span>
          <input
            type="text"
            required
            placeholder="Nombre"
            autoComplete="off"
            value={nombreCliente}
            onChange={(e) => setNombreCliente(e.target.value)}
            className={fieldInputClass}
          />
        </label>
        <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 text-sm">
          <span className="font-medium text-slate-700">Monto Total venta Con factura</span>
          <input type="text" readOnly value={montoCf} className={`${fieldInputClass} bg-slate-50 text-slate-500`} />
        </label>

        <div className="flex justify-end gap-2 pt-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={loading}>
            Cancelar
          </Button>
          <Button type="submit" disabled={loading}>
            {loading ? "Confirmando…" : "Efectuar venta"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
