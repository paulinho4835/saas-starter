#!/usr/bin/env node
// ============================================================================
// Migra el histórico REAL de movimientos de stock (historico_movimiento, 90k
// filas) del legacy, que migrate-legacy.mjs no trae a propósito (ver su
// comentario de cabecera). Se separa en un script aparte porque:
//   1. Reutiliza el mapa de IDs (legacy_id → uuid) ya generado por
//      migrate-legacy.mjs — no vuelve a crear productos/sucursales/etc.
//   2. Reemplaza, solo para los pares (producto, sucursal) con cobertura real
//      en el histórico, el movimiento sintético "importacion" que
//      migrate-legacy.mjs inserta como snapshot único al migrar `existencia`
//      — evita tener a la vez un "Importación" fantasma Y el ledger real.
//      Los pares SIN historico_movimiento (huecos de datos del legacy)
//      conservan su "importacion" como estaba.
//
// Uso:
//   node scripts/migrate-legacy-movements.mjs \
//     --file "C:/Users/pauli/Downloads/backup-07-09-2026.sql" \
//     --org <uuid de la organización> \
//     --map-file scripts/legacy-migration-map.json \
//     --default-actor <uuid de profiles, fallback cuando no hay --user-map> \
//     [--user-map scripts/legacy-user-map.json] \
//     [--dry-run]
//
// Mapeo tipo_movimiento (legacy) → movement_type (nuevo):
//   VENTA         → venta          (quantity_delta negativo)
//   AJUSTE-INV    → ajuste_manual  (signo según tipo_ajuste AGREGACION/REDUCCION)
//   REGISTRO-PROD → alta_inicial   (delta = stock_actualizado, primer registro)
//   DEVOLUCION    → devolucion     (quantity_delta positivo)
//
// id_detalle_venta / id_devolucion vienen NULL en el 100% de las filas reales
// del dump (verificado), así que no hay forma confiable de linkear sale_id.
// El monto de venta/devolución se preserva igual en legacy_amount_bs /
// legacy_price_tier (columnas de 0020_stock_movements_legacy_amount.sql).
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import readline from "node:readline";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const FILE = argValue("--file");
const ORG_ID = argValue("--org");
const MAP_FILE = argValue("--map-file");
const DEFAULT_ACTOR = argValue("--default-actor");
const USER_MAP_FILE = argValue("--user-map");
const DRY_RUN = args.includes("--dry-run");

if (!FILE || !fs.existsSync(FILE)) {
  console.error("Falta --file o el archivo no existe.");
  process.exit(1);
}
if (!MAP_FILE || !fs.existsSync(MAP_FILE)) {
  console.error("Falta --map-file (el legacy-migration-map.json generado por migrate-legacy.mjs).");
  process.exit(1);
}
if (!DRY_RUN && !ORG_ID) {
  console.error("Sin --dry-run se requiere --org.");
  process.exit(1);
}

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

// ── Parser de COPY (idéntico a migrate-legacy.mjs) ──────────────────────────
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
    else out += n;
  }
  return out;
}

async function parseDump(file, onlyTables) {
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
        if (!onlyTables || onlyTables.includes(current)) {
          columns = m[2].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
          tables[current] = { columns, rows: [] };
        } else {
          current = "__skip__";
        }
      }
      continue;
    }
    if (line === "\\.") {
      current = null;
      columns = null;
      continue;
    }
    if (current === "__skip__") continue;
    const fields = line.split("\t").map(unescapeField);
    const row = {};
    columns.forEach((c, i) => (row[c] = fields[i]));
    tables[current].rows.push(row);
  }
  return tables;
}

const num = (v) => (v === null || v === "" ? null : Number(v));
const ts = (v) => (v ? `${v.replace(" ", "T")}-04:00` : null);
function chunk(items, size = 500) {
  const out = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

const stats = {};
function note(key, n = 1) {
  stats[key] = (stats[key] ?? 0) + n;
}

let supabase = null;
if (!DRY_RUN) {
  const { createClient } = await import("@supabase/supabase-js");
  supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
}

const idMap = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
function mapOf(entity) {
  if (!idMap[entity]) idMap[entity] = {};
  return idMap[entity];
}
function saveMap() {
  if (!DRY_RUN) fs.writeFileSync(MAP_FILE, JSON.stringify(idMap, null, 2));
}

const userMap = USER_MAP_FILE ? JSON.parse(fs.readFileSync(USER_MAP_FILE, "utf8")) : {};

console.log(`Parseando ${FILE} (solo existencia + historico_movimiento) ...`);
const dump = await parseDump(FILE, ["existencia", "historico_movimiento"]);
note("legacy existencia", dump.existencia?.rows.length ?? 0);
note("legacy historico_movimiento", dump.historico_movimiento?.rows.length ?? 0);

// id_existencia (legacy) → { id_producto, id_sucursal } (legacy), para
// resolver historico_movimiento.id_existencia sin re-parsear producto/sucursal.
const existenciaById = new Map(
  (dump.existencia?.rows ?? []).map((r) => [r.id_existencia, r]),
);

const producto = mapOf("producto");
const sucursal = mapOf("sucursal");
const mHist = mapOf("historico_movimiento");

const coveredPairs = new Set();
const entries = [];

for (const r of dump.historico_movimiento?.rows ?? []) {
  const ex = existenciaById.get(r.id_existencia);
  if (!ex) {
    note("historico sin fila existencia (saltado)");
    continue;
  }
  const productId = producto[ex.id_producto];
  const branchId = sucursal[ex.id_sucursal];
  if (!productId || !branchId) {
    note("historico con producto/sucursal no migrado (saltado)");
    continue;
  }
  coveredPairs.add(`${productId}::${branchId}`);

  if (mHist[r.id_historico_movimiento]) continue; // ya migrado en corrida previa

  let movementType;
  let quantityDelta;
  let legacyAmount = null;
  let legacyTier = null;

  if (r.tipo_movimiento === "VENTA") {
    movementType = "venta";
    quantityDelta = -(num(r.cantidad_venta_devolucion) ?? 0);
    if (num(r.venta_cf) !== null) {
      legacyTier = "cf";
      legacyAmount = num(r.venta_cf);
    } else if (num(r.venta_sf) !== null) {
      legacyTier = "sf";
      legacyAmount = num(r.venta_sf);
    } else if (num(r.venta_may) !== null) {
      legacyTier = "may";
      legacyAmount = num(r.venta_may);
    }
  } else if (r.tipo_movimiento === "AJUSTE-INV") {
    movementType = "ajuste_manual";
    const cant = num(r.cantidad_ajuste) ?? 0;
    quantityDelta = r.tipo_ajuste === "REDUCCION" ? -cant : cant;
  } else if (r.tipo_movimiento === "REGISTRO-PROD") {
    movementType = "alta_inicial";
    quantityDelta = num(r.stock_actualizado) ?? 0;
  } else if (r.tipo_movimiento === "DEVOLUCION") {
    movementType = "devolucion";
    quantityDelta = num(r.cantidad_venta_devolucion) ?? 0;
    legacyAmount = num(r.devolucion);
  } else {
    note(`historico tipo_movimiento desconocido: ${r.tipo_movimiento} (saltado)`);
    continue;
  }

  entries.push({
    legacyId: r.id_historico_movimiento,
    payload: {
      org_id: ORG_ID,
      product_id: productId,
      branch_id: branchId,
      movement_type: movementType,
      quantity_delta: quantityDelta,
      resulting_quantity: num(r.stock_actualizado) ?? 0,
      reason: null,
      actor_id: userMap[r.id_usuario] ?? DEFAULT_ACTOR ?? null,
      legacy_amount_bs: legacyAmount,
      legacy_price_tier: legacyTier,
      created_at: ts(r.fecha_movimiento) ?? ts(r.created_at) ?? undefined,
    },
  });
}

console.log(`Pares (producto, sucursal) con histórico real: ${coveredPairs.size}`);
console.log(`Movimientos a insertar: ${entries.length}`);

if (DRY_RUN) {
  note("stock_movements (histórico) a crear", entries.length);
  console.log("\n=== DRY RUN (no se escribió nada) ===");
  for (const [k, v] of Object.entries(stats).sort()) console.log(`  ${k}: ${v}`);
  process.exit(0);
}

// ── 1) Borrar el snapshot sintético "importacion" SOLO para los pares que
// van a tener ledger real (si no, quedaría un evento fantasma duplicando la
// historia real recién insertada). Los pares sin histórico conservan el suyo.
// PostgREST trunca a 1000 filas por defecto sin .range(): paginar hasta
// agotar, si no solo se ven/borran los primeros ~1000 snapshots.
const syntheticRows = [];
for (let offset = 0; ; offset += 1000) {
  const { data, error: synErr } = await supabase
    .from("stock_movements")
    .select("id, product_id, branch_id")
    .eq("org_id", ORG_ID)
    .eq("movement_type", "importacion")
    .eq("reason", "Migración desde sistema legacy")
    .range(offset, offset + 999);
  if (synErr) throw new Error(`select stock_movements sintéticos: ${synErr.message}`);
  syntheticRows.push(...(data ?? []));
  if (!data || data.length < 1000) break;
}

const toDelete = (syntheticRows ?? [])
  .filter((r) => coveredPairs.has(`${r.product_id}::${r.branch_id}`))
  .map((r) => r.id);
console.log(`Snapshots sintéticos a reemplazar por histórico real: ${toDelete.length}`);
for (const batch of chunk(toDelete, 100)) {
  const { error } = await supabase.from("stock_movements").delete().in("id", batch);
  if (error) throw new Error(`delete stock_movements sintéticos: ${error.message}`);
}

// ── 2) Insertar el ledger real ──────────────────────────────────────────────
let inserted = 0;
for (const batch of chunk(entries)) {
  const { error } = await supabase.from("stock_movements").insert(batch.map((e) => e.payload));
  if (error) throw new Error(`insert stock_movements: ${error.message}`);
  for (const e of batch) mHist[e.legacyId] = true;
  inserted += batch.length;
  process.stdout.write(`  stock_movements históricos: ${inserted}\r`);
}
if (inserted > 0) console.log(`  stock_movements históricos: ${inserted}`);
saveMap();

console.log("\n=== Migración de histórico completada ===");
for (const [k, v] of Object.entries(stats).sort()) console.log(`  ${k}: ${v}`);
console.log(`  stock_movements históricos migrados: ${inserted}`);
console.log(`  snapshots sintéticos reemplazados: ${toDelete.length}`);
