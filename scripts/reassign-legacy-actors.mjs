#!/usr/bin/env node
// ============================================================================
// Reasigna la atribución (seller_id / actor_id) de datos YA migrados por
// migrate-legacy.mjs / migrate-legacy-movements.mjs, que quedaron todos a
// nombre del --default-profile (porque en ese momento no existía --user-map).
//
// Usa scripts/legacy-user-map.json (generado por create-legacy-users.mjs) y
// vuelve a parsear el dump original para saber, fila por fila, qué
// id_usuario legacy hizo cada venta/devolución/movimiento.
//
// - sales.seller_id            → match directo por legacy-migration-map "venta"
// - sale_returns.actor_id      → match directo por legacy-migration-map "devolucion"
// - transfer_status_history    → match por (transfer_id, status, created_at):
//                                 no hay id map por fila, se empareja por clave natural
// - stock_movements.actor_id   → match por (product_id, branch_id, created_at,
//                                 quantity_delta, resulting_quantity): historico_movimiento
//                                 no guarda su fila insertada en el mapa de idempotencia
//
// Solo toca filas cuyo actor_id/seller_id actual == --default-profile, y solo
// cuando el legacy-user-map tiene una entrada para ese id_usuario (si no,
// deja el default-profile como estaba).
//
// Uso:
//   node scripts/reassign-legacy-actors.mjs \
//     --file "C:/Users/pauli/Downloads/backup-07-09-2026.sql" \
//     --org <uuid> --default-profile <uuid> \
//     --map-file scripts/legacy-migration-map.json \
//     --user-map scripts/legacy-user-map.json \
//     [--dry-run]
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
const DEFAULT_PROFILE = argValue("--default-profile");
const MAP_FILE = argValue("--map-file");
const USER_MAP_FILE = argValue("--user-map");
const DRY_RUN = args.includes("--dry-run");

if (!FILE || !fs.existsSync(FILE)) { console.error("Falta --file."); process.exit(1); }
if (!ORG_ID || !DEFAULT_PROFILE) { console.error("Faltan --org / --default-profile."); process.exit(1); }
if (!MAP_FILE || !fs.existsSync(MAP_FILE)) { console.error("Falta --map-file."); process.exit(1); }
if (!USER_MAP_FILE || !fs.existsSync(USER_MAP_FILE)) { console.error("Falta --user-map."); process.exit(1); }

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
if (!SUPABASE_URL || !SERVICE_KEY) { console.error("Faltan env de Supabase."); process.exit(1); }

const idMap = JSON.parse(fs.readFileSync(MAP_FILE, "utf8"));
const userMap = JSON.parse(fs.readFileSync(USER_MAP_FILE, "utf8"));
function mapOf(entity) { return idMap[entity] ?? {}; }

function unescapeField(s) {
  if (s === "\\N") return null;
  let out = "";
  for (let i = 0; i < s.length; i++) {
    const c = s[i];
    if (c !== "\\") { out += c; continue; }
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
  let current = null, columns = null;
  const rl = readline.createInterface({ input: fs.createReadStream(file, { encoding: "utf8" }), crlfDelay: Infinity });
  for await (const line of rl) {
    if (current === null) {
      const m = line.match(/^COPY public\.(\w+) \(([^)]*)\) FROM stdin;$/);
      if (m) {
        current = m[1];
        if (!onlyTables || onlyTables.includes(current)) {
          columns = m[2].split(",").map((c) => c.trim().replace(/^"|"$/g, ""));
          tables[current] = { columns, rows: [] };
        } else current = "__skip__";
      }
      continue;
    }
    if (line === "\\.") { current = null; columns = null; continue; }
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

const { createClient } = await import("@supabase/supabase-js");
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

const stats = {};
function note(key, n = 1) { stats[key] = (stats[key] ?? 0) + n; }

console.log(`Parseando ${FILE} ...`);
const dump = await parseDump(FILE, ["venta", "devolucion", "historial_traspaso", "historico_movimiento", "existencia"]);

// ── 1) sales.seller_id (match directo por id de venta) ─────────────────────
{
  const mSale = mapOf("venta");
  const updatesByActor = new Map(); // profileUuid -> [saleId,...]
  for (const v of dump.venta?.rows ?? []) {
    const profileId = userMap[v.id_usuario];
    const saleId = mSale[v.id_venta];
    if (!profileId || !saleId) continue;
    if (!updatesByActor.has(profileId)) updatesByActor.set(profileId, []);
    updatesByActor.get(profileId).push(saleId);
  }
  let total = 0;
  for (const [profileId, ids] of updatesByActor) {
    for (const batch of chunk(ids, 80)) {
      total += batch.length;
      if (DRY_RUN) continue;
      const { error } = await supabase
        .from("sales")
        .update({ seller_id: profileId })
        .eq("org_id", ORG_ID)
        .eq("seller_id", DEFAULT_PROFILE)
        .in("id", batch);
      if (error) throw new Error(`update sales: ${error.message}`);
    }
  }
  note("sales.seller_id reasignadas", total);
}

// ── 2) sale_returns.actor_id (match directo por id de devolución) ──────────
{
  const mDev = mapOf("devolucion");
  const updatesByActor = new Map();
  for (const r of dump.devolucion?.rows ?? []) {
    const profileId = userMap[r.id_usuario];
    const returnId = mDev[r.id_devolucion];
    if (!profileId || !returnId) continue;
    if (!updatesByActor.has(profileId)) updatesByActor.set(profileId, []);
    updatesByActor.get(profileId).push(returnId);
  }
  let total = 0;
  for (const [profileId, ids] of updatesByActor) {
    for (const batch of chunk(ids, 80)) {
      total += batch.length;
      if (DRY_RUN) continue;
      const { error } = await supabase
        .from("sale_returns")
        .update({ actor_id: profileId })
        .eq("org_id", ORG_ID)
        .eq("actor_id", DEFAULT_PROFILE)
        .in("id", batch);
      if (error) throw new Error(`update sale_returns: ${error.message}`);
    }
  }
  note("sale_returns.actor_id reasignadas", total);
}

// ── 3) transfer_status_history.actor_id (match por clave natural) ──────────
{
  const mTraspaso = mapOf("traspaso");
  // Candidatos: (transfer_id, status, created_at) → legacy id_usuario
  const wanted = [];
  for (const h of dump.historial_traspaso?.rows ?? []) {
    const profileId = userMap[h.id_usuario];
    const transferId = mTraspaso[h.id_traspaso];
    if (!profileId || !transferId) continue;
    const createdAt = ts(h.fecha_cambio_traspaso);
    if (!createdAt) continue;
    wanted.push({ transferId, status: h.estado_historial_traspaso, createdAtMs: Date.parse(createdAt), profileId });
  }
  if (wanted.length > 0) {
    const transferIds = [...new Set(wanted.map((w) => w.transferId))];
    const existing = [];
    for (const batch of chunk(transferIds, 200)) {
      const { data, error } = await supabase
        .from("transfer_status_history")
        .select("id, transfer_id, status, created_at, actor_id")
        .eq("actor_id", DEFAULT_PROFILE)
        .in("transfer_id", batch);
      if (error) throw new Error(`select transfer_status_history: ${error.message}`);
      existing.push(...(data ?? []));
    }
    const byKey = new Map();
    for (const row of existing) {
      const key = `${row.transfer_id}|${row.status}|${Date.parse(row.created_at)}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(row.id);
    }
    const updatesByActor = new Map();
    let ambiguous = 0;
    for (const w of wanted) {
      const key = `${w.transferId}|${w.status}|${w.createdAtMs}`;
      const ids = byKey.get(key);
      if (!ids || ids.length !== 1) { if (ids && ids.length > 1) ambiguous++; continue; }
      if (!updatesByActor.has(w.profileId)) updatesByActor.set(w.profileId, []);
      updatesByActor.get(w.profileId).push(ids[0]);
    }
    let total = 0;
    for (const [profileId, ids] of updatesByActor) {
      for (const batch of chunk(ids, 80)) {
        total += batch.length;
        if (DRY_RUN) continue;
        const { error } = await supabase
          .from("transfer_status_history")
          .update({ actor_id: profileId })
          .eq("actor_id", DEFAULT_PROFILE)
          .in("id", batch);
        if (error) throw new Error(`update transfer_status_history: ${error.message}`);
      }
    }
    note("transfer_status_history.actor_id reasignadas", total);
    note("transfer_status_history ambiguas (saltadas)", ambiguous);
  }
}

// ── 4) stock_movements.actor_id (histórico, match por clave natural) ───────
{
  const producto = mapOf("producto");
  const sucursal = mapOf("sucursal");
  const existenciaById = new Map((dump.existencia?.rows ?? []).map((r) => [r.id_existencia, r]));

  const wanted = [];
  for (const r of dump.historico_movimiento?.rows ?? []) {
    const profileId = userMap[r.id_usuario];
    if (!profileId) continue;
    const ex = existenciaById.get(r.id_existencia);
    if (!ex) continue;
    const productId = producto[ex.id_producto];
    const branchId = sucursal[ex.id_sucursal];
    if (!productId || !branchId) continue;

    let movementType, quantityDelta;
    if (r.tipo_movimiento === "VENTA") {
      movementType = "venta";
      quantityDelta = -(num(r.cantidad_venta_devolucion) ?? 0);
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
    } else continue;

    const createdAt = ts(r.fecha_movimiento) ?? ts(r.created_at);
    if (!createdAt) continue;
    const resultingQty = num(r.stock_actualizado) ?? 0;
    wanted.push({
      key: `${productId}|${branchId}|${movementType}|${quantityDelta}|${resultingQty}|${Date.parse(createdAt)}`,
      profileId,
    });
  }
  console.log(`Movimientos con actor legacy conocido: ${wanted.length}`);

  const byKey = new Map();
  const PAGE = 1000;
  let offset = 0;
  for (;;) {
    const { data, error } = await supabase
      .from("stock_movements")
      .select("id, product_id, branch_id, movement_type, quantity_delta, resulting_quantity, created_at")
      .eq("org_id", ORG_ID)
      .eq("actor_id", DEFAULT_PROFILE)
      .in("movement_type", ["venta", "ajuste_manual", "alta_inicial", "devolucion"])
      .range(offset, offset + PAGE - 1);
    if (error) throw new Error(`select stock_movements: ${error.message}`);
    for (const row of data ?? []) {
      const key = `${row.product_id}|${row.branch_id}|${row.movement_type}|${row.quantity_delta}|${row.resulting_quantity}|${Date.parse(row.created_at)}`;
      if (!byKey.has(key)) byKey.set(key, []);
      byKey.get(key).push(row.id);
    }
    if (!data || data.length < PAGE) break;
    offset += PAGE;
  }
  console.log(`Filas candidatas en DB (actor default, tipos relevantes): ${[...byKey.values()].reduce((a, b) => a + b.length, 0)}`);

  const updatesByActor = new Map();
  let ambiguous = 0, notFound = 0;
  const consumed = new Set(); // evita reasignar la misma fila dos veces si dos "wanted" comparten key
  for (const w of wanted) {
    const ids = byKey.get(w.key);
    if (!ids || ids.length === 0) { notFound++; continue; }
    const availableId = ids.find((id) => !consumed.has(id));
    if (!availableId) { ambiguous++; continue; }
    if (ids.length > 1) ambiguous++; // se resuelve igual, pero se cuenta para visibilidad
    consumed.add(availableId);
    if (!updatesByActor.has(w.profileId)) updatesByActor.set(w.profileId, []);
    updatesByActor.get(w.profileId).push(availableId);
  }
  let total = 0;
  for (const [profileId, ids] of updatesByActor) {
    for (const batch of chunk(ids, 80)) {
      total += batch.length;
      if (DRY_RUN) continue;
      const { error } = await supabase
        .from("stock_movements")
        .update({ actor_id: profileId })
        .eq("actor_id", DEFAULT_PROFILE)
        .in("id", batch);
      if (error) throw new Error(`update stock_movements: ${error.message}`);
    }
  }
  note("stock_movements.actor_id reasignadas", total);
  note("stock_movements sin match en DB (saltadas)", notFound);
  note("stock_movements con clave repetida (múltiples candidatos)", ambiguous);
}

console.log(`\n${DRY_RUN ? "=== DRY RUN (no se escribió nada) ===" : "=== Reasignación completada ==="}`);
for (const [k, v] of Object.entries(stats).sort()) console.log(`  ${k}: ${v}`);
