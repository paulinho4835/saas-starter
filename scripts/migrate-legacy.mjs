#!/usr/bin/env node
// ============================================================================
// Migración del backup pg_dump del sistema legacy "Venta Retenes" al modelo
// multi-tenant nuevo (Supabase).
//
// Uso:
//   node scripts/migrate-legacy.mjs \
//     --file "C:/Users/pauli/Downloads/backup-07-09-2026.sql" \
//     --org <uuid de la organización destino> \
//     --default-profile <uuid de profiles para seller/actor de datos históricos> \
//     [--user-map scripts/legacy-user-map.json]  (opcional: {"14":"<uuid perfil>", ...})
//     [--dry-run]                                 (parsea, convierte y reporta sin escribir)
//
// Env requerido (se lee .env.local): NEXT_PUBLIC_SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.
// El service-role bypassa RLS por diseño (igual que el panel /superadmin).
//
// Idempotencia: guarda scripts/legacy-migration-map.json con legacy_id → uuid
// por entidad. Al re-ejecutar, lo ya migrado se salta.
//
// Mapeo de precios (ver docs/superpowers/specs/2026-07-08-productos-legacy-replica-design.md):
//   - producto.costo_origen_bolivianos  → products.cost_usd (el nombre legacy
//     miente: los valores son USD; el legacy multiplicaba por valor_monetario.precio_dolar)
//   - incremento_sf / incremento_may    → margin_sf_pct / margin_may_pct
//   - price_sf_bs  = round(cost_usd * rate * (1 + sf/100), 2)
//   - price_cf_bs  = round(price_sf_bs * 1.13, 2)   ← regla única del sistema nuevo
//     (incremento_cf del legacy se descarta: era inconsistente; CF siempre deriva de SF)
//   - rate = último valor_monetario.precio_dolar → organizations.exchange_rate
//
// Tablas legacy que NO se migran (a propósito):
//   - historico_movimiento (90k): ledger del legacy; el stock final ya viene de
//     existencia y el sistema nuevo arma su propio ledger desde la migración.
//   - permiso/privilegio: el RBAC nuevo es distinto (lib/rbac).
//   - users/password_resets/migrations/prueba_producto/precio_producto: tablas
//     internas de Laravel o de prueba, sin datos útiles.
//   - usuario/persona: NO se crean usuarios auth automáticamente; se genera
//     scripts/legacy-users-report.json para crearlos a mano y (opcional)
//     re-asignar ventas vía --user-map.
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const FILE = argValue("--file");
const ORG_ID = argValue("--org");
const DEFAULT_PROFILE = argValue("--default-profile");
const USER_MAP_FILE = argValue("--user-map");
const DRY_RUN = args.includes("--dry-run");

if (!FILE || !fs.existsSync(FILE)) {
  console.error("Falta --file o el archivo no existe.");
  process.exit(1);
}
if (!DRY_RUN && (!ORG_ID || !DEFAULT_PROFILE)) {
  console.error("Sin --dry-run se requieren --org y --default-profile.");
  process.exit(1);
}

// ── Env (.env.local) ─────────────────────────────────────────────────────────
function loadEnvLocal() {
  const p = path.join(repoRoot, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnvLocal();

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!DRY_RUN && (!SUPABASE_URL || !SERVICE_KEY)) {
  console.error("Faltan NEXT_PUBLIC_SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY.");
  process.exit(1);
}

// ── Parser de COPY (formato text de pg_dump) ────────────────────────────────
// Cada fila es una línea; campos separados por TAB; \N es NULL; los escapes
// relevantes son \\ \t \n \r. pg_dump nunca parte una fila en varias líneas.
function unescapeField(s) {
  if (s === "\\N") return null;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") {
      out += c;
      continue;
    }
    const n = s[++i];
    if (n === "t") out += "\t";
    else if (n === "n") out += "\n";
    else if (n === "r") out += "\r";
    else if (n === "\\") out += "\\";
    else out += n; // escape desconocido: conservar el carácter
  }
  return out;
}

async function parseDump(file) {
  const tables = {};
  let current = null;
  let columns = null;
  const rl = readline.createInterface({
    input: fs.createReadStream(file, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    if (current === null) {
      const m = line.match(/^COPY public\.(\w+) \(([^)]*)\) FROM stdin;$/);
      if (m) {
        current = m[1];
        columns = m[2].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
        tables[current] = { columns, rows: [] };
      }
      continue;
    }
    if (line === "\\.") {
      current = null;
      columns = null;
      continue;
    }
    const parts = line.split("\t");
    if (parts.length !== columns.length) {
      throw new Error(
        `Fila con ${parts.length} campos (esperaba ${columns.length}) en ${current}: ${line.slice(0, 120)}`,
      );
    }
    const row = {};
    for (let i = 0; i < columns.length; i++) row[columns[i]] = unescapeField(parts[i]);
    tables[current].rows.push(row);
  }
  return tables;
}

// ── Utilidades ──────────────────────────────────────────────────────────────
const round2 = (n) => Math.round(n * 100) / 100;
const num = (v) => (v === null || v === "" ? null : Number(v));
// Timestamps del legacy vienen sin zona; el negocio opera en Bolivia (UTC-4).
const ts = (v) => (v ? `${v.replace(" ", "T")}-04:00` : null);

function chunk(items, size = 500) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

// Mapa de idempotencia legacy_id → uuid, persistido entre corridas.
const MAP_FILE = path.join(__dirname, "legacy-migration-map.json");
const idMap = fs.existsSync(MAP_FILE)
  ? JSON.parse(fs.readFileSync(MAP_FILE, "utf8"))
  : {};
function mapOf(entity) {
  if (!idMap[entity]) idMap[entity] = {};
  return idMap[entity];
}
function saveMap() {
  if (!DRY_RUN) fs.writeFileSync(MAP_FILE, JSON.stringify(idMap, null, 2));
}

const stats = {};
function note(key, n = 1) {
  stats[key] = (stats[key] ?? 0) + n;
}

// ── Supabase ────────────────────────────────────────────────────────────────
let supabase = null;
if (!DRY_RUN) {
  const { createClient } = await import("@supabase/supabase-js");
  supabase = createClient(SUPABASE_URL, SERVICE_KEY, {
    auth: { persistSession: false },
  });
}

async function insertBatched(table, rows, { returning = "id" } = {}) {
  const inserted = [];
  for (const batch of chunk(rows)) {
    const { data, error } = await supabase.from(table).insert(batch).select(returning);
    if (error) throw new Error(`insert ${table}: ${error.message}`);
    inserted.push(...(data ?? []));
  }
  return inserted;
}

// ============================================================================
// Migración
// ============================================================================
console.log(`Parseando ${FILE} ...`);
const dump = await parseDump(FILE);
for (const [t, { rows }] of Object.entries(dump)) note(`legacy ${t}`, rows.length);

// ── Tipo de cambio: último valor_monetario ──────────────────────────────────
const rateRows = dump.valor_monetario?.rows ?? [];
const latestRate = rateRows
  .map((r) => ({ id: Number(r.id_valor_monetario), rate: Number(r.precio_dolar) }))
  .sort((a, b) => b.id - a.id)[0];
const RATE = latestRate ? round2(latestRate.rate) : 6.96;
console.log(`Tipo de cambio (último valor_monetario): ${RATE}`);

// ── Catálogos ───────────────────────────────────────────────────────────────
// Migra un catálogo simple con match-por-nombre contra lo existente en la org
// (mismo criterio que import-actions.ts) para no duplicar en re-corridas.
async function migrateCatalog(entity, targetTable, rows, toPayload, nameOf) {
  const m = mapOf(entity);
  // Dedupe por nombre (los índices únicos del schema nuevo son por lower(name)).
  const byName = new Map();
  for (const r of rows) {
    const name = (nameOf(r) ?? "").trim();
    if (!name) {
      note(`${entity} sin nombre (saltado)`);
      continue;
    }
    const key = name.toLowerCase();
    if (!byName.has(key)) byName.set(key, { name, legacyIds: [] });
    byName.get(key).legacyIds.push(r[Object.keys(r)[0]]);
  }

  if (DRY_RUN) {
    note(`${targetTable} a crear`, byName.size);
    // Poblar el mapa con placeholders para que los conteos de las fases
    // siguientes (stock, ventas, traspasos) sean realistas en el dry-run.
    for (const e of byName.values()) {
      for (const legacyId of e.legacyIds) m[legacyId] = `dry:${entity}:${e.name}`;
    }
    return;
  }

  const { data: existing, error } = await supabase
    .from(targetTable)
    .select("id, name")
    .eq("org_id", ORG_ID);
  if (error) throw new Error(`select ${targetTable}: ${error.message}`);
  const existingByName = new Map((existing ?? []).map((e) => [e.name.toLowerCase(), e.id]));

  const missing = [...byName.values()].filter(
    (e) => !existingByName.has(e.name.toLowerCase()),
  );
  if (missing.length > 0) {
    const inserted = await insertBatched(
      targetTable,
      missing.map((e) => toPayload(e.name)),
      { returning: "id, name" },
    );
    for (const row of inserted) existingByName.set(row.name.toLowerCase(), row.id);
    note(`${targetTable} creados`, inserted.length);
  }
  for (const e of byName.values()) {
    const id = existingByName.get(e.name.toLowerCase());
    for (const legacyId of e.legacyIds) m[legacyId] = id;
  }
}

// branches ← sucursal
await migrateCatalog(
  "sucursal",
  "branches",
  dump.sucursal?.rows ?? [],
  (name) => ({ org_id: ORG_ID, name }),
  (r) => r.nombre_sucursal,
);
if (!DRY_RUN) {
  // active según estado_sucursal
  for (const r of dump.sucursal?.rows ?? []) {
    const id = mapOf("sucursal")[r.id_sucursal];
    if (id && r.estado_sucursal !== "1") {
      await supabase.from("branches").update({ active: false }).eq("id", id);
    }
  }
}

// product_brands ← marca / product_families ← familia / product_origins ← pais
await migrateCatalog("marca", "product_brands", dump.marca?.rows ?? [],
  (name) => ({ org_id: ORG_ID, name }), (r) => r.nombre_marca);
await migrateCatalog("familia", "product_families", dump.familia?.rows ?? [],
  (name) => ({ org_id: ORG_ID, name }), (r) => r.nombre_familia);
await migrateCatalog("pais", "product_origins", dump.pais?.rows ?? [],
  (name) => ({ org_id: ORG_ID, name }), (r) => r.nombre_pais);

// suppliers ← proveedor (datos extra del legacy → notes)
{
  const m = mapOf("proveedor");
  const rows = dump.proveedor?.rows ?? [];
  if (DRY_RUN) {
    note("suppliers a crear", rows.length);
    for (const r of rows) m[r.id_proveedor] = `dry:proveedor:${r.nombre_proveedor}`;
  } else {
    const { data: existing } = await supabase
      .from("suppliers").select("id, name").eq("org_id", ORG_ID);
    const byName = new Map((existing ?? []).map((e) => [e.name.toLowerCase(), e.id]));
    for (const r of rows) {
      const name = (r.nombre_proveedor ?? "").trim();
      if (!name) continue;
      let id = byName.get(name.toLowerCase());
      if (!id) {
        const notes = [
          r.direccion_proveedor && `Dirección: ${r.direccion_proveedor.trim()}`,
          r.ciudad_proveedor && `Ciudad: ${r.ciudad_proveedor.trim()}`,
          r.email_proveedor && `Email: ${r.email_proveedor.trim()}`,
          r.observacion_proveedor && `Obs: ${r.observacion_proveedor.trim()}`,
        ].filter(Boolean).join(" | ");
        const { data, error } = await supabase
          .from("suppliers")
          .insert({ org_id: ORG_ID, name, phone: r.telefono_proveedor, notes: notes || null })
          .select("id").single();
        if (error) throw new Error(`insert suppliers: ${error.message}`);
        id = data.id;
        byName.set(name.toLowerCase(), id);
        note("suppliers creados");
      }
      m[r.id_proveedor] = id;
    }
  }
}

// customers ← cliente (dedupe por NIT: índice único parcial en org+lower(nit))
{
  const m = mapOf("cliente");
  const rows = dump.cliente?.rows ?? [];
  const byNit = new Map();
  const payloads = [];
  for (const r of rows) {
    if (m[r.id_cliente]) continue; // ya migrado en corrida anterior
    const nit = (r.nit_cliente ?? "").trim();
    const key = nit ? `nit:${nit.toLowerCase()}` : `id:${r.id_cliente}`;
    if (byNit.has(key)) {
      byNit.get(key).legacyIds.push(r.id_cliente);
      note("clientes duplicados por NIT (fusionados)");
      continue;
    }
    const entry = {
      legacyIds: [r.id_cliente],
      payload: {
        org_id: ORG_ID,
        full_name: (r.nombre_cliente ?? "").trim() || `Cliente ${r.id_cliente}`,
        nit: nit || null,
        created_at: ts(r.created_at) ?? undefined,
      },
    };
    byNit.set(key, entry);
    payloads.push(entry);
  }
  if (DRY_RUN) {
    note("customers a crear", payloads.length);
    for (const e of payloads) {
      for (const lid of e.legacyIds) m[lid] = `dry:cliente:${lid}`;
    }
  } else if (payloads.length > 0) {
    // Evitar chocar con NITs que ya existan en la org (re-corridas parciales).
    const { data: existing } = await supabase
      .from("customers").select("id, nit").eq("org_id", ORG_ID).not("nit", "is", null);
    const existingByNit = new Map(
      (existing ?? []).filter((e) => e.nit).map((e) => [e.nit.toLowerCase(), e.id]),
    );
    const toInsert = [];
    for (const e of payloads) {
      const nitKey = e.payload.nit?.toLowerCase();
      if (nitKey && existingByNit.has(nitKey)) {
        for (const lid of e.legacyIds) m[lid] = existingByNit.get(nitKey);
      } else {
        toInsert.push(e);
      }
    }
    for (const batch of chunk(toInsert)) {
      const { data, error } = await supabase
        .from("customers")
        .insert(batch.map((e) => e.payload))
        .select("id");
      if (error) throw new Error(`insert customers: ${error.message}`);
      batch.forEach((e, i) => {
        for (const lid of e.legacyIds) m[lid] = data[i].id;
      });
      note("customers creados", batch.length);
    }
  }
  saveMap();
}

// ── Productos ───────────────────────────────────────────────────────────────
// Dedupe por (code, brand): índice único products_org_code_brand_idx. Ante
// duplicados legacy gana la última fila (mismo criterio que import-actions.ts).
const productConversions = [];
{
  const m = mapOf("producto");
  const rows = dump.producto?.rows ?? [];
  const byKey = new Map();
  for (const r of rows) {
    const code = (r.codigo_producto ?? "").trim();
    if (!code) {
      note("productos sin código (saltados)");
      continue;
    }
    const key = `${code}::${r.id_marca}`;
    if (byKey.has(key)) {
      note("productos duplicados code+marca (última fila gana)");
      byKey.get(key).legacyIds.push(r.id_producto);
      byKey.get(key).row = r;
    } else {
      byKey.set(key, { legacyIds: [r.id_producto], row: r });
    }
  }

  const entries = [...byKey.values()].filter((e) =>
    e.legacyIds.every((lid) => !m[lid]),
  );

  for (const e of entries) {
    const r = e.row;
    const costUsd = num(r.costo_origen_bolivianos) ?? 0; // en realidad es USD
    const sfPct = num(r.incremento_sf) ?? 0;
    const mayPct = num(r.incremento_may) ?? 0;
    const costBs = costUsd * RATE;
    const priceSf = round2(costBs * (1 + sfPct / 100));
    const priceCf = round2(priceSf * 1.13);
    const priceMay = round2(costBs * (1 + mayPct / 100));
    const cfPct = costBs > 0 ? round2((priceCf / costBs - 1) * 100) : 0;
    e.payload = {
      org_id: ORG_ID,
      code: (r.codigo_producto ?? "").trim(),
      brand_id: mapOf("marca")[r.id_marca] ?? null,
      family_id: mapOf("familia")[r.id_familia] ?? null,
      origin_id: mapOf("pais")[r.id_procedencia] ?? null,
      supplier_id: r.id_proveedor ? (mapOf("proveedor")[r.id_proveedor] ?? null) : null,
      internal_mm: num(r.medida_interna_producto),
      external_mm: num(r.medida_externa_producto),
      height_mm: num(r.altura_producto),
      flange_mm: num(r["pestaña_producto"]),
      stop_mm: num(r.tope_producto),
      application: r.aplicacion_producto?.trim() || null,
      cost_usd: costUsd,
      exchange_rate: RATE,
      margin_sf_pct: sfPct,
      margin_cf_pct: cfPct,
      margin_may_pct: mayPct,
      price_sf_bs: priceSf,
      price_cf_bs: priceCf,
      price_may_bs: priceMay,
      active: r.estado_producto === "1",
      created_at: ts(r.created_at) ?? undefined,
      updated_at: ts(r.updated_at) ?? new Date().toISOString(),
    };
    if (productConversions.length < 5) {
      productConversions.push({
        legacy: {
          id: e.legacyIds.at(-1),
          code: e.payload.code,
          costo: costUsd,
          inc_sf: sfPct,
          inc_cf: num(r.incremento_cf),
          inc_may: mayPct,
        },
        nuevo: {
          price_sf_bs: priceSf,
          price_cf_bs: priceCf,
          price_may_bs: priceMay,
          margin_cf_pct: cfPct,
          active: e.payload.active,
        },
      });
    }
  }

  if (DRY_RUN) {
    note("products a crear", entries.length);
    for (const e of entries) {
      for (const lid of e.legacyIds) m[lid] = `dry:producto:${e.payload.code}`;
    }
  } else {
    // Filas con marca/familia legacy inexistente (FK huérfana en el dump
    // original, ej. id_familia=0 como placeholder de "sin familia"): se
    // saltan en vez de inventar categorías falsas.
    const validEntries = entries.filter((e) => e.payload.brand_id && e.payload.family_id);
    const orphaned = entries.filter((e) => !e.payload.brand_id || !e.payload.family_id);
    if (orphaned.length > 0) {
      note("productos con marca/familia legacy inexistente (saltados)", orphaned.length);
      console.warn(
        `Saltados por FK huérfana: ${orphaned.map((e) => e.payload.code).join(", ")}`,
      );
    }
    for (const batch of chunk(validEntries)) {
      const { data, error } = await supabase
        .from("products")
        .upsert(batch.map((e) => e.payload), { onConflict: "org_id,code,brand_id" })
        .select("id");
      if (error) throw new Error(`upsert products: ${error.message}`);
      batch.forEach((e, i) => {
        for (const lid of e.legacyIds) m[lid] = data[i].id;
      });
      note("products migrados", batch.length);
    }
    saveMap();
  }
}

// ── Stock ───────────────────────────────────────────────────────────────────
{
  const m = mapOf("existencia");
  const rows = dump.existencia?.rows ?? [];
  const payloads = [];
  const seen = new Set();
  for (const r of rows) {
    if (m[r.id_existencia]) continue;
    const productId = mapOf("producto")[r.id_producto];
    const branchId = mapOf("sucursal")[r.id_sucursal];
    if (!productId || !branchId) {
      note("existencias huérfanas (saltadas)");
      continue;
    }
    const key = `${productId}::${branchId}`;
    if (seen.has(key)) {
      // Producto duplicado en legacy fusionado en uno nuevo: sumar cantidades.
      const prev = payloads.find((p) => p.key === key);
      prev.quantity += Number(r.stock) || 0;
      prev.legacyIds.push(r.id_existencia);
      note("existencias fusionadas por producto duplicado");
      continue;
    }
    seen.add(key);
    payloads.push({
      key,
      legacyIds: [r.id_existencia],
      product_id: productId,
      branch_id: branchId,
      quantity: Number(r.stock) || 0,
    });
  }
  if (DRY_RUN) {
    note("product_stock a crear", payloads.length);
  } else if (payloads.length > 0) {
    for (const batch of chunk(payloads)) {
      const { error } = await supabase.from("product_stock").upsert(
        batch.map((p) => ({
          org_id: ORG_ID,
          product_id: p.product_id,
          branch_id: p.branch_id,
          quantity: p.quantity,
        })),
        { onConflict: "product_id,branch_id" },
      );
      if (error) throw new Error(`upsert product_stock: ${error.message}`);

      const { error: mvError } = await supabase.from("stock_movements").insert(
        batch.map((p) => ({
          org_id: ORG_ID,
          product_id: p.product_id,
          branch_id: p.branch_id,
          movement_type: "importacion",
          quantity_delta: p.quantity,
          resulting_quantity: p.quantity,
          reason: "Migración desde sistema legacy",
          actor_id: DEFAULT_PROFILE,
        })),
      );
      if (mvError) console.error("stock_movements (no bloqueante):", mvError.message);

      for (const p of batch) for (const lid of p.legacyIds) m[lid] = p.key;
      note("product_stock migrados", batch.length);
    }
    saveMap();
  }
}

// ── Ventas ──────────────────────────────────────────────────────────────────
// seller_id: --user-map (legacy id_usuario → uuid de profiles) con fallback al
// --default-profile. branch_id: la sucursal del usuario legacy que vendió.
const userMap = USER_MAP_FILE ? JSON.parse(fs.readFileSync(USER_MAP_FILE, "utf8")) : {};
const branchOfLegacyUser = {};
for (const u of dump.usuario?.rows ?? []) {
  branchOfLegacyUser[u.id_usuario] = mapOf("sucursal")[u.id_sucursal] ?? null;
}
const SALE_TYPE = { SF: "sin_factura", CF: "con_factura", MAY: "mayorista" };
const PRICE_TIER = { SF: "sf", CF: "cf", MAY: "may" };

{
  const mSale = mapOf("venta");
  const mItem = mapOf("detalle_venta");
  const ventas = (dump.venta?.rows ?? []).filter((v) => !mSale[v.id_venta]);
  const detallesBySale = new Map();
  for (const d of dump.detalle_venta?.rows ?? []) {
    if (!detallesBySale.has(d.id_venta)) detallesBySale.set(d.id_venta, []);
    detallesBySale.get(d.id_venta).push(d);
  }

  if (DRY_RUN) {
    note("sales a crear", ventas.length);
    note("sale_items a crear", (dump.detalle_venta?.rows ?? []).length);
  } else {
    const fallbackBranch = Object.values(mapOf("sucursal"))[0];
    for (const batch of chunk(ventas, 200)) {
      const payloads = batch.map((v) => ({
        org_id: ORG_ID,
        branch_id: branchOfLegacyUser[v.id_usuario] ?? fallbackBranch,
        seller_id: userMap[v.id_usuario] ?? DEFAULT_PROFILE,
        customer_id: v.id_cliente ? (mapOf("cliente")[v.id_cliente] ?? null) : null,
        total_bs: num(v.total_venta) ?? 0,
        sale_type: SALE_TYPE[v.tipo_venta] ?? "sin_factura",
        created_at: ts(v.fecha_registro_venta) ?? ts(v.created_at) ?? undefined,
      }));
      const { data, error } = await supabase.from("sales").insert(payloads).select("id");
      if (error) throw new Error(`insert sales: ${error.message}`);

      const itemPayloads = [];
      const itemLegacyIds = [];
      batch.forEach((v, i) => {
        mSale[v.id_venta] = data[i].id;
        const tier = PRICE_TIER[v.tipo_venta] ?? "sf";
        for (const d of detallesBySale.get(v.id_venta) ?? []) {
          const productId = mapOf("producto")[d.id_producto];
          if (!productId) {
            note("detalle_venta con producto inexistente (saltado)");
            continue;
          }
          const qty = Number(d.cantidad) || 0;
          const price = num(d.precio_establecido_producto) ?? 0;
          if (qty <= 0) {
            note("detalle_venta con cantidad <= 0 (saltado)");
            continue;
          }
          itemPayloads.push({
            sale_id: data[i].id,
            product_id: productId,
            price_tier: tier,
            unit_price_bs: price,
            quantity: qty,
            subtotal_bs: round2(qty * price),
          });
          itemLegacyIds.push(d.id_detalle_venta);
        }
      });
      for (const itemBatch of chunk(itemPayloads)) {
        const offset = itemPayloads.indexOf(itemBatch[0]);
        const { data: itemData, error: itemError } = await supabase
          .from("sale_items").insert(itemBatch).select("id");
        if (itemError) throw new Error(`insert sale_items: ${itemError.message}`);
        itemBatch.forEach((_, j) => {
          mItem[itemLegacyIds[offset + j]] = itemData[j].id;
        });
      }
      note("sales migradas", batch.length);
      note("sale_items migrados", itemPayloads.length);
      saveMap();
    }
  }
}

// ── Devoluciones ────────────────────────────────────────────────────────────
{
  const m = mapOf("devolucion");
  const rows = (dump.devolucion?.rows ?? []).filter((r) => !m[r.id_devolucion]);
  const detalleById = new Map(
    (dump.detalle_venta?.rows ?? []).map((d) => [d.id_detalle_venta, d]),
  );
  const ventaById = new Map((dump.venta?.rows ?? []).map((v) => [v.id_venta, v]));

  if (DRY_RUN) {
    note("sale_returns a crear", rows.length);
  } else {
    const payloads = [];
    const legacyIds = [];
    for (const r of rows) {
      const d = detalleById.get(r.id_detalle_venta);
      const saleItemId = mapOf("detalle_venta")[r.id_detalle_venta];
      const saleId = d ? mapOf("venta")[d.id_venta] : null;
      const productId = d ? mapOf("producto")[d.id_producto] : null;
      const v = d ? ventaById.get(d.id_venta) : null;
      const branchId = v
        ? (branchOfLegacyUser[v.id_usuario] ?? Object.values(mapOf("sucursal"))[0])
        : null;
      const qty = Number(r.cantidad_devolucion) || 0;
      if (!saleItemId || !saleId || !productId || !branchId || qty <= 0) {
        note("devoluciones huérfanas (saltadas)");
        continue;
      }
      payloads.push({
        org_id: ORG_ID,
        sale_item_id: saleItemId,
        sale_id: saleId,
        product_id: productId,
        branch_id: branchId,
        quantity: qty,
        amount_bs: num(r.dinero_devuelto) ?? 0,
        actor_id: userMap[r.id_usuario] ?? DEFAULT_PROFILE,
        created_at: ts(r.fecha_devolucion) ?? undefined,
      });
      legacyIds.push(r.id_devolucion);
    }
    for (const batch of chunk(payloads)) {
      const offset = payloads.indexOf(batch[0]);
      const { data, error } = await supabase.from("sale_returns").insert(batch).select("id");
      if (error) throw new Error(`insert sale_returns: ${error.message}`);
      batch.forEach((_, j) => {
        m[legacyIds[offset + j]] = data[j].id;
      });
      note("sale_returns migradas", batch.length);
    }
    saveMap();
  }
}

// ── Traspasos ───────────────────────────────────────────────────────────────
{
  const m = mapOf("traspaso");
  const rows = (dump.traspaso?.rows ?? []).filter((r) => !m[r.id_traspaso]);
  const itemsByTransfer = new Map();
  for (const d of dump.detalle_traspaso?.rows ?? []) {
    if (!itemsByTransfer.has(d.id_traspaso)) itemsByTransfer.set(d.id_traspaso, []);
    itemsByTransfer.get(d.id_traspaso).push(d);
  }
  const historyByTransfer = new Map();
  for (const h of dump.historial_traspaso?.rows ?? []) {
    if (!historyByTransfer.has(h.id_traspaso)) historyByTransfer.set(h.id_traspaso, []);
    historyByTransfer.get(h.id_traspaso).push(h);
  }
  const TYPE = { Envio: "envio", Pedido: "pedido" };
  const VALID_STATUS = new Set(["en_cola", "enviando", "entregado", "rechazado", "cancelado"]);

  if (DRY_RUN) {
    note("transfers a crear", rows.length);
  } else {
    for (const r of rows) {
      const fromBranch = mapOf("sucursal")[r.id_sucursal_origen];
      const toBranch = mapOf("sucursal")[r.id_sucursal_destino];
      const type = TYPE[r.tipo_traspaso];
      const status = VALID_STATUS.has(r.estado_traspaso) ? r.estado_traspaso : "entregado";
      const items = (itemsByTransfer.get(r.id_traspaso) ?? [])
        .map((d) => ({
          product_id: mapOf("producto")[d.id_producto],
          quantity_requested:
            Math.max(1, Number(d.cantidad_solicitada) || Number(d.cantidad_enviada) || 1),
          quantity_sent:
            d.cantidad_enviada !== null ? Math.max(0, Number(d.cantidad_enviada)) : null,
        }))
        .filter((i) => i.product_id);
      if (!fromBranch || !toBranch || !type || items.length === 0) {
        note("traspasos huérfanos (saltados)");
        continue;
      }
      const { data, error } = await supabase
        .from("transfers")
        .insert({
          org_id: ORG_ID,
          type,
          status,
          from_branch_id: fromBranch,
          to_branch_id: toBranch,
          created_by: DEFAULT_PROFILE,
          created_at: ts(r.fecha_registro_traspaso) ?? undefined,
          updated_at: ts(r.fecha_actualizacion_traspaso) ?? undefined,
        })
        .select("id").single();
      if (error) throw new Error(`insert transfers: ${error.message}`);

      const { error: itemError } = await supabase
        .from("transfer_items")
        .insert(items.map((i) => ({ ...i, transfer_id: data.id })));
      if (itemError) throw new Error(`insert transfer_items: ${itemError.message}`);

      const history = (historyByTransfer.get(r.id_traspaso) ?? [])
        .filter((h) => VALID_STATUS.has(h.estado_historial_traspaso))
        .map((h) => ({
          transfer_id: data.id,
          status: h.estado_historial_traspaso,
          actor_id: userMap[h.id_usuario] ?? DEFAULT_PROFILE,
          created_at: ts(h.fecha_cambio_traspaso) ?? undefined,
        }));
      if (history.length > 0) {
        const { error: hError } = await supabase
          .from("transfer_status_history").insert(history);
        if (hError) console.error("transfer_status_history (no bloqueante):", hError.message);
      }
      m[r.id_traspaso] = data.id;
      note("transfers migrados");
    }
    saveMap();
  }
}

// ── Tipo de cambio de la organización ───────────────────────────────────────
if (!DRY_RUN) {
  const { error } = await supabase
    .from("organizations").update({ exchange_rate: RATE }).eq("id", ORG_ID);
  if (error) console.error("organizations.exchange_rate:", error.message);
  else console.log(`organizations.exchange_rate = ${RATE}`);
}

// ── Reporte de usuarios legacy (para crearlos a mano) ───────────────────────
{
  const personaById = new Map(
    (dump.persona?.rows ?? []).map((p) => [p.id_persona, p]),
  );
  const report = (dump.usuario?.rows ?? []).map((u) => {
    const p = personaById.get(u.id_persona);
    return {
      legacy_id_usuario: u.id_usuario,
      nombre_usuario: u.nombre_usuario,
      tipo_usuario: u.tipo_usuario,
      activo: u.estado_usuario === "1",
      sucursal_legacy: u.id_sucursal,
      persona: p
        ? [p.primer_nombre, p.segundo_nombre, p.primer_apellido, p.segundo_apellido]
            .filter((x) => x && x !== "-").join(" ")
        : null,
      cedula: p?.cedula ?? null,
    };
  });
  const reportFile = path.join(__dirname, "legacy-users-report.json");
  fs.writeFileSync(reportFile, JSON.stringify(report, null, 2));
  console.log(`Reporte de usuarios legacy → ${reportFile} (${report.length} usuarios)`);
}

// ── Resumen ─────────────────────────────────────────────────────────────────
console.log(`\n${DRY_RUN ? "=== DRY RUN (no se escribió nada) ===" : "=== Migración completada ==="}`);
for (const [k, v] of Object.entries(stats).sort()) console.log(`  ${k}: ${v}`);
if (productConversions.length > 0) {
  console.log("\nEjemplos de conversión de precios (verificación):");
  for (const s of productConversions) console.log(" ", JSON.stringify(s));
}
saveMap();
