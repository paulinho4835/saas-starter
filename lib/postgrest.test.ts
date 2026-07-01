import { describe, expect, it } from "vitest";
import { escapePostgrestFilterValue } from "./postgrest";

describe("escapePostgrestFilterValue", () => {
  it("escapes PostgREST-reserved characters", () => {
    expect(escapePostgrestFilterValue("a,b.c(d)e\\f")).toBe("a\\,b\\.c\\(d\\)e\\\\f");
  });

  it("leaves plain alphanumeric text untouched", () => {
    expect(escapePostgrestFilterValue("ORC5430")).toBe("ORC5430");
  });
});
