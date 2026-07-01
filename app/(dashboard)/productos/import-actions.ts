"use server";

import * as XLSX from "xlsx";
import { revalidatePath } from "next/cache";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { createClient } from "@/lib/supabase/server";
import { verifyBranchInOrg } from "@/lib/catalogs";
import { parseImportRows, type ParsedImportRow } from "@/lib/productImport";

export type ImportRowPreview = ParsedImportRow & {
  status: "create" | "update" | "error";
};

export type ImportPreviewResult =
  | {
      ok: true;
      rows: ImportRowPreview[];
      toCreate: number;
      toUpdate: number;
      withErrors: number;
    }
  | { ok: false; error: string };

async function fileToMatrix(file: File): Promise<unknown[][]> {
  const buffer = await file.arrayBuffer();
  const workbook = XLSX.read(buffer, { type: "array" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  return XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: null,
  }) as unknown[][];
}

// Archivos de inventario reales pueden traer miles de filas. Un solo upsert
// con todo el batch puede exceder límites de tiempo/tamaño del proxy local
// de Supabase (Kong) o del cliente fetch, fallando con "fetch failed" en vez
// de un error de datos. Partir en lotes evita ese límite.
const IMPORT_BATCH_SIZE = 500;

function chunk<T>(items: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < items.length; i += size) {
    chunks.push(items.slice(i, i + size));
  }
  return chunks;
}

type ClassifyResult =
  | { ok: true; rows: ImportRowPreview[] }
  | { ok: false; error: string };

// Lee el archivo subido, lo parsea con parseImportRows y clasifica cada fila
// válida como "create" o "update" comparando contra los productos existentes
// en la org. Usado tanto por previewProductImport (solo para mostrar en UI)
// como por confirmProductImport (fuente de verdad para lo que se escribe en
// la DB) — así ambos flujos ven siempre la misma clasificación server-side.
async function readAndClassifyFile(
  supabase: Awaited<ReturnType<typeof createClient>>,
  file: File,
): Promise<ClassifyResult> {
  let matrix: unknown[][];
  try {
    matrix = await fileToMatrix(file);
  } catch {
    return { ok: false, error: "No se pudo leer el archivo. Verifica el formato." };
  }

  const { rows, headerRowIndex } = parseImportRows(matrix);
  if (headerRowIndex === null) {
    return {
      ok: false,
      error:
        "No se encontraron las columnas esperadas (FAMILIA, CODIGO_PRODUCTO, MARCA).",
    };
  }
  if (rows.length === 0) {
    return { ok: false, error: "El archivo no tiene filas de datos." };
  }

  const codes = [...new Set(rows.filter((r) => !r.error).map((r) => r.code))];

  const { data: existingProducts } =
    codes.length > 0
      ? await supabase
          .from("products")
          .select("code, product_brands(name)")
          .in("code", codes)
      : { data: [] as { code: string; product_brands: { name: string } | null }[] };

  const existingKeys = new Set(
    (existingProducts ?? []).map((p) => {
      const brand = Array.isArray(p.product_brands)
        ? p.product_brands[0]
        : p.product_brands;
      return `${p.code}::${brand?.name?.toLowerCase() ?? ""}`;
    }),
  );

  const preview: ImportRowPreview[] = rows.map((row) => {
    if (row.error) return { ...row, status: "error" };
    const key = `${row.code}::${row.brand.toLowerCase()}`;
    return { ...row, status: existingKeys.has(key) ? "update" : "create" };
  });

  return { ok: true, rows: preview };
}

export async function previewProductImport(
  formData: FormData,
): Promise<ImportPreviewResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:import")) {
    return { ok: false, error: "No tienes permiso para importar productos." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Selecciona un archivo." };
  }

  const supabase = await createClient();
  const classified = await readAndClassifyFile(supabase, file);
  if (!classified.ok) return classified;

  const preview = classified.rows;
  return {
    ok: true,
    rows: preview,
    toCreate: preview.filter((r) => r.status === "create").length,
    toUpdate: preview.filter((r) => r.status === "update").length,
    withErrors: preview.filter((r) => r.status === "error").length,
  };
}

export type ConfirmImportResult =
  | { ok: true; imported: number }
  | { ok: false; error: string };

export async function confirmProductImport(
  formData: FormData,
): Promise<ConfirmImportResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:import")) {
    return { ok: false, error: "No tienes permiso para importar productos." };
  }

  const branchId = formData.get("branchId");
  if (typeof branchId !== "string" || !branchId) {
    return { ok: false, error: "Selecciona una sucursal." };
  }

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    return { ok: false, error: "Selecciona un archivo." };
  }

  const supabase = await createClient();
  const orgId = profile.orgId;

  const branchValid = await verifyBranchInOrg(supabase, branchId, orgId);
  if (!branchValid) {
    return { ok: false, error: "La sucursal seleccionada no es válida." };
  }

  // Re-parsear y re-clasificar el archivo server-side: nunca confiar en filas
  // que el cliente pudiera haber alterado (ej. cambiar status "error" a
  // "create", o inventar code/brand/family/precios/stock).
  const classified = await readAndClassifyFile(supabase, file);
  if (!classified.ok) return classified;

  const validRows = classified.rows.filter((r) => r.status !== "error");
  if (validRows.length === 0) {
    return { ok: false, error: "No hay filas válidas para importar." };
  }

  // 1) Autocrear marcas y familias que falten.
  const familyNames = [...new Set(validRows.map((r) => r.family))];
  const brandNames = [...new Set(validRows.map((r) => r.brand))];

  const [{ data: existingFamilies }, { data: existingBrands }] = await Promise.all([
    supabase.from("product_families").select("id, name").eq("org_id", orgId),
    supabase.from("product_brands").select("id, name").eq("org_id", orgId),
  ]);

  const familyIdByName = new Map(
    (existingFamilies ?? []).map((f) => [f.name.toLowerCase(), f.id]),
  );
  const brandIdByName = new Map(
    (existingBrands ?? []).map((b) => [b.name.toLowerCase(), b.id]),
  );

  const missingFamilies = familyNames.filter((n) => !familyIdByName.has(n.toLowerCase()));
  if (missingFamilies.length > 0) {
    const { data: inserted, error } = await supabase
      .from("product_families")
      .insert(missingFamilies.map((name) => ({ org_id: orgId, name })))
      .select("id, name");
    if (error) {
      console.error("confirmProductImport familias:", error.message);
      return { ok: false, error: "No se pudieron crear las familias nuevas." };
    }
    for (const f of inserted ?? []) familyIdByName.set(f.name.toLowerCase(), f.id);
  }

  const missingBrands = brandNames.filter((n) => !brandIdByName.has(n.toLowerCase()));
  if (missingBrands.length > 0) {
    const { data: inserted, error } = await supabase
      .from("product_brands")
      .insert(missingBrands.map((name) => ({ org_id: orgId, name })))
      .select("id, name");
    if (error) {
      console.error("confirmProductImport marcas:", error.message);
      return { ok: false, error: "No se pudieron crear las marcas nuevas." };
    }
    for (const b of inserted ?? []) brandIdByName.set(b.name.toLowerCase(), b.id);
  }

  // 2) Upsert de productos por (org_id, code, brand_id).
  // Un mismo archivo puede traer la misma combinación código+marca repetida
  // (errores de captura acumulados en inventarios viejos). Postgres rechaza un
  // upsert cuyo statement afecte la misma fila de conflicto dos veces, así que
  // deduplicamos por esa llave quedándonos con la última fila del archivo (la
  // entrada más reciente gana sobre una anterior con el mismo código).
  const rowByCodeBrand = new Map<string, ParsedImportRow>();
  for (const r of validRows) {
    rowByCodeBrand.set(`${r.code}::${brandIdByName.get(r.brand.toLowerCase())}`, r);
  }
  const dedupedRows = [...rowByCodeBrand.values()];

  const productsPayload = dedupedRows.map((r) => ({
    org_id: orgId,
    code: r.code,
    brand_id: brandIdByName.get(r.brand.toLowerCase())!,
    family_id: familyIdByName.get(r.family.toLowerCase())!,
    internal_mm: r.internalMm,
    external_mm: r.externalMm,
    height_mm: r.heightMm,
    flange_mm: r.flangeMm,
    stop_mm: r.stopMm,
    application: r.application,
    price_cf_bs: r.priceCfBs ?? 0,
    price_sf_bs: r.priceSfBs ?? 0,
    price_may_bs: r.priceMayBs ?? 0,
    updated_at: new Date().toISOString(),
  }));

  // Archivos de miles de filas revientan el proxy local (Kong) o el fetch si se
  // mandan en un solo upsert — supabase-js lanza en vez de devolver error, y el
  // import queda colgado. Partir en lotes evita ese límite.
  const upsertedProducts: { id: string; code: string; brand_id: string }[] = [];
  for (const productBatch of chunk(productsPayload, IMPORT_BATCH_SIZE)) {
    const { data, error } = await supabase
      .from("products")
      .upsert(productBatch, { onConflict: "org_id,code,brand_id" })
      .select("id, code, brand_id");
    if (error) {
      console.error("confirmProductImport productos:", error.message);
      return { ok: false, error: "No se pudieron guardar los productos." };
    }
    upsertedProducts.push(...(data ?? []));
  }

  // 3) Upsert de stock para la sucursal elegida (reemplaza la cantidad existente).
  // Usa la misma fila ganadora del paso 2 (por code+brand_id) para que el stock
  // salga de la misma entrada que definió los precios del producto.
  const stockPayload = upsertedProducts.map((p) => {
    const row = rowByCodeBrand.get(`${p.code}::${p.brand_id}`)!;
    return {
      org_id: orgId,
      product_id: p.id,
      branch_id: branchId,
      quantity: row.stock,
      updated_at: new Date().toISOString(),
    };
  });

  // Cantidades previas por producto, para calcular el delta de cada movimiento
  // de stock. Un producto sin fila de stock previa en esta sucursal parte de 0.
  const previousQuantityByProduct = new Map<string, number>();
  for (const batch of chunk((upsertedProducts ?? []).map((p) => p.id), IMPORT_BATCH_SIZE)) {
    const { data: existingStockRows } = await supabase
      .from("product_stock")
      .select("product_id, quantity")
      .eq("branch_id", branchId)
      .in("product_id", batch);
    for (const row of existingStockRows ?? []) {
      previousQuantityByProduct.set(row.product_id as string, row.quantity as number);
    }
  }

  for (const batch of chunk(stockPayload, IMPORT_BATCH_SIZE)) {
    const { error } = await supabase
      .from("product_stock")
      .upsert(batch, { onConflict: "product_id,branch_id" });
    if (error) {
      console.error("confirmProductImport stock:", error.message);
      return {
        ok: false,
        error: "Los productos se guardaron, pero no se pudo actualizar el stock.",
      };
    }

    // Historial de movimientos: no bloquea el import si falla. Los datos de
    // stock ya quedaron guardados arriba; revertir miles de filas de producto
    // por un fallo en el log de auditoría sería peor que perder ese registro,
    // así que solo se deja constancia en el log del servidor.
    const movementsPayload = batch
      .filter((s) => s.quantity !== (previousQuantityByProduct.get(s.product_id) ?? 0))
      .map((s) => ({
        org_id: orgId,
        product_id: s.product_id,
        branch_id: s.branch_id,
        movement_type: "importacion" as const,
        quantity_delta: s.quantity - (previousQuantityByProduct.get(s.product_id) ?? 0),
        resulting_quantity: s.quantity,
        reason: null,
        actor_id: profile.userId,
        sale_id: null,
      }));
    if (movementsPayload.length > 0) {
      const { error: movementError } = await supabase
        .from("stock_movements")
        .insert(movementsPayload);
      if (movementError) {
        console.error("confirmProductImport movements:", movementError.message);
      }
    }
  }

  revalidatePath("/productos");
  return { ok: true, imported: stockPayload.length };
}
