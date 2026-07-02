import { describe, expect, it } from "vitest";
import { periodSince } from "./dashboardPeriod";

describe("periodSince", () => {
  const now = new Date("2026-07-15T12:00:00Z");

  it("returns 7 days back for '7d'", () => {
    expect(periodSince("7d", now)?.toISOString()).toBe("2026-07-08T12:00:00.000Z");
  });

  it("returns 30 days back for '30d'", () => {
    expect(periodSince("30d", now)?.toISOString()).toBe("2026-06-15T12:00:00.000Z");
  });

  it("returns the first day of the current month for 'month'", () => {
    expect(periodSince("month", now)?.toISOString()).toBe("2026-07-01T00:00:00.000Z");
  });

  it("returns null for 'all' (no date filter)", () => {
    expect(periodSince("all", now)).toBeNull();
  });
});
