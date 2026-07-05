"use client";

import * as XLSX from "xlsx";
import { Download } from "lucide-react";
import { Button } from "@/components/ui/Button";

// Exporta filas ya armadas (típicamente la página/filtro actual, no todo el
// historial) a un .xlsx descargado directo en el navegador.
export function ExportExcelButton({
  rows,
  filenamePrefix,
  sheetName = "Datos",
  label = "Exportar Excel",
}: {
  rows: Record<string, string | number>[];
  filenamePrefix: string;
  sheetName?: string;
  label?: string;
}) {
  function onExport() {
    const worksheet = XLSX.utils.json_to_sheet(rows);
    const workbook = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(workbook, worksheet, sheetName);
    const today = new Date().toISOString().slice(0, 10);
    XLSX.writeFile(workbook, `${filenamePrefix}-${today}.xlsx`);
  }

  return (
    <Button type="button" variant="secondary" onClick={onExport}>
      <Download className="h-4 w-4" /> {label}
    </Button>
  );
}
