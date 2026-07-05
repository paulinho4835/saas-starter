"use client";

import * as XLSX from "xlsx";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";

// Exporta la página actual de movimientos ya filtrada (no todo el historial):
// el usuario primero filtra por código/fecha/sucursal y después exporta lo
// que está viendo, igual que el botón "Exportar Excel" del sistema anterior.
export function ExportMovimientosButton({ rows }: { rows: Record<string, string | number>[] }) {
  function onExport() {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, "Movimientos");
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `movimientos-producto-${today}.xlsx`);
  }

  return (
    <Button type="button" variant="secondary" onClick={onExport}>
      <Download className="h-4 w-4" /> Exportar Excel
    </Button>
  );
}
