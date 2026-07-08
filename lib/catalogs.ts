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

// Get-or-create para Marca/Familia/Procedencia al guardar un producto: si el
// nombre escrito no existe todavía en la org (comparación case-insensitive,
// trim), se crea en MAYÚSCULAS — igual que validar_foranea_producto() del
// legacy. Reintenta la búsqueda si el insert falla por una carrera (otro
// request creó el mismo nombre entre el select y el insert).
export async function resolveOrCreateCatalogEntry(
  supabase: Awaited<ReturnType<typeof createClient>>,
  table: SimpleCatalogTable,
  orgId: string,
  name: string,
): Promise<string> {
  const trimmed = name.trim();
  const { data: existing } = await supabase.from(table).select("id, name").eq("org_id", orgId);
  const match = (existing ?? []).find((row) => row.name.toLowerCase() === trimmed.toLowerCase());
  if (match) return match.id;

  const upper = trimmed.toUpperCase();
  const { data: inserted, error } = await supabase
    .from(table)
    .insert({ org_id: orgId, name: upper })
    .select("id")
    .single();
  if (error) {
    const { data: retry } = await supabase.from(table).select("id, name").eq("org_id", orgId);
    const retryMatch = (retry ?? []).find((row) => row.name.toLowerCase() === upper.toLowerCase());
    if (retryMatch) return retryMatch.id;
    throw new Error(`No se pudo resolver/crear "${trimmed}" en ${table}: ${error.message}`);
  }
  return inserted!.id;
}
