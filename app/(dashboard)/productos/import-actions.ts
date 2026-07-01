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
  const productsPayload = validRows.map((r) => ({
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

  const { data: upsertedProducts, error: productsError } = await supabase
    .from("products")
    .upsert(productsPayload, { onConflict: "org_id,code,brand_id" })
    .select("id, code, brand_id");
  if (productsError) {
    console.error("confirmProductImport productos:", productsError.message);
    return { ok: false, error: "No se pudieron guardar los productos." };
  }

  // 3) Upsert de stock para la sucursal elegida (reemplaza la cantidad existente).
  const stockPayload = (upsertedProducts ?? []).map((p) => {
    const row = validRows.find(
      (r) =>
        r.code === p.code && brandIdByName.get(r.brand.toLowerCase()) === p.brand_id,
    )!;
    return {
      org_id: orgId,
      product_id: p.id,
      branch_id: branchId,
      quantity: row.stock,
      updated_at: new Date().toISOString(),
    };
  });

  const { error: stockError } = await supabase
    .from("product_stock")
    .upsert(stockPayload, { onConflict: "product_id,branch_id" });
  if (stockError) {
    console.error("confirmProductImport stock:", stockError.message);
    return {
      ok: false,
      error: "Los productos se guardaron, pero no se pudo actualizar el stock.",
    };
  }

  revalidatePath("/productos");
  return { ok: true, imported: stockPayload.length };
}
