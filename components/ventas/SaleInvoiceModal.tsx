"use client";

import { useEffect, useRef, useState } from "react";
import { Modal } from "@/components/ui/Modal";
import { Button } from "@/components/ui/Button";
import { fieldInputClass } from "@/components/ui/Field";
import {
  lookupCustomerByNit,
  lookupCustomerByName,
  searchCustomersByNit,
  type CustomerNitSuggestion,
} from "@/app/(dashboard)/ventas/actions";

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
  const [suggestions, setSuggestions] = useState<CustomerNitSuggestion[]>([]);
  const [showSuggestions, setShowSuggestions] = useState(false);
  const nitLookupTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const nameLookupTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  const suggestLookupTimeout = useRef<ReturnType<typeof setTimeout> | null>(null);
  // Qué campo escribió el vendedor por última vez, para saber cuál de los
  // dos autocompletados debe correr (si dejamos que ambos corran siempre,
  // el autocompletado de uno dispara al otro y viceversa, ping-pong infinito).
  const lastEdited = useRef<"nit" | "name" | null>(null);

  // La fecha se fija al momento de abrir el modal, igual que
  // Carbon::now()->format('d/m/Y H:i:s') en el render del legacy.
  useEffect(() => {
    if (open) {
      setFecha(formatFecha(new Date()));
      setNombreCliente("");
      setNitCliente("");
      setSuggestions([]);
      setShowSuggestions(false);
      lastEdited.current = null;
    }
  }, [open]);

  // Si el NIT ya tiene un cliente registrado (de una venta anterior),
  // autocompleta el nombre — igual que el legacy, que reconocía al cliente
  // por NIT. Debounced para no disparar una consulta por cada tecla.
  useEffect(() => {
    if (nitLookupTimeout.current) clearTimeout(nitLookupTimeout.current);
    if (lastEdited.current !== "nit") return;
    const nit = nitCliente.trim();
    if (!nit) return;
    nitLookupTimeout.current = setTimeout(async () => {
      const res = await lookupCustomerByNit(nit);
      if (res.ok && res.fullName) setNombreCliente(res.fullName);
    }, 400);
    return () => {
      if (nitLookupTimeout.current) clearTimeout(nitLookupTimeout.current);
    };
  }, [nitCliente]);

  // Lista de clientes cuyo NIT empieza con lo tecleado, para elegir de un
  // dropdown en vez de escribir el NIT completo (igual que el legacy).
  useEffect(() => {
    if (suggestLookupTimeout.current) clearTimeout(suggestLookupTimeout.current);
    if (lastEdited.current !== "nit") return;
    const nit = nitCliente.trim();
    if (!nit) {
      setSuggestions([]);
      setShowSuggestions(false);
      return;
    }
    suggestLookupTimeout.current = setTimeout(async () => {
      const res = await searchCustomersByNit(nit);
      if (res.ok) {
        setSuggestions(res.results);
        setShowSuggestions(res.results.length > 0);
      }
    }, 300);
    return () => {
      if (suggestLookupTimeout.current) clearTimeout(suggestLookupTimeout.current);
    };
  }, [nitCliente]);

  function selectSuggestion(s: CustomerNitSuggestion) {
    lastEdited.current = null;
    setNitCliente(s.nit);
    setNombreCliente(s.fullName);
    setSuggestions([]);
    setShowSuggestions(false);
  }

  // Inverso: si escribe un nombre ya registrado, autocompleta el NIT.
  useEffect(() => {
    if (nameLookupTimeout.current) clearTimeout(nameLookupTimeout.current);
    if (lastEdited.current !== "name") return;
    const name = nombreCliente.trim();
    if (!name) return;
    nameLookupTimeout.current = setTimeout(async () => {
      const res = await lookupCustomerByName(name);
      if (res.ok && res.nit) setNitCliente(res.nit);
    }, 400);
    return () => {
      if (nameLookupTimeout.current) clearTimeout(nameLookupTimeout.current);
    };
  }, [nombreCliente]);

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
          <div className="relative">
            <input
              type="text"
              required
              placeholder="nit"
              autoComplete="off"
              value={nitCliente}
              onChange={(e) => {
                lastEdited.current = "nit";
                setNitCliente(e.target.value);
              }}
              onFocus={() => setShowSuggestions(suggestions.length > 0)}
              onBlur={() => setTimeout(() => setShowSuggestions(false), 150)}
              className={fieldInputClass}
            />
            {showSuggestions && (
              <ul className="absolute z-10 mt-1 max-h-40 w-full overflow-y-auto rounded-md border border-slate-200 bg-white text-sm shadow-lg">
                {suggestions.map((s) => (
                  <li key={s.nit}>
                    <button
                      type="button"
                      onMouseDown={(e) => e.preventDefault()}
                      onClick={() => selectSuggestion(s)}
                      className="block w-full px-3 py-1.5 text-left hover:bg-slate-100"
                    >
                      <span className="font-medium text-slate-700">{s.nit}</span>{" "}
                      <span className="text-slate-500">{s.fullName}</span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        </label>
        <label className="grid grid-cols-[minmax(0,1fr)_minmax(0,1.4fr)] items-center gap-3 text-sm">
          <span className="font-medium text-slate-700">Nombre Cliente</span>
          <input
            type="text"
            required
            placeholder="Nombre"
            autoComplete="off"
            value={nombreCliente}
            onChange={(e) => {
              lastEdited.current = "name";
              setNombreCliente(e.target.value);
            }}
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
