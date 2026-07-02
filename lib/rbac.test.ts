import { describe, expect, it } from "vitest";
import { canSeeNav } from "./rbac";

describe("canSeeNav", () => {
  it("allows a module in the role's whitelist when there is no override", () => {
    expect(canSeeNav("admin", "productos")).toBe(true);
  });

  it("allows a module in the role's whitelist when the override is null", () => {
    expect(canSeeNav("admin", "productos", null)).toBe(true);
  });

  it("denies a module outside the role's whitelist even if the override includes it", () => {
    expect(canSeeNav("viewer", "ventas", ["ventas"])).toBe(false);
  });

  it("denies a module allowed by the role but excluded by the override", () => {
    expect(canSeeNav("admin", "productos", ["dashboard"])).toBe(false);
  });

  it("allows a module allowed by both the role and the override", () => {
    expect(canSeeNav("member", "productos", ["productos", "dashboard"])).toBe(true);
  });

  it("returns false without a role", () => {
    expect(canSeeNav(undefined, "dashboard")).toBe(false);
  });
});
