// lib/transferStatus.test.ts
import { describe, expect, it } from "vitest";
import { getTransferView, isTerminalStatus } from "./transferStatus";

describe("getTransferView", () => {
  it("pedido, destination, en_cola -> Cancelar", () => {
    expect(getTransferView("pedido", "en_cola", "destination")).toEqual({
      label: "En Cola",
      actions: [{ nextStatus: "cancelado", label: "Cancelar" }],
    });
  });

  it("pedido, destination, enviando -> Recepcionar", () => {
    expect(getTransferView("pedido", "enviando", "destination")).toEqual({
      label: "En Camino",
      actions: [{ nextStatus: "entregado", label: "Recepcionar" }],
    });
  });

  it("pedido, origin, en_cola -> Enviar o Rechazar", () => {
    expect(getTransferView("pedido", "en_cola", "origin")).toEqual({
      label: "En Cola",
      actions: [
        { nextStatus: "enviando", label: "Enviar" },
        { nextStatus: "rechazado", label: "Rechazar" },
      ],
    });
  });

  it("pedido, origin, enviando -> sin acciones (esperando al solicitante)", () => {
    expect(getTransferView("pedido", "enviando", "origin")).toEqual({
      label: "Enviando",
      actions: [],
    });
  });

  it("envio, origin, enviando -> sin acciones (esperando al receptor)", () => {
    expect(getTransferView("envio", "enviando", "origin")).toEqual({
      label: "Enviando",
      actions: [],
    });
  });

  it("envio, destination, enviando -> Recepcionar", () => {
    expect(getTransferView("envio", "enviando", "destination")).toEqual({
      label: "En Camino",
      actions: [{ nextStatus: "entregado", label: "Recepcionar" }],
    });
  });

  it("devuelve el estado crudo sin acciones para una combinación sin vista definida", () => {
    expect(getTransferView("pedido", "cancelado", "destination")).toEqual({
      label: "cancelado",
      actions: [],
    });
  });
});

describe("isTerminalStatus", () => {
  it("entregado, rechazado y cancelado son terminales", () => {
    expect(isTerminalStatus("entregado")).toBe(true);
    expect(isTerminalStatus("rechazado")).toBe(true);
    expect(isTerminalStatus("cancelado")).toBe(true);
  });

  it("en_cola y enviando no son terminales", () => {
    expect(isTerminalStatus("en_cola")).toBe(false);
    expect(isTerminalStatus("enviando")).toBe(false);
  });
});
