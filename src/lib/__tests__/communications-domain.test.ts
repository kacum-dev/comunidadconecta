import { describe, expect, it } from "vitest";
import {
  communicationTimelineLabel,
  isCommunicationChannel,
  isCommunicationDirection,
  isCommunicationPriority,
  isCommunicationStatus,
  parseOccurredAt
} from "../communications-domain";

describe("communications-domain", () => {
  it("reconoce únicamente canales soportados", () => {
    expect(isCommunicationChannel("email")).toBe(true);
    expect(isCommunicationChannel("phone")).toBe(true);
    expect(isCommunicationChannel("fax")).toBe(false);
  });

  it("valida dirección, prioridad y estado", () => {
    expect(isCommunicationDirection("internal")).toBe(true);
    expect(isCommunicationDirection("unknown")).toBe(false);
    expect(isCommunicationPriority("urgent")).toBe(true);
    expect(isCommunicationStatus("resolved")).toBe(true);
  });

  it("genera una etiqueta comprensible para el expediente", () => {
    expect(communicationTimelineLabel("email", "inbound")).toBe("Correo · Entrante");
  });

  it("normaliza una fecha válida y tolera una fecha inválida", () => {
    expect(parseOccurredAt("2026-08-17T10:30:00Z")).toBe("2026-08-17T10:30:00.000Z");
    expect(Number.isNaN(new Date(parseOccurredAt("no-date")).getTime())).toBe(false);
  });
});
