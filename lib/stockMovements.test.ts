import { describe, expect, it } from "vitest";
import { movementTypeLabel, MOVEMENT_TYPES } from "./stockMovements";

describe("movementTypeLabel", () => {
  it("returns the Spanish label for each movement type", () => {
    expect(movementTypeLabel("alta_inicial")).toBe("Alta inicial");
    expect(movementTypeLabel("importacion")).toBe("Importación");
    expect(movementTypeLabel("ajuste_manual")).toBe("Ajuste manual");
    expect(movementTypeLabel("venta")).toBe("Venta");
  });

  it("has one label for every declared movement type", () => {
    for (const type of MOVEMENT_TYPES) {
      expect(movementTypeLabel(type).length).toBeGreaterThan(0);
    }
  });
});
