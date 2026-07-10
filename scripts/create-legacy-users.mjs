#!/usr/bin/env node
// ============================================================================
// Crea cuentas placeholder (Supabase Auth + profiles) para los vendedores
// legacy activos de scripts/legacy-users-report.json, para poder reasignar
// la atribución real de ventas/movimientos (hoy todo aparece a nombre del
// perfil admin por defecto usado durante la migración).
//
// Las cuentas se crean con un email placeholder en dominio @retenes.internal
// y contraseña aleatoria: NO son para login todavía. Cuando Paulo tenga el
// email real de cada persona, se actualiza con supabase.auth.admin.updateUserById.
//
// Uso:
//   node scripts/create-legacy-users.mjs --org <uuid> --default-profile <uuid> [--dry-run]
//
// Salida: scripts/legacy-user-map.json ({ "<legacy_id_usuario>": "<uuid perfil>" })
//         scripts/legacy-user-accounts-report.json (detalle de cuentas creadas)
// ============================================================================

import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const ORG_ID = argValue("--org");
const DEFAULT_PROFILE = argValue("--default-profile");
const MAP_FILE_ARG = argValue("--map-file");
const DRY_RUN = args.includes("--dry-run");

if (!DRY_RUN && !ORG_ID) {
  console.error("Falta --org.");
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

const reportFile = path.join(__dirname, "legacy-users-report.json");
const mapFile = MAP_FILE_ARG ?? path.join(__dirname, "legacy-migration-map.json");
const report = JSON.parse(fs.readFileSync(reportFile, "utf8"));
const idMap = JSON.parse(fs.readFileSync(mapFile, "utf8"));
const sucursalMap = idMap.sucursal ?? {};

const activos = report.filter((u) => u.activo);

// Dedupe por persona (varios legacy_id_usuario del mismo login histórico
// apuntan a la misma persona real, ej. PAULO/P → mismo nombre y apellido).
function normalizePersona(p) {
  return (p ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}
function titleCase(s) {
  return s
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ")
    .split(" ")
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
function slug(s) {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, ".")
    .replace(/^\.+|\.+$/g, "");
}

const groups = new Map(); // normalizedPersona -> { fullName, legacyIds: [], tipos: Set, sucursales: Set }
for (const u of activos) {
  const key = normalizePersona(u.persona) || `usuario-${u.nombre_usuario}`;
  if (!groups.has(key)) {
    groups.set(key, {
      fullName: titleCase(u.persona || u.nombre_usuario),
      legacyIds: [],
      tipos: new Set(),
      sucursales: new Set(),
      nombresUsuario: new Set(),
    });
  }
  const g = groups.get(key);
  g.legacyIds.push(u.legacy_id_usuario);
  g.tipos.add(u.tipo_usuario);
  g.sucursales.add(u.sucursal_legacy);
  g.nombresUsuario.add(u.nombre_usuario);
}

console.log(`Usuarios legacy activos: ${activos.length} → ${groups.size} personas únicas tras dedupe.`);

let supabase = null;
let existingByName = new Map();
if (!DRY_RUN) {
  const { createClient } = await import("@supabase/supabase-js");
  supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });
  const { data: existingProfiles, error: exErr } = await supabase
    .from("profiles")
    .select("id, full_name")
    .eq("org_id", ORG_ID);
  if (exErr) throw new Error(`select profiles: ${exErr.message}`);
  existingByName = new Map((existingProfiles ?? []).map((p) => [p.full_name.trim().toLowerCase(), p.id]));
}

const userMap = {};
const accountsReport = [];

for (const [key, g] of groups) {
  const existingId = existingByName.get(g.fullName.trim().toLowerCase());
  if (!DRY_RUN && existingId) {
    console.log(`  (ya existía) ${g.fullName} → ${existingId}`);
    for (const lid of g.legacyIds) userMap[lid] = existingId;
    accountsReport.push({ fullName: g.fullName, profileId: existingId, legacyIds: g.legacyIds, alreadyExisted: true });
    continue;
  }
  const email = `legacy.${slug(g.fullName) || key}@retenes.internal`;
  // Rol: si alguno de sus logins legacy era "admin" le damos "manager" (no
  // "admin" pleno) hasta que Paulo revise; si todos eran "Ventas" → "member".
  const role = [...g.tipos].some((t) => t.toLowerCase() === "admin") ? "manager" : "member";
  // Sucursal: si vendió desde una sola sucursal legacy, se la asigna fija;
  // si vendió desde varias, se deja sin sucursal fija (null).
  const sucursalLegacy = g.sucursales.size === 1 ? [...g.sucursales][0] : null;
  const branchId = sucursalLegacy ? (sucursalMap[sucursalLegacy] ?? null) : null;
  const password = crypto.randomBytes(18).toString("base64url");

  console.log(
    `- ${g.fullName} (${[...g.nombresUsuario].join("/")}) legacy_ids=[${g.legacyIds.join(",")}] role=${role} branch=${sucursalLegacy ?? "múltiple"} email=${email}`,
  );

  if (DRY_RUN) {
    for (const lid of g.legacyIds) userMap[lid] = `dry:${key}`;
    accountsReport.push({ fullName: g.fullName, email, role, branchId, legacyIds: g.legacyIds });
    continue;
  }

  const { data: created, error: createErr } = await supabase.auth.admin.createUser({
    email,
    password,
    email_confirm: true,
    user_metadata: { full_name: g.fullName, legacy_import: true },
  });
  if (createErr || !created.user) {
    throw new Error(`auth.createUser ${email}: ${createErr?.message}`);
  }

  const { error: profErr } = await supabase.from("profiles").insert({
    id: created.user.id,
    org_id: ORG_ID,
    role,
    full_name: g.fullName,
    branch_id: branchId,
  });
  if (profErr) {
    await supabase.auth.admin.deleteUser(created.user.id);
    throw new Error(`insert profiles ${email}: ${profErr.message}`);
  }

  for (const lid of g.legacyIds) userMap[lid] = created.user.id;
  accountsReport.push({ fullName: g.fullName, email, role, branchId, profileId: created.user.id, legacyIds: g.legacyIds, password });
}

const userMapFile = path.join(__dirname, "legacy-user-map.json");
const accountsReportFile = path.join(__dirname, "legacy-user-accounts-report.json");
fs.writeFileSync(userMapFile, JSON.stringify(userMap, null, 2));
fs.writeFileSync(accountsReportFile, JSON.stringify(accountsReport, null, 2));
console.log(`\n${DRY_RUN ? "DRY RUN — nada escrito en DB." : "Cuentas creadas."}`);
console.log(`user-map → ${userMapFile}`);
console.log(`reporte de cuentas → ${accountsReportFile}`);
