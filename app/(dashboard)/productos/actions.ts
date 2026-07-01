"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { calculatePrices } from "@/lib/pricing";
import {
  insertCatalogEntry,
  deleteCatalogEntry,
  catalogNameSchema,
} from "@/lib/catalogs";

export type ActionResult = { ok: boolean; error?: string };

// ── Catálogos (marcas, familias, procedencias) ──────────────────────────────
async function requireCatalogWrite(): Promise<
  { ok: true; orgId: string } | { ok: false; error: string }
> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "catalogos:write")) {
    return { ok: false, error: "No tienes permiso para editar catálogos." };
  }
  return { ok: true, orgId: profile.orgId };
}

export async function createBrand(formData: FormData): Promise<ActionResult> {
  const guard = await requireCatalogWrite();
  if (!guard.ok) return guard;
  const parsed = catalogNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const res = await insertCatalogEntry("product_brands", guard.orgId, parsed.data.name);
  if (!res.ok) return res;
  revalidatePath("/productos");
  return { ok: true };
}

export async function deleteBrand(id: string): Promise<ActionResult> {
  const guard = await requireCatalogWrite();
  if (!guard.ok) return guard;
  const res = await deleteCatalogEntry("product_brands", id);
  if (!res.ok) return res;
  revalidatePath("/productos");
  return { ok: true };
}

export async function createFamily(formData: FormData): Promise<ActionResult> {
  const guard = await requireCatalogWrite();
  if (!guard.ok) return guard;
  const parsed = catalogNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const res = await insertCatalogEntry("product_families", guard.orgId, parsed.data.name);
  if (!res.ok) return res;
  revalidatePath("/productos");
  return { ok: true };
}

export async function deleteFamily(id: string): Promise<ActionResult> {
  const guard = await requireCatalogWrite();
  if (!guard.ok) return guard;
  const res = await deleteCatalogEntry("product_families", id);
  if (!res.ok) return res;
  revalidatePath("/productos");
  return { ok: true };
}

export async function createOrigin(formData: FormData): Promise<ActionResult> {
  const guard = await requireCatalogWrite();
  if (!guard.ok) return guard;
  const parsed = catalogNameSchema.safeParse({ name: formData.get("name") });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const res = await insertCatalogEntry("product_origins", guard.orgId, parsed.data.name);
  if (!res.ok) return res;
  revalidatePath("/productos");
  return { ok: true };
}

export async function deleteOrigin(id: string): Promise<ActionResult> {
  const guard = await requireCatalogWrite();
  if (!guard.ok) return guard;
  const res = await deleteCatalogEntry("product_origins", id);
  if (!res.ok) return res;
  revalidatePath("/productos");
  return { ok: true };
}

// ── Productos ────────────────────────────────────────────────────────────
const productSchema = z.object({
  code: z.string().trim().min(1, "El código es obligatorio.").max(80),
  brand_id: z.string().uuid("Selecciona una marca."),
  family_id: z.string().uuid("Selecciona una familia."),
  origin_id: z.string().uuid().optional().or(z.literal("")),
  supplier_id: z.string().uuid().optional().or(z.literal("")),
  internal_mm: z.coerce.number().optional(),
  external_mm: z.coerce.number().optional(),
  height_mm: z.coerce.number().optional(),
  flange_mm: z.coerce.number().optional(),
  stop_mm: z.coerce.number().optional(),
  application: z.string().trim().max(500).optional().or(z.literal("")),
  cost_usd: z.coerce.number().min(0, "El costo no puede ser negativo."),
  exchange_rate: z.coerce.number().positive("El tipo de cambio debe ser mayor a 0."),
  margin_sf_pct: z.coerce.number(),
  margin_cf_pct: z.coerce.number(),
  margin_may_pct: z.coerce.number(),
});

function parseProductForm(formData: FormData) {
  return productSchema.safeParse({
    code: formData.get("code"),
    brand_id: formData.get("brand_id"),
    family_id: formData.get("family_id"),
    origin_id: formData.get("origin_id"),
    supplier_id: formData.get("supplier_id"),
    internal_mm: formData.get("internal_mm") || undefined,
    external_mm: formData.get("external_mm") || undefined,
    height_mm: formData.get("height_mm") || undefined,
    flange_mm: formData.get("flange_mm") || undefined,
    stop_mm: formData.get("stop_mm") || undefined,
    application: formData.get("application"),
    cost_usd: formData.get("cost_usd"),
    exchange_rate: formData.get("exchange_rate"),
    margin_sf_pct: formData.get("margin_sf_pct"),
    margin_cf_pct: formData.get("margin_cf_pct"),
    margin_may_pct: formData.get("margin_may_pct"),
  });
}

export async function createProduct(formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:write")) {
    return { ok: false, error: "No tienes permiso para crear productos." };
  }

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }
  const branchId = formData.get("branch_id");
  if (typeof branchId !== "string" || !branchId) {
    return { ok: false, error: "Selecciona una sucursal para el stock inicial." };
  }
  const quantity = Number(formData.get("quantity") ?? 0);
  if (!Number.isFinite(quantity) || quantity < 0) {
    return { ok: false, error: "La cantidad debe ser un número mayor o igual a 0." };
  }

  const prices = calculatePrices({
    costUsd: parsed.data.cost_usd,
    exchangeRate: parsed.data.exchange_rate,
    marginSfPct: parsed.data.margin_sf_pct,
    marginCfPct: parsed.data.margin_cf_pct,
    marginMayPct: parsed.data.margin_may_pct,
  });

  const supabase = await createClient();
  const { data: product, error } = await supabase
    .from("products")
    .insert({
      org_id: profile.orgId,
      code: parsed.data.code,
      brand_id: parsed.data.brand_id,
      family_id: parsed.data.family_id,
      origin_id: parsed.data.origin_id || null,
      supplier_id: parsed.data.supplier_id || null,
      internal_mm: parsed.data.internal_mm ?? null,
      external_mm: parsed.data.external_mm ?? null,
      height_mm: parsed.data.height_mm ?? null,
      flange_mm: parsed.data.flange_mm ?? null,
      stop_mm: parsed.data.stop_mm ?? null,
      application: parsed.data.application || null,
      cost_usd: parsed.data.cost_usd,
      exchange_rate: parsed.data.exchange_rate,
      margin_sf_pct: parsed.data.margin_sf_pct,
      margin_cf_pct: parsed.data.margin_cf_pct,
      margin_may_pct: parsed.data.margin_may_pct,
      price_sf_bs: prices.priceSfBs,
      price_cf_bs: prices.priceCfBs,
      price_may_bs: prices.priceMayBs,
    })
    .select("id")
    .single();
  if (error || !product) {
    console.error("createProduct:", error?.message);
    if (error?.code === "23505") {
      return { ok: false, error: "Ya existe un producto con ese código y marca." };
    }
    return { ok: false, error: "No se pudo crear el producto." };
  }

  const { error: stockError } = await supabase.from("product_stock").insert({
    org_id: profile.orgId,
    product_id: product.id,
    branch_id: branchId,
    quantity,
  });
  if (stockError) {
    console.error("createProduct stock:", stockError.message);
    return { ok: false, error: "El producto se creó, pero no se pudo registrar el stock." };
  }

  revalidatePath("/productos");
  return { ok: true };
}

export async function updateProduct(
  id: string,
  formData: FormData,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:write")) {
    return { ok: false, error: "No tienes permiso para editar productos." };
  }

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const prices = calculatePrices({
    costUsd: parsed.data.cost_usd,
    exchangeRate: parsed.data.exchange_rate,
    marginSfPct: parsed.data.margin_sf_pct,
    marginCfPct: parsed.data.margin_cf_pct,
    marginMayPct: parsed.data.margin_may_pct,
  });

  const supabase = await createClient();
  const { error } = await supabase
    .from("products")
    .update({
      code: parsed.data.code,
      brand_id: parsed.data.brand_id,
      family_id: parsed.data.family_id,
      origin_id: parsed.data.origin_id || null,
      supplier_id: parsed.data.supplier_id || null,
      internal_mm: parsed.data.internal_mm ?? null,
      external_mm: parsed.data.external_mm ?? null,
      height_mm: parsed.data.height_mm ?? null,
      flange_mm: parsed.data.flange_mm ?? null,
      stop_mm: parsed.data.stop_mm ?? null,
      application: parsed.data.application || null,
      cost_usd: parsed.data.cost_usd,
      exchange_rate: parsed.data.exchange_rate,
      margin_sf_pct: parsed.data.margin_sf_pct,
      margin_cf_pct: parsed.data.margin_cf_pct,
      margin_may_pct: parsed.data.margin_may_pct,
      price_sf_bs: prices.priceSfBs,
      price_cf_bs: prices.priceCfBs,
      price_may_bs: prices.priceMayBs,
      updated_at: new Date().toISOString(),
    })
    .eq("id", id);
  if (error) {
    console.error("updateProduct:", error.message);
    if (error.code === "23505") {
      return { ok: false, error: "Ya existe un producto con ese código y marca." };
    }
    return { ok: false, error: "No se pudo actualizar el producto." };
  }

  revalidatePath("/productos");
  return { ok: true };
}

export async function deleteProduct(id: string): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:delete")) {
    return { ok: false, error: "No tienes permiso para eliminar productos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("products").delete().eq("id", id);
  if (error) {
    console.error("deleteProduct:", error.message);
    return { ok: false, error: "No se pudo eliminar el producto." };
  }

  revalidatePath("/productos");
  return { ok: true };
}

// ── Stock por sucursal ───────────────────────────────────────────────────
export async function updateProductStock(
  productId: string,
  branchId: string,
  quantity: number,
): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:write")) {
    return { ok: false, error: "No tienes permiso para editar el stock." };
  }
  if (!Number.isFinite(quantity) || quantity < 0) {
    return { ok: false, error: "La cantidad debe ser un número mayor o igual a 0." };
  }

  const supabase = await createClient();
  const { error } = await supabase.from("product_stock").upsert(
    {
      org_id: profile.orgId,
      product_id: productId,
      branch_id: branchId,
      quantity,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "product_id,branch_id" },
  );
  if (error) {
    console.error("updateProductStock:", error.message);
    return { ok: false, error: "No se pudo actualizar el stock." };
  }

  revalidatePath("/productos");
  return { ok: true };
}
