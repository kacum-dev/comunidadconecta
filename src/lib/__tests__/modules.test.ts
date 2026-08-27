import { describe, expect, it } from "vitest";
import { moduleDefinitions, moduleKeys } from "../modules";

describe("module definitions", () => {
  it("uses only safe, unique SQL table identifiers", () => {
    const tables = moduleKeys.map((key) => moduleDefinitions[key].table);
    expect(new Set(tables).size).toBe(tables.length);
    for (const table of tables) expect(table).toMatch(/^[a-z_]+$/);
  });

  it("has complete creation metadata for writable modules", () => {
    for (const key of moduleKeys) {
      const definition = moduleDefinitions[key];
      if (definition.readOnly) continue;
      expect(definition.createLabel.length).toBeGreaterThan(3);
      expect(definition.fields.some((field) => field.key === "title" && field.required)).toBe(true);
      const statusField = definition.fields.find((field) => field.key === "status");
      expect(statusField?.options).toEqual(definition.statusOptions);
    }
  });

  it("does not duplicate form fields", () => {
    for (const key of moduleKeys) {
      const fields = moduleDefinitions[key].fields.map((field) => field.key);
      expect(new Set(fields).size).toBe(fields.length);
    }
  });

  it("uses semantic labels and exact time inputs for business moments", () => {
    for (const key of moduleKeys) {
      for (const field of moduleDefinitions[key].fields.filter((item) => item.key === "eventDate" || item.key === "dueDate")) {
        expect(field.type).toBe("datetime");
        expect(field.label).not.toMatch(/^(Fecha|Publicación|Vencimiento)$/);
      }
    }
    expect(moduleDefinitions.avisos.fields.find((field) => field.key === "eventDate")?.label).toBe("Fecha y hora de comunicación");
    expect(moduleDefinitions.economia.fields.find((field) => field.key === "eventDate")?.label).toBe("Fecha y hora de emisión");
    expect(moduleDefinitions.economia.fields.find((field) => field.key === "dueDate")).toMatchObject({ deadline: true });
  });
});
