import type { SupabaseClient } from "@supabase/supabase-js";

const BYTES_PER_MB = 1024 * 1024;
const DEFAULT_DB_LIMIT_MB = 500;
const DEFAULT_STORAGE_LIMIT_MB = 1024;

export interface PlatformUsage {
  dbBytes: number;
  storageBytes: number;
  dbLimitBytes: number;
  storageLimitBytes: number;
}

function limitFromEnv(envVar: string | undefined, defaultMb: number): number {
  const parsed = Number(envVar);
  const mb = envVar && !Number.isNaN(parsed) && parsed > 0 ? parsed : defaultMb;
  return mb * BYTES_PER_MB;
}

export async function getPlatformUsage(
  admin: SupabaseClient,
): Promise<PlatformUsage> {
  const [dbResult, storageResult] = await Promise.all([
    admin.rpc("platform_db_size_bytes"),
    admin.rpc("platform_storage_usage_bytes"),
  ]);

  return {
    dbBytes: dbResult.data ?? 0,
    storageBytes: storageResult.data ?? 0,
    dbLimitBytes: limitFromEnv(process.env.SUPABASE_FREE_DB_LIMIT_MB, DEFAULT_DB_LIMIT_MB),
    storageLimitBytes: limitFromEnv(
      process.env.SUPABASE_FREE_STORAGE_LIMIT_MB,
      DEFAULT_STORAGE_LIMIT_MB,
    ),
  };
}
