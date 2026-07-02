import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { createClient } from "@/lib/supabase/server";
import type { SupabaseClient } from "@supabase/supabase-js";

// Respaldo completo de la organización: un Excel con una hoja por tabla de
// negocio, para poder migrar todo el sistema a otra instancia. Solo admin
// (ver docs/superpowers/specs/2026-07-02-exportar-datos-design.md). Un Route
// Handler (no una server action) porque el navegador necesita descargar un
// archivo binario directamente, no un valor de React.
const PAGE_SIZE = 1000;

// Supabase corta cada request a 1000 filas por defecto; para tablas grandes
// (ventas, movimientos) hay que paginar hasta agotar los resultados.
async function fetchAllRows(supabase: SupabaseClient, table: string): Promise<Record<string, unknown>[]> {
  const rows: Record<string, unknown>[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from(table)
      .select("*")
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`${table}: ${error.message}`);
    rows.push(...(data ?? []));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }
  return rows;
}

const TABLES: { table: string; sheet: string }[] = [
  { table: "branches", sheet: "Sucursales" },
  { table: "product_brands", sheet: "Marcas" },
  { table: "product_families", sheet: "Familias" },
  { table: "product_origins", sheet: "Procedencias" },
  { table: "suppliers", sheet: "Proveedores" },
  { table: "products", sheet: "Productos" },
  { table: "product_stock", sheet: "Stock" },
  { table: "items", sheet: "Inventario" },
  { table: "customers", sheet: "Clientes" },
  { table: "sales", sheet: "Ventas" },
  { table: "sale_items", sheet: "Detalle Ventas" },
  { table: "sale_returns", sheet: "Devoluciones" },
  { table: "stock_movements", sheet: "Movimientos" },
  { table: "audit_log", sheet: "Auditoria" },
];

export async function GET() {
  const profile = await getProfile();
  if (!profile || profile.role !== "admin") {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const supabase = await createClient();
  const workbook = XLSX.utils.book_new();

  for (const { table, sheet } of TABLES) {
    const rows = await fetchAllRows(supabase, table);
    const worksheet =
      rows.length > 0 ? XLSX.utils.json_to_sheet(rows) : XLSX.utils.aoa_to_sheet([["(sin datos)"]]);
    XLSX.utils.book_append_sheet(workbook, worksheet, sheet);
  }

  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="respaldo-${today}.xlsx"`,
    },
  });
}
