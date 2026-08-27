import { describe, expect, it } from "vitest";
import { canCloseTransition, canTransitionItem, nextTransitionStatus } from "../transition-domain";

describe("administrator transition", () => {
  it("mantiene el orden irreversible del flujo", () => {
    expect(nextTransitionStatus("delivery")).toBe("revocation");
    expect(nextTransitionStatus("closed")).toBeNull();
  });
  it("impide reabrir un elemento aceptado", () => {
    expect(canTransitionItem("pending", "delivered")).toBe(true);
    expect(canTransitionItem("delivered", "accepted")).toBe(true);
    expect(canTransitionItem("accepted", "delivered")).toBe(false);
  });
  it("exige inventario aceptado y partes entrante/comunidad", () => {
    expect(canCloseTransition([{ status: "accepted" }], [{ partyType: "incoming", status: "accepted" }, { partyType: "community", status: "accepted" }])).toBe(true);
    expect(canCloseTransition([{ status: "reserved" }], [{ partyType: "incoming", status: "accepted" }, { partyType: "community", status: "accepted" }])).toBe(false);
  });
});
