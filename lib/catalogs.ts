// lib/catalogs.ts
// Helpers genéricos para los catálogos "nombre + org_id" (sucursales, marcas,
// familias, procedencias). Reutilizados por varios módulos para no repetir el
// mismo insert/delete cuatro veces.
import { z } from "zod";
import { createClient } from "@/lib/supabase/server";

export const catalogNameSchema = z.object({
  name: z.string().trim().min(1, "El nombre es obligatorio.").max(120),
});

export type SimpleCatalogTable =
  | "branches"
  | "product_brands"
  | "product_families"
  | "product_origins";

export type CatalogActionResult = { ok: true } | { ok: false; error: string };

export async function insertCatalogEntry(
  table: SimpleCatalogTable,
  orgId: string,
  name: string,
): Promise<CatalogActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from(table).insert({ org_id: orgId, name });
  if (error) {
    if (error.code === "23505") {
      return { ok: false, error: "Ya existe un registro con ese nombre." };
    }
    console.error(`insertCatalogEntry(${table}):`, error.message);
    return { ok: false, error: "No se pudo crear el registro." };
  }
  return { ok: true };
}

export async function deleteCatalogEntry(
  table: SimpleCatalogTable,
  id: string,
): Promise<CatalogActionResult> {
  const supabase = await createClient();
  const { error } = await supabase.from(table).delete().eq("id", id);
  if (error) {
    console.error(`deleteCatalogEntry(${table}):`, error.message);
    return {
      ok: false,
      error: "No se pudo eliminar. Verifica que no esté en uso por ningún producto.",
    };
  }
  return { ok: true };
}

// Verifica que una sucursal pertenezca a la org del usuario antes de usarla
// en escrituras de product_stock. `branches` no tiene una FK/RLS que ate
// product_stock.branch_id a la misma org, así que este chequeo es la única
// barrera contra un branchId ajeno colado desde el cliente.
export async function verifyBranchInOrg(
  supabase: Awaited<ReturnType<typeof createClient>>,
  branchId: string,
  orgId: string,
): Promise<boolean> {
  const { data } = await supabase
    .from("branches")
    .select("id")
    .eq("id", branchId)
    .eq("org_id", orgId)
    .maybeSingle();
  return !!data;
}
