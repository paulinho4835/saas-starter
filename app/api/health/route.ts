import { NextResponse } from "next/server";
import { createAdminClient } from "@/lib/supabase/admin";

// Health check para monitoreo externo (UptimeRobot, etc.).
// 200 = ok, 503 = degradado. Verifica que la base de datos responda.
export async function GET() {
  const start = Date.now();
  const checks: Record<string, "ok" | "fail"> = { database: "fail" };

  try {
    const admin = createAdminClient();
    const { error } = await admin
      .from("organizations")
      .select("id", { count: "exact", head: true });
    checks.database = error ? "fail" : "ok";
  } catch {
    checks.database = "fail";
  }

  const ok = Object.values(checks).every((c) => c === "ok");
  return NextResponse.json(
    { status: ok ? "ok" : "degraded", checks, tookMs: Date.now() - start },
    { status: ok ? 200 : 503 },
  );
}
