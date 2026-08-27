import type { FieldKey, ModuleDefinition } from "./modules";
import { optionLabel } from "./modules";
import type { RecordRow } from "./records";

export type ResidentFormValues = Partial<Record<FieldKey, string | number>>;

function currentInstant() { return new Date().toISOString(); }

function shortDescription(value: ResidentFormValues["description"]) {
  const text = String(value ?? "").replace(/\s+/g, " ").trim();
  if (!text) return "Nueva solicitud";
  return text.length > 64 ? `${text.slice(0, 61).trim()}…` : text;
}

export function protectResidentTaskPayload(definition: ModuleDefinition, body: unknown, partial: boolean) {
  if (!body || typeof body !== "object" || Array.isArray(body)) return body;
  const source = body as Record<string, unknown>;
  const allowed = definition.key === "incidencias"
    ? partial ? ["kind", "description", "location", "priority"] : ["kind", "description", "location", "priority"]
    : partial ? ["kind", "eventDate", "dueDate", "description", "location"] : ["kind", "eventDate", "dueDate", "description", "location"];
  const safe: Record<string, unknown> = Object.fromEntries(allowed.filter((key) => key in source).map((key) => [key, source[key]]));
  if (!partial) {
    const kind = String(safe.kind || (definition.key === "incidencias" ? "other" : "resource"));
    const kindLabel = optionLabel(definition.fields.find((field) => field.key === "kind")?.options, kind);
    safe.kind = kind;
    safe.status = definition.key === "incidencias" ? "received" : "requested";
    safe.title = definition.key === "incidencias"
      ? `${kindLabel}: ${shortDescription(safe.description as ResidentFormValues["description"])}`.slice(0, 300)
      : `${kindLabel} · ${String(safe.eventDate || currentInstant())}`;
    if (definition.key === "incidencias") safe.eventDate = currentInstant();
  }
  return safe;
}

export function prepareResidentSubmission(definition: ModuleDefinition, values: ResidentFormValues, row: RecordRow | null) {
  if (definition.key === "incidencias") {
    const kind = String(values.kind || "other");
    const kindLabel = optionLabel(definition.fields.find((field) => field.key === "kind")?.options, kind);
    if (row) return { kind, description: values.description ?? "", location: values.location ?? "", priority: values.priority ?? "normal" };
    return {
      title: `${kindLabel}: ${shortDescription(values.description)}`.slice(0, 300),
      kind,
      status: "received",
      description: values.description ?? "",
      location: values.location ?? "",
      priority: values.priority ?? "normal",
      eventDate: currentInstant()
    };
  }

  if (definition.key === "reservas") {
    const kind = String(values.kind || "resource");
    const kindLabel = optionLabel(definition.fields.find((field) => field.key === "kind")?.options, kind);
    if (row) return { kind, eventDate: values.eventDate ?? "", dueDate: values.dueDate ?? "", description: values.description ?? "", location: values.location ?? "" };
    return {
      title: `${kindLabel} · ${String(values.eventDate || currentInstant())}`,
      kind,
      status: "requested",
      eventDate: values.eventDate || currentInstant(),
      dueDate: values.dueDate || "",
      description: values.description ?? "",
      location: values.location ?? ""
    };
  }

  return values;
}
