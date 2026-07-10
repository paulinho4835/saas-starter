import { describe, expect, it, vi } from "vitest";
import { getPlatformUsage } from "./platformUsage";

function fakeAdmin(dbBytes: number | null, storageBytes: number | null) {
  return {
    rpc: vi.fn((fnName: string) => {
      if (fnName === "platform_db_size_bytes") {
        return Promise.resolve({ data: dbBytes, error: null });
      }
      if (fnName === "platform_storage_usage_bytes") {
        return Promise.resolve({ data: storageBytes, error: null });
      }
      throw new Error(`unexpected rpc: ${fnName}`);
    }),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
  } as any;
}

describe("getPlatformUsage", () => {
  it("returns db/storage bytes from the RPCs and default limits in bytes", async () => {
    vi.stubEnv("SUPABASE_FREE_DB_LIMIT_MB", "");
    vi.stubEnv("SUPABASE_FREE_STORAGE_LIMIT_MB", "");
    const admin = fakeAdmin(104_857_600, 52_428_800); // 100 MB, 50 MB
    const usage = await getPlatformUsage(admin);
    expect(usage.dbBytes).toBe(104_857_600);
    expect(usage.storageBytes).toBe(52_428_800);
    expect(usage.dbLimitBytes).toBe(500 * 1024 * 1024);
    expect(usage.storageLimitBytes).toBe(1024 * 1024 * 1024);
    vi.unstubAllEnvs();
  });

  it("reads limits from env vars when set", async () => {
    vi.stubEnv("SUPABASE_FREE_DB_LIMIT_MB", "8000");
    vi.stubEnv("SUPABASE_FREE_STORAGE_LIMIT_MB", "100000");
    const admin = fakeAdmin(0, 0);
    const usage = await getPlatformUsage(admin);
    expect(usage.dbLimitBytes).toBe(8000 * 1024 * 1024);
    expect(usage.storageLimitBytes).toBe(100_000 * 1024 * 1024);
    vi.unstubAllEnvs();
  });

  it("treats null RPC results as zero usage", async () => {
    vi.stubEnv("SUPABASE_FREE_DB_LIMIT_MB", "");
    vi.stubEnv("SUPABASE_FREE_STORAGE_LIMIT_MB", "");
    const admin = fakeAdmin(null, null);
    const usage = await getPlatformUsage(admin);
    expect(usage.dbBytes).toBe(0);
    expect(usage.storageBytes).toBe(0);
    vi.unstubAllEnvs();
  });
});
