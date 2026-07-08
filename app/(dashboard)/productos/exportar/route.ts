import * as XLSX from "xlsx";
import { NextResponse } from "next/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";

// Exporta el catálogo completo de productos activos a Excel — equivalente a
// los botones "Catálogo Pt1/Pt2" del legacy, sin partir en bloques de 7500
// filas (esa limitación era de Laravel-Excel/memoria del legacy y no aplica
// aquí). Un Route Handler porque el navegador necesita descargar un archivo
// binario directamente, no un valor de React (mismo patrón que
// app/(dashboard)/ajustes/exportar/route.ts).
const PAGE_SIZE = 1000;
const EXPORT_SELECT =
  "id, code, internal_mm, external_mm, height_mm, flange_mm, stop_mm, application, cost_usd, price_cf_bs, price_sf_bs, price_may_bs, product_brands(name), product_families(name), product_origins(name)";

type ExportRow = {
  id: string;
  code: string;
  internal_mm: number | null;
  external_mm: number | null;
  height_mm: number | null;
  flange_mm: number | null;
  stop_mm: number | null;
  application: string | null;
  cost_usd: number | null;
  price_cf_bs: number;
  price_sf_bs: number;
  price_may_bs: number;
  product_brands: { name: string } | null;
  product_families: { name: string } | null;
  product_origins: { name: string } | null;
};

export async function GET() {
  const profile = await getProfile();
  if (!profile || !can(profile.role, "productos:read")) {
    return NextResponse.json({ error: "No autorizado." }, { status: 403 });
  }

  const supabase = await createClient();

  const { data: stockData } = await supabase.from("product_stock").select("product_id, quantity");
  const stockByProduct = new Map<string, number>();
  for (const row of stockData ?? []) {
    const productId = row.product_id as string;
    stockByProduct.set(productId, (stockByProduct.get(productId) ?? 0) + (row.quantity as number));
  }

  const rows: ExportRow[] = [];
  let from = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("products")
      .select(EXPORT_SELECT)
      .eq("active", true)
      .order("code")
      .range(from, from + PAGE_SIZE - 1);
    if (error) return NextResponse.json({ error: error.message }, { status: 500 });
    rows.push(...((data ?? []) as unknown as ExportRow[]));
    if (!data || data.length < PAGE_SIZE) break;
    from += PAGE_SIZE;
  }

  const sheetRows = rows.map((r) => ({
    FAMILIA: r.product_families?.name ?? "",
    CODIGO_PRODUCTO: r.code,
    MARCA: r.product_brands?.name ?? "",
    STOCK: stockByProduct.get(r.id) ?? 0,
    "COSTO $": r.cost_usd ?? 0,
    "CF Bs": r.price_cf_bs,
    "SF Bs": r.price_sf_bs,
    "MAY Bs": r.price_may_bs,
    MI: r.internal_mm ?? "",
    ME: r.external_mm ?? "",
    ALT: r.height_mm ?? "",
    PEST: r.flange_mm ?? "",
    TOPE: r.stop_mm ?? "",
    APLICACION: r.application ?? "",
    PROCEDENCIA: r.product_origins?.name ?? "",
  }));

  const worksheet =
    sheetRows.length > 0
      ? XLSX.utils.json_to_sheet(sheetRows)
      : XLSX.utils.aoa_to_sheet([["(sin productos)"]]);
  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, worksheet, "Productos");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  const today = new Date().toISOString().slice(0, 10);

  return new NextResponse(new Uint8Array(buffer), {
    headers: {
      "Content-Type": "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="catalogo-productos-${today}.xlsx"`,
    },
  });
}
