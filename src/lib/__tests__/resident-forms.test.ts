import { describe, expect, it } from "vitest";
import { moduleDefinitions } from "../modules";
import { prepareResidentSubmission, protectResidentTaskPayload } from "../resident-forms";
import type { RecordRow } from "../records";

describe("guided resident forms", () => {
  it("builds a complete incident without exposing internal workflow fields", () => {
    const payload = prepareResidentSubmission(moduleDefinitions.incidencias, {
      kind: "water",
      location: "Portal 2",
      description: "Cae agua junto a los buzones",
      priority: "high",
      status: "closed",
      assignedTo: "Proveedor elegido por el usuario"
    }, null);

    expect(payload).toMatchObject({
      title: "Agua / humedad: Cae agua junto a los buzones",
      kind: "water",
      location: "Portal 2",
      priority: "high",
      status: "received"
    });
    expect(payload).not.toHaveProperty("assignedTo");
  });

  it("locks incident status and administrative fields again on the server boundary", () => {
    const payload = protectResidentTaskPayload(moduleDefinitions.incidencias, {
      title: "Título manipulado",
      kind: "elevator",
      description: "El ascensor está parado",
      location: "Portal A",
      priority: "urgent",
      status: "closed",
      assignedTo: "Usuario"
    }, false) as Record<string, unknown>;

    expect(payload.status).toBe("received");
    expect(payload.title).toBe("Ascensor: El ascensor está parado");
    expect(payload).not.toHaveProperty("assignedTo");
  });

  it("only allows everyday reservation fields when a resident edits a request", () => {
    const row = { id: "demo", version: 2 } as RecordRow;
    const payload = prepareResidentSubmission(moduleDefinitions.reservas, {
      kind: "community_room",
      eventDate: "2026-09-10T18:30:00",
      dueDate: "2026-09-10T20:30:00",
      description: "Cumpleaños familiar",
      location: "Sala grande",
      status: "confirmed",
      amount: 900
    }, row);

    expect(payload).toEqual({
      kind: "community_room",
      eventDate: "2026-09-10T18:30:00",
      dueDate: "2026-09-10T20:30:00",
      description: "Cumpleaños familiar",
      location: "Sala grande"
    });
  });
});
