#!/usr/bin/env node
// ============================================================================
// Renombra profiles.full_name de las cuentas legacy creadas por
// create-legacy-users.mjs, de "Nombre Real Completo" al apodo legacy
// (nombre_usuario del sistema viejo, ej. "GALI", "SHIO", "MAR") — igual que
// la columna USUARIO del reporte de ventas del sistema legacy. Necesario
// porque varias personas comparten primer nombre (3 "Shiomara" distintas),
// así que el nombre real no alcanza para distinguirlas en reportes.
//
// Uso:
//   node scripts/rename-legacy-users-to-apodo.mjs --org <uuid> [--dry-run]
// ============================================================================
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");
const args = process.argv.slice(2);
function argValue(name) {
  const i = args.indexOf(name);
  return i >= 0 ? args[i + 1] : undefined;
}
const ORG_ID = argValue("--org");
const USER_MAP_FILE = argValue("--user-map") ?? path.join(__dirname, "legacy-user-map.json");
const DRY_RUN = args.includes("--dry-run");
if (!DRY_RUN && !ORG_ID) { console.error("Falta --org."); process.exit(1); }

function loadEnvLocal() {
  const p = path.join(repoRoot, ".env.local");
  if (!fs.existsSync(p)) return;
  for (const line of fs.readFileSync(p, "utf8").split("\n")) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && !process.env[m[1]]) process.env[m[1]] = m[2].trim();
  }
}
loadEnvLocal();

const report = JSON.parse(fs.readFileSync(path.join(__dirname, "legacy-users-report.json"), "utf8"));
const userMap = JSON.parse(fs.readFileSync(USER_MAP_FILE, "utf8"));

// legacy_id_usuario → nombre_usuario
const apodoByLegacyId = new Map(report.map((u) => [u.legacy_id_usuario, u.nombre_usuario]));

// profileId → apodos vistos (para elegir el más largo/descriptivo como canónico)
const apodosByProfile = new Map();
for (const [legacyId, profileId] of Object.entries(userMap)) {
  const apodo = apodoByLegacyId.get(legacyId);
  if (!apodo) continue;
  if (!apodosByProfile.has(profileId)) apodosByProfile.set(profileId, new Set());
  apodosByProfile.get(profileId).add(apodo);
}

const renames = [];
for (const [profileId, apodos] of apodosByProfile) {
  const canonical = [...apodos].sort((a, b) => b.length - a.length)[0];
  renames.push({ profileId, canonical, apodos: [...apodos] });
}

console.log(`Perfiles a renombrar: ${renames.length}`);
for (const r of renames) console.log(`  ${r.profileId} → "${r.canonical}" (variantes: ${r.apodos.join(", ")})`);

if (DRY_RUN) { console.log("\nDRY RUN — nada escrito."); process.exit(0); }

const SUPABASE_URL = process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const { createClient } = await import("@supabase/supabase-js");
const supabase = createClient(SUPABASE_URL, SERVICE_KEY, { auth: { persistSession: false } });

for (const r of renames) {
  const { error } = await supabase
    .from("profiles")
    .update({ full_name: r.canonical })
    .eq("id", r.profileId)
    .eq("org_id", ORG_ID);
  if (error) throw new Error(`update profiles ${r.profileId}: ${error.message}`);
}
console.log("\nRenombrado completado.");
