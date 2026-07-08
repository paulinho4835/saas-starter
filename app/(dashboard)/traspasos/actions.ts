"use server";

import { revalidatePath } from "next/cache";
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";
import { getProfile } from "@/lib/auth";
import { can } from "@/lib/rbac";
import { verifyBranchInOrg } from "@/lib/catalogs";

const transferItemSchema = z.object({
  productId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
});

const transferGroupSchema = z.object({
  branchId: z.string().uuid(),
  items: z.array(transferItemSchema).min(1),
});

const createTransferSchema = z.object({
  groups: z.array(transferGroupSchema).min(1, "Agrega al menos un producto."),
});

export type CreateTransferResult = { ok: true } | { ok: false; error: string };

async function createTransferGroups(
  formData: FormData,
  branchRole: "from" | "to",
): Promise<CreateTransferResult> {
  const transferType = branchRole === "from" ? "pedido" : "envio";
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "traspasos:create")) {
    return { ok: false, error: "No tienes permiso para hacer traspasos." };
  }
  if (!profile.branchId) {
    return { ok: false, error: "No tienes una sucursal asignada." };
  }

  let raw: unknown;
  try {
    raw = JSON.parse(String(formData.get("groups") ?? "[]"));
  } catch {
    return { ok: false, error: "Carrito inválido." };
  }
  const parsed = createTransferSchema.safeParse({ groups: raw });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  for (const group of parsed.data.groups) {
    if (group.branchId === profile.branchId) {
      return { ok: false, error: "La sucursal de origen y destino no pueden ser la misma." };
    }
    const validBranch = await verifyBranchInOrg(supabase, group.branchId, profile.orgId);
    if (!validBranch) {
      return { ok: false, error: "Alguna de las sucursales seleccionadas no es válida." };
    }
  }

  // Un carrito puede generar varios `transfers` (uno por sucursal). Se
  // envían todos los grupos en UNA sola llamada RPC = una sola transacción
  // Postgres, para que un fallo a mitad de camino no deje grupos previos
  // ya comprometidos (ver create_transfer_groups en
  // 0017_traspasos_atomic_groups.sql).
  const groupsPayload = parsed.data.groups.map((group) => ({
    branch_id: group.branchId,
    items: group.items.map((i) => ({ product_id: i.productId, quantity: i.quantity })),
  }));
  const { error } = await supabase.rpc("create_transfer_groups", {
    p_org_id: profile.orgId,
    p_own_branch_id: profile.branchId,
    p_actor_id: profile.userId,
    p_type: transferType,
    p_groups: groupsPayload,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/traspasos");
  return { ok: true };
}

// Crea un Pedido por cada sucursal del carrito: solicita stock a esa
// sucursal (from_branch_id = la sucursal elegida), quedará a nombre de la
// propia (to_branch_id).
export async function createTransferRequest(formData: FormData): Promise<CreateTransferResult> {
  return createTransferGroups(formData, "from");
}

// Crea un Envío por cada sucursal del carrito: manda stock propio
// (from_branch_id = la propia) a la sucursal elegida (to_branch_id).
export async function createTransferShipment(formData: FormData): Promise<CreateTransferResult> {
  return createTransferGroups(formData, "to");
}

const advanceSchema = z.object({
  transferId: z.string().uuid(),
  nextStatus: z.enum(["en_cola", "enviando", "entregado", "rechazado", "cancelado"]),
});

export type AdvanceTransferResult = { ok: true } | { ok: false; error: string };

export async function advanceTransferStatus(formData: FormData): Promise<AdvanceTransferResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "traspasos:create")) {
    return { ok: false, error: "No tienes permiso para hacer traspasos." };
  }
  if (!profile.branchId) {
    return { ok: false, error: "No tienes una sucursal asignada." };
  }
  const parsed = advanceSchema.safeParse({
    transferId: formData.get("transferId"),
    nextStatus: formData.get("nextStatus"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { error } = await supabase.rpc("advance_transfer", {
    p_transfer_id: parsed.data.transferId,
    p_actor_id: profile.userId,
    p_actor_branch_id: profile.branchId,
    p_next_status: parsed.data.nextStatus,
  });
  if (error) return { ok: false, error: error.message };

  revalidatePath("/traspasos");
  return { ok: true };
}

const validateQuantitySchema = z.object({
  productId: z.string().uuid(),
  branchId: z.string().uuid(),
  quantity: z.coerce.number().int().positive(),
});

export type ValidateTransferQuantityResult = { ok: true } | { ok: false; error: string };

// Valida que la cantidad pedida/enviada no exceda el stock ACTUAL de la
// sucursal relevante (para Pedido: la sucursal elegida como origen; para
// Envío: siempre la propia) antes de agregarla al carrito — igual que
// agregar_producto_carrito() del legacy, que revisa Existencia antes de
// aceptar la línea en el carrito de sesión.
export async function validateTransferQuantity(
  formData: FormData,
): Promise<ValidateTransferQuantityResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "traspasos:create")) {
    return { ok: false, error: "No tienes permiso para hacer traspasos." };
  }
  const parsed = validateQuantitySchema.safeParse({
    productId: formData.get("productId"),
    branchId: formData.get("branchId"),
    quantity: formData.get("quantity"),
  });
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues[0]?.message ?? "Datos inválidos." };
  }

  const supabase = await createClient();
  const { data } = await supabase
    .from("product_stock")
    .select("quantity")
    .eq("product_id", parsed.data.productId)
    .eq("branch_id", parsed.data.branchId)
    .maybeSingle();
  const available = data?.quantity ?? 0;
  if (parsed.data.quantity > available) {
    return { ok: false, error: `La cantidad debe estar entre 0 y ${available}.` };
  }
  return { ok: true };
}

// Stock del producto en TODAS las sucursales salvo la propia — panel "Datos
// adicionales" de la pestaña Solicitud/Envío (igual que
// Producto::cantidades_sucursales() del legacy).
export type ProductBranchStockResult =
  | { ok: true; rows: { branchName: string; quantity: number }[] }
  | { ok: false; error: string };

export async function getTransferProductStock(productId: string): Promise<ProductBranchStockResult> {
  const profile = await getProfile();
  if (!profile) return { ok: false, error: "Sesión no válida." };
  if (!can(profile.role, "traspasos:create")) {
    return { ok: false, error: "No tienes permiso para hacer traspasos." };
  }
  if (!profile.branchId) return { ok: true, rows: [] };

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("product_stock")
    .select("quantity, branches(name)")
    .eq("product_id", productId)
    .neq("branch_id", profile.branchId);

  if (error) {
    console.error("getTransferProductStock:", error.message);
    return { ok: false, error: "No se pudo cargar el stock por sucursal." };
  }

  const rows = ((data ?? []) as unknown as { quantity: number; branches: { name: string } | null }[]).map(
    (r) => ({ branchName: r.branches?.name ?? "—", quantity: r.quantity }),
  );
  return { ok: true, rows };
}
