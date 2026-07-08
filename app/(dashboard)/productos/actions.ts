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
  verifyBranchInOrg,
  resolveOrCreateCatalogEntry,
} from "@/lib/catalogs";

export type ActionResult = { ok: boolean; error?: string };

// Tipo de cambio global de la organización (Ajustes → Tipo de cambio). Ya no
// se ingresa por producto: se lee aquí y se congela en products.exchange_rate
// al guardar, igual que hace set_org_exchange_rate() cuando cambia el global.
async function getOrgExchangeRate(
  supabase: Awaited<ReturnType<typeof createClient>>,
  orgId: string,
): Promise<number> {
  const { data } = await supabase
    .from("organizations")
    .select("exchange_rate")
    .eq("id", orgId)
    .single();
  return data?.exchange_rate ?? 0;
}

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
  brand: z.string().trim().min(1, "La marca es obligatoria.").max(120),
  family: z.string().trim().min(1, "La familia es obligatoria.").max(120),
  origin: z.string().trim().max(120).optional().or(z.literal("")),
  supplier_id: z.string().uuid().optional().or(z.literal("")),
  internal_mm: z.coerce.number().optional(),
  external_mm: z.coerce.number().optional(),
  height_mm: z.coerce.number().optional(),
  flange_mm: z.coerce.number().optional(),
  stop_mm: z.coerce.number().optional(),
  application: z.string().trim().max(500).optional().or(z.literal("")),
  notes: z.string().trim().max(500).optional().or(z.literal("")),
  cost_usd: z.coerce.number().min(0, "El costo no puede ser negativo."),
  margin_sf_pct: z.coerce.number(),
  margin_may_pct: z.coerce.number(),
});

function parseProductForm(formData: FormData) {
  return productSchema.safeParse({
    code: formData.get("code"),
    brand: formData.get("brand"),
    family: formData.get("family"),
    origin: formData.get("origin"),
    supplier_id: formData.get("supplier_id"),
    internal_mm: formData.get("internal_mm") || undefined,
    external_mm: formData.get("external_mm") || undefined,
    height_mm: formData.get("height_mm") || undefined,
    flange_mm: formData.get("flange_mm") || undefined,
    stop_mm: formData.get("stop_mm") || undefined,
    application: formData.get("application"),
    notes: formData.get("notes"),
    cost_usd: formData.get("cost_usd"),
    margin_sf_pct: formData.get("margin_sf_pct"),
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

  const supabase = await createClient();
  const branchValid = await verifyBranchInOrg(supabase, branchId, profile.orgId);
  if (!branchValid) {
    return { ok: false, error: "La sucursal seleccionada no es válida." };
  }
  const exchangeRate = await getOrgExchangeRate(supabase, profile.orgId);

  let brandId: string;
  let familyId: string;
  let originId: string | null;
  try {
    brandId = await resolveOrCreateCatalogEntry(supabase, "product_brands", profile.orgId, parsed.data.brand);
    familyId = await resolveOrCreateCatalogEntry(
      supabase,
      "product_families",
      profile.orgId,
      parsed.data.family,
    );
    originId = parsed.data.origin
      ? await resolveOrCreateCatalogEntry(supabase, "product_origins", profile.orgId, parsed.data.origin)
      : null;
  } catch (err) {
    console.error("createProduct catálogos:", err);
    return { ok: false, error: "No se pudo resolver marca/familia/procedencia." };
  }

  const prices = calculatePrices({
    costUsd: parsed.data.cost_usd,
    exchangeRate,
    marginSfPct: parsed.data.margin_sf_pct,
    marginMayPct: parsed.data.margin_may_pct,
  });

  const { data: product, error } = await supabase
    .from("products")
    .insert({
      org_id: profile.orgId,
      code: parsed.data.code,
      brand_id: brandId,
      family_id: familyId,
      origin_id: originId,
      supplier_id: parsed.data.supplier_id || null,
      internal_mm: parsed.data.internal_mm ?? null,
      external_mm: parsed.data.external_mm ?? null,
      height_mm: parsed.data.height_mm ?? null,
      flange_mm: parsed.data.flange_mm ?? null,
      stop_mm: parsed.data.stop_mm ?? null,
      application: parsed.data.application || null,
      notes: parsed.data.notes || null,
      cost_usd: parsed.data.cost_usd,
      exchange_rate: exchangeRate,
      margin_sf_pct: parsed.data.margin_sf_pct,
      margin_cf_pct: prices.marginCfPct,
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
    const { error: rollbackError } = await supabase.from("products").delete().eq("id", product.id);
    if (rollbackError) {
      console.error(
        "createProduct rollback failed, orphaned product row:",
        product.id,
        rollbackError.message,
      );
    }
    return { ok: false, error: "El producto se creó, pero no se pudo registrar el stock." };
  }

  const { error: movementError } = await supabase.from("stock_movements").insert({
    org_id: profile.orgId,
    product_id: product.id,
    branch_id: branchId,
    movement_type: "alta_inicial",
    quantity_delta: quantity,
    resulting_quantity: quantity,
    reason: null,
    actor_id: profile.userId,
    sale_id: null,
  });
  if (movementError) {
    console.error("createProduct movement:", movementError.message);
    const { error: stockRollbackError } = await supabase
      .from("product_stock")
      .delete()
      .eq("product_id", product.id)
      .eq("branch_id", branchId);
    const { error: productRollbackError } = await supabase
      .from("products")
      .delete()
      .eq("id", product.id);
    if (stockRollbackError || productRollbackError) {
      console.error(
        "createProduct rollback failed after movement insert error, orphaned product row:",
        product.id,
        stockRollbackError?.message,
        productRollbackError?.message,
      );
    }
    return {
      ok: false,
      error: "El producto se creó, pero no se pudo registrar el historial de stock.",
    };
  }

  revalidatePath("/productos");
  return { ok: true };
}

export async function updateProduct(id: string, formData: FormData): Promise<ActionResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "productos:write")) {
    return { ok: false, error: "No tienes permiso para editar productos." };
  }

  const parsed = parseProductForm(formData);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const exchangeRate = await getOrgExchangeRate(supabase, profile.orgId);

  let brandId: string;
  let familyId: string;
  let originId: string | null;
  try {
    brandId = await resolveOrCreateCatalogEntry(supabase, "product_brands", profile.orgId, parsed.data.brand);
    familyId = await resolveOrCreateCatalogEntry(
      supabase,
      "product_families",
      profile.orgId,
      parsed.data.family,
    );
    originId = parsed.data.origin
      ? await resolveOrCreateCatalogEntry(supabase, "product_origins", profile.orgId, parsed.data.origin)
      : null;
  } catch (err) {
    console.error("updateProduct catálogos:", err);
    return { ok: false, error: "No se pudo resolver marca/familia/procedencia." };
  }

  const prices = calculatePrices({
    costUsd: parsed.data.cost_usd,
    exchangeRate,
    marginSfPct: parsed.data.margin_sf_pct,
    marginMayPct: parsed.data.margin_may_pct,
  });

  const { error } = await supabase
    .from("products")
    .update({
      code: parsed.data.code,
      brand_id: brandId,
      family_id: familyId,
      origin_id: originId,
      supplier_id: parsed.data.supplier_id || null,
      internal_mm: parsed.data.internal_mm ?? null,
      external_mm: parsed.data.external_mm ?? null,
      height_mm: parsed.data.height_mm ?? null,
      flange_mm: parsed.data.flange_mm ?? null,
      stop_mm: parsed.data.stop_mm ?? null,
      application: parsed.data.application || null,
      notes: parsed.data.notes || null,
      cost_usd: parsed.data.cost_usd,
      exchange_rate: exchangeRate,
      margin_sf_pct: parsed.data.margin_sf_pct,
      margin_cf_pct: prices.marginCfPct,
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
  const { error } = await supabase.from("products").update({ active: false }).eq("id", id);
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
  const branchValid = await verifyBranchInOrg(supabase, branchId, profile.orgId);
  if (!branchValid) {
    return { ok: false, error: "La sucursal seleccionada no es válida." };
  }

  const { data: existingStock } = await supabase
    .from("product_stock")
    .select("quantity")
    .eq("product_id", productId)
    .eq("branch_id", branchId)
    .maybeSingle();
  const previousQuantity = existingStock?.quantity ?? 0;

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

  if (quantity !== previousQuantity) {
    const { error: movementError } = await supabase.from("stock_movements").insert({
      org_id: profile.orgId,
      product_id: productId,
      branch_id: branchId,
      movement_type: "ajuste_manual",
      quantity_delta: quantity - previousQuantity,
      resulting_quantity: quantity,
      reason: "Editado desde ficha de producto",
      actor_id: profile.userId,
      sale_id: null,
    });
    if (movementError) {
      console.error("updateProductStock movement:", movementError.message);
      if (existingStock) {
        await supabase
          .from("product_stock")
          .update({ quantity: previousQuantity })
          .eq("product_id", productId)
          .eq("branch_id", branchId);
      } else {
        await supabase
          .from("product_stock")
          .delete()
          .eq("product_id", productId)
          .eq("branch_id", branchId);
      }
      return {
        ok: false,
        error: "No se pudo registrar el historial de stock. El cambio fue revertido.",
      };
    }
  }

  revalidatePath("/productos");
  return { ok: true };
}
