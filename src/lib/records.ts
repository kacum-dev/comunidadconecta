import "server-only";

import type { PoolClient } from "pg";
import { syncFinancialRecordAccounting, type AutomaticFinancialRecord } from "./accounting-automation";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { withTenant } from "./db";
import { type FieldDefinition, type FieldKey, type ModuleDefinition, type ModuleKey, optionLabel } from "./modules";
import { can, isResidentRole, needsResidentUnitScope } from "./permissions";
import { getMeetingLifecycleBatch, lifecycleSummary } from "./governance-lifecycle";
import type { MeetingLifecycleSummary } from "./governance-types";
import { protectResidentTaskPayload } from "./resident-forms";
import { formatBusinessMoment, formatDateTime, precisionForLocalDateTime, zonedLocalDateTimeToIso, type TemporalPrecision, type TemporalPreferences } from "./temporal";

export interface RecordRow {
  id: string;
  title: string;
  code: string | null;
  description: string | null;
  status: string;
  kind: string;
  amount: number | null;
  eventDate: string | null;
  dueDate: string | null;
  eventTimePrecision: TemporalPrecision | null;
  dueTimePrecision: TemporalPrecision | null;
  dueInclusive: boolean;
  paidAt: string | null;
  paidTimePrecision: "minute" | "second" | null;
  contact: string | null;
  location: string | null;
  priority: string | null;
  assignedTo: string | null;
  version: number;
  archivedAt: string | null;
  createdAt: string;
  updatedAt: string;
  hasFile?: boolean;
  lifecycle?: MeetingLifecycleSummary;
}

export interface ListInput {
  search?: string;
  status?: string;
  page?: number;
  pageSize?: number;
  sort?: "title" | "status" | "updatedAt" | "eventDate" | "amount";
  direction?: "asc" | "desc";
}

export interface ListResult {
  rows: RecordRow[];
  total: number;
  page: number;
  pageSize: number;
}

const fieldColumns: Record<FieldKey, string> = {
  title: "title",
  code: "code",
  description: "description",
  status: "status",
  kind: "kind",
  amount: "amount_cents",
  eventDate: "event_at",
  dueDate: "due_at",
  contact: "contact",
  location: "location",
  priority: "priority",
  assignedTo: "assigned_to"
};

const baseSelectColumns = `
  id::text, title, code, description, status, kind, amount_cents,
  event_date, due_date, event_at, due_at, event_time_precision, due_time_precision, due_inclusive,
  contact, location, priority, assigned_to,
  version, archived_at, created_at, updated_at`;

function selectColumnsFor(definition: ModuleDefinition) {
  return `${baseSelectColumns}${definition.key === "economia" ? ", paid_at, paid_time_precision" : ""}`;
}

function iso(value: Date | string | null | undefined) {
  if (!value) return null;
  if (value instanceof Date) return value.toISOString();
  return String(value);
}

function normalizeRow(row: Record<string, unknown>): RecordRow {
  return {
    id: String(row.id),
    title: String(row.title ?? ""),
    code: row.code ? String(row.code) : null,
    description: row.description ? String(row.description) : null,
    status: String(row.status ?? "active"),
    kind: String(row.kind ?? "general"),
    amount: row.amount_cents === null || row.amount_cents === undefined ? null : Number(row.amount_cents) / 100,
    eventDate: iso(row.event_at as Date | string | null),
    dueDate: iso(row.due_at as Date | string | null),
    eventTimePrecision: row.event_time_precision ? String(row.event_time_precision) as TemporalPrecision : null,
    dueTimePrecision: row.due_time_precision ? String(row.due_time_precision) as TemporalPrecision : null,
    dueInclusive: row.due_inclusive !== false,
    paidAt: iso(row.paid_at as Date | string | null),
    paidTimePrecision: row.paid_time_precision ? String(row.paid_time_precision) as "minute" | "second" : null,
    contact: row.contact ? String(row.contact) : null,
    location: row.location ? String(row.location) : null,
    priority: row.priority ? String(row.priority) : null,
    assignedTo: row.assigned_to ? String(row.assigned_to) : null,
    version: Number(row.version ?? 1),
    archivedAt: iso(row.archived_at as Date | string | null),
    createdAt: iso(row.created_at as Date | string) ?? "",
    updatedAt: iso(row.updated_at as Date | string) ?? ""
  };
}

function automaticFinancialRecord(row: Record<string, unknown>): AutomaticFinancialRecord {
  return {
    id: String(row.id),
    title: String(row.title ?? "Registro económico"),
    code: row.code ? String(row.code) : null,
    kind: String(row.kind ?? "charge"),
    status: String(row.status ?? "pending"),
    amountCents: Number(row.amount_cents ?? 0),
    paidAt: (row.paid_at as string | Date | null) ?? null,
    version: Number(row.version ?? 1),
  };
}

function normalizeAuditRow(row: Record<string, unknown>): RecordRow {
  const createdAt = iso(row.created_at as Date | string) ?? "";
  return {
    id: String(row.id),
    title: String(row.action),
    code: row.resource_type ? String(row.resource_type) : null,
    description: row.reason ? String(row.reason) : "Evento registrado sin copiar datos sensibles.",
    status: String(row.result ?? "success"),
    kind: String(row.resource_type ?? "resource"),
    amount: null,
    eventDate: createdAt,
    dueDate: null,
    eventTimePrecision: "second",
    dueTimePrecision: null,
    dueInclusive: true,
    paidAt: null,
    paidTimePrecision: null,
    contact: row.actor_name ? String(row.actor_name) : "Sistema",
    location: row.resource_id ? String(row.resource_id) : null,
    priority: null,
    assignedTo: null,
    version: 1,
    archivedAt: null,
    createdAt,
    updatedAt: createdAt
  };
}

function auditState(row: RecordRow) {
  return {
    id: row.id,
    title: row.title,
    code: row.code,
    kind: row.kind,
    status: row.status,
    version: row.version,
    archived: Boolean(row.archivedAt)
  };
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

async function listAudit(client: PoolClient, context: AuthContext, input: ListInput): Promise<ListResult> {
  const page = boundedInt(input.page, 1, 1, 100_000);
  const pageSize = boundedInt(input.pageSize, 25, 1, 100);
  const params: unknown[] = [context.current.communityId];
  const where = ["a.community_id = $1"];

  if (input.search?.trim()) {
    params.push(`%${input.search.trim().slice(0, 120)}%`);
    where.push(`concat_ws(' ', a.action, a.resource_type, a.resource_id, a.reason, u.full_name) ILIKE $${params.length}`);
  }
  if (input.status) {
    params.push(input.status);
    where.push(`a.result = $${params.length}`);
  }

  const totalResult = await client.query<{ total: number }>(
    `SELECT count(*)::int AS total
       FROM audit_events a
       LEFT JOIN app_users u ON u.id = a.actor_user_id
      WHERE ${where.join(" AND ")}`,
    params
  );

  params.push(pageSize, (page - 1) * pageSize);
  const rowsResult = await client.query(
    `SELECT a.id::text, a.action, a.resource_type, a.resource_id, a.result, a.reason,
            a.created_at, u.full_name AS actor_name
       FROM audit_events a
       LEFT JOIN app_users u ON u.id = a.actor_user_id
      WHERE ${where.join(" AND ")}
      ORDER BY a.created_at ${input.direction === "asc" ? "ASC" : "DESC"}
      LIMIT $${params.length - 1} OFFSET $${params.length}`,
    params
  );

  return { rows: rowsResult.rows.map(normalizeAuditRow), total: totalResult.rows[0].total, page, pageSize };
}

export async function listRecords(
  context: AuthContext,
  definition: ModuleDefinition,
  input: ListInput
): Promise<ListResult> {
  if (!can(context.current.role, definition.key, "read")) {
    throw new ApiError(403, "No tienes permiso para consultar este módulo.", "forbidden");
  }

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    if (definition.key === "auditoria") return listAudit(client, context, input);

    const page = boundedInt(input.page, 1, 1, 100_000);
    const pageSize = boundedInt(input.pageSize, 25, 1, 100);
    const params: unknown[] = [context.current.communityId];
    const where = ["community_id = $1", "archived_at IS NULL"];

    if (needsResidentUnitScope(context.current.role, definition.key)) {
      params.push(context.user.id);
      const userParam = `$${params.length}`;
      const ownUnit = `EXISTS (SELECT 1 FROM unit_relations visible_unit
        WHERE visible_unit.community_id = $1 AND visible_unit.user_id = ${userParam}
          AND visible_unit.unit_id = ${definition.table}.private_unit_id
          AND visible_unit.status = 'active' AND visible_unit.valid_from <= current_date
          AND (visible_unit.valid_to IS NULL OR visible_unit.valid_to >= current_date))`;
      if (definition.key === "economia") where.push(ownUnit);
      if (definition.key === "incidencias" || definition.key === "reservas") where.push(`(created_by = ${userParam} OR ${ownUnit})`);
      if (definition.key === "documentos") {
        const audiences = context.current.role === "owner" ? "('community','owners','residents')" : "('community','residents')";
        where.push(`(${ownUnit} OR (private_unit_id IS NULL AND COALESCE(data->>'audience','community') IN ${audiences}))`);
      }
    }

    if (input.search?.trim()) {
      params.push(`%${input.search.trim().slice(0, 120)}%`);
      where.push(`concat_ws(' ', title, code, description, contact, location, assigned_to) ILIKE $${params.length}`);
    }
    if (input.status) {
      params.push(input.status);
      where.push(`status = $${params.length}`);
    }

    const totalResult = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM ${definition.table} WHERE ${where.join(" AND ")}`,
      params
    );

    const sortMap = {
      title: "title",
      status: "status",
      updatedAt: "updated_at",
      eventDate: "event_at",
      amount: "amount_cents"
    } as const;
    const sortColumn = sortMap[input.sort ?? "updatedAt"];
    const direction = input.direction === "asc" ? "ASC" : "DESC";

    params.push(pageSize, (page - 1) * pageSize);
    const rowsResult = await client.query(
      `SELECT ${selectColumnsFor(definition)}
         FROM ${definition.table}
        WHERE ${where.join(" AND ")}
        ORDER BY ${sortColumn} ${direction} NULLS LAST, id DESC
        LIMIT $${params.length - 1} OFFSET $${params.length}`,
      params
    );

    const rows = rowsResult.rows.map(normalizeRow);
    if (definition.key === "documentos" && rows.length) {
      const ids = rows.map((row) => row.id);
      const versions = await client.query<{ document_id: string }>(
        `SELECT DISTINCT document_id::text FROM document_versions
          WHERE community_id = $1 AND document_id = ANY($2::uuid[])`,
        [context.current.communityId, ids]
      );
      const withFiles = new Set(versions.rows.map((row) => row.document_id));
      rows.forEach((row) => { row.hasFile = withFiles.has(row.id); });
    }
    if (definition.key === "juntas" && rows.length) {
      const lifecycleByMeeting = await getMeetingLifecycleBatch(client, context.current.communityId, rows.map((row) => row.id), context.current.timeZone);
      rows.forEach((row) => {
        const lifecycle = lifecycleByMeeting.get(row.id);
        if (lifecycle) row.lifecycle = lifecycleSummary(lifecycle);
      });
    }

    return { rows, total: totalResult.rows[0].total, page, pageSize };
  });
}

function sanitizeText(value: unknown, maxLength: number, required: boolean, label: string) {
  const text = typeof value === "string" ? value.trim() : "";
  if (required && !text) throw new ApiError(400, `${label} es obligatorio.`, "validation_error");
  if (text.length > maxLength) throw new ApiError(400, `${label} es demasiado largo.`, "validation_error");
  return text || null;
}

function parseField(field: FieldDefinition, value: unknown, timeZone: string) {
  if (field.type === "currency") {
    if ((value === null || value === "" || value === undefined) && !field.required) return null;
    const amount = typeof value === "number" ? value : Number(String(value).replace(",", "."));
    if (!Number.isFinite(amount) || Math.abs(amount) > 999_999_999) {
      throw new ApiError(400, `${field.label} no es un importe válido.`, "validation_error");
    }
    return Math.round(amount * 100);
  }

  if (field.type === "date") {
    if ((value === null || value === "" || value === undefined) && !field.required) return null;
    const text = sanitizeText(value, 10, Boolean(field.required), field.label);
    if (text && !/^\d{4}-\d{2}-\d{2}$/.test(text)) {
      throw new ApiError(400, `${field.label} no es una fecha válida.`, "validation_error");
    }
    return text;
  }

  if (field.type === "datetime") {
    if ((value === null || value === "" || value === undefined) && !field.required) return null;
    const text = sanitizeText(value, 40, Boolean(field.required), field.label);
    if (!text) return null;
    const zoned = zonedLocalDateTimeToIso(text, timeZone);
    const direct = /(?:Z|[+-]\d{2}:?\d{2})$/.test(text) ? new Date(text) : null;
    const result = zoned ?? (direct && !Number.isNaN(direct.getTime()) ? direct.toISOString() : null);
    if (!result) throw new ApiError(400, `${field.label} no contiene una fecha y hora válidas para ${timeZone}.`, "validation_error");
    return result;
  }

  if (field.type === "select") {
    const text = sanitizeText(value, 80, Boolean(field.required), field.label);
    if (text && field.options && !field.options.some((item) => item.value === text)) {
      throw new ApiError(400, `${field.label} contiene una opción no válida.`, "validation_error");
    }
    return text;
  }

  return sanitizeText(value, field.type === "textarea" ? 5000 : 300, Boolean(field.required), field.label);
}

function parsePayload(definition: ModuleDefinition, body: unknown, partial: boolean, timeZone: string, before?: RecordRow) {
  if (!body || typeof body !== "object" || Array.isArray(body)) {
    throw new ApiError(400, "Los datos enviados no son válidos.", "validation_error");
  }

  const source = body as Record<string, unknown>;
  const values: Array<{ column: string; value: unknown }> = [];
  for (const field of definition.fields) {
    if (partial && !(field.key in source)) continue;
    const fallback = !partial && field.type === "select" ? field.options?.[0]?.value : undefined;
    const rawValue = source[field.key] ?? fallback;
    const parsedValue = parseField(field, rawValue, timeZone);
    values.push({ column: fieldColumns[field.key], value: parsedValue });
    if (field.type === "datetime" && (field.key === "eventDate" || field.key === "dueDate")) {
      const currentValue = field.key === "eventDate" ? before?.eventDate : before?.dueDate;
      const currentPrecision = field.key === "eventDate" ? before?.eventTimePrecision : before?.dueTimePrecision;
      const sameMoment = Boolean(parsedValue && currentValue && parsedValue === currentValue);
      const rawText = String(rawValue);
      const inputPrecision = parsedValue ? /(?:Z|[+-]\d{2}:?\d{2})$/.test(rawText) ? "second" : precisionForLocalDateTime(rawText) : null;
      values.push({
        column: field.key === "eventDate" ? "event_time_precision" : "due_time_precision",
        value: sameMoment ? currentPrecision : inputPrecision
      });
      if (field.key === "dueDate") values.push({ column: "due_inclusive", value: field.inclusive !== false });
    }
  }
  const eventAt = values.find((item) => item.column === "event_at")?.value ?? before?.eventDate;
  const dueAt = values.find((item) => item.column === "due_at")?.value ?? before?.dueDate;
  if (eventAt && dueAt && new Date(String(dueAt)).getTime() <= new Date(String(eventAt)).getTime()) {
    throw new ApiError(400, "La fecha y hora límite debe ser posterior a la fecha y hora inicial.", "validation_error");
  }
  return values;
}

export async function createRecord(
  context: AuthContext,
  definition: ModuleDefinition,
  body: unknown,
  userAgent?: string | null
) {
  if (definition.readOnly || !can(context.current.role, definition.key, "write")) {
    throw new ApiError(403, "No tienes permiso para crear registros en este módulo.", "forbidden");
  }
  const taskForResident = isResidentRole(context.current.role) && (definition.key === "incidencias" || definition.key === "reservas");
  const safeBody = taskForResident ? protectResidentTaskPayload(definition, body, false) : body;
  if (taskForResident && definition.key === "incidencias" && (!(safeBody as Record<string, unknown>)?.description || String((safeBody as Record<string, unknown>).description).trim().length < 5)) {
    throw new ApiError(400, "Cuéntanos brevemente qué está ocurriendo.", "validation_error");
  }
  const values = parsePayload(definition, safeBody, false, context.current.timeZone);

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const columns = ["community_id", ...values.map((item) => item.column), "created_by", "updated_by"];
    const params = [context.current.communityId, ...values.map((item) => item.value), context.user.id, context.user.id];
    if (taskForResident) {
      const unit = await client.query<{ unit_id: string }>(
        `SELECT unit_id::text FROM unit_relations WHERE community_id = $1 AND user_id = $2
          AND status = 'active' AND valid_from <= current_date AND (valid_to IS NULL OR valid_to >= current_date)
          ORDER BY is_primary DESC LIMIT 1`,
        [context.current.communityId, context.user.id]
      );
      if (!unit.rowCount) throw new ApiError(409, "Tu acceso no está vinculado a una vivienda activa.", "unit_required");
      columns.push("private_unit_id");
      params.push(unit.rows[0].unit_id);
    }
    if (definition.key === "aprobaciones") {
      columns.push("proposed_by");
      params.push(context.user.id);
    }
    if (definition.key === "economia" && values.some((item) => item.column === "status" && item.value === "paid")) {
      columns.push("paid_at", "paid_time_precision");
      params.push(new Date().toISOString(), "second");
    }
    const placeholders = params.map((_, index) => `$${index + 1}`);
    const result = await client.query(
      `INSERT INTO ${definition.table} (${columns.join(", ")})
       VALUES (${placeholders.join(", ")})
       RETURNING ${selectColumnsFor(definition)}`,
      params
    );
    const rawRow = result.rows[0] as Record<string, unknown>;
    if (definition.key === "economia") {
      await syncFinancialRecordAccounting(client, {
        communityId: context.current.communityId,
        userId: context.user.id,
        userAgent,
      }, null, automaticFinancialRecord(rawRow));
    }
    const row = normalizeRow(rawRow);
    await writeAudit(client, {
      communityId: context.current.communityId,
      userId: context.user.id,
      action: `${definition.key}.created`,
      resourceType: definition.key,
      resourceId: row.id,
      after: auditState(row),
      userAgent
    });
    return row;
  });
}

export async function updateRecord(
  context: AuthContext,
  definition: ModuleDefinition,
  id: string,
  body: unknown,
  userAgent?: string | null
) {
  if (definition.readOnly || !can(context.current.role, definition.key, "write")) {
    throw new ApiError(403, "No tienes permiso para modificar este registro.", "forbidden");
  }
  if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400, "Identificador no válido.", "validation_error");
  if (!body || typeof body !== "object" || Array.isArray(body)) throw new ApiError(400, "Los datos no son válidos.");
  const source = body as Record<string, unknown>;
  const expectedVersion = Number(source.version);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 1) {
    throw new ApiError(400, "Falta la versión del registro.", "validation_error");
  }
  const taskForResident = isResidentRole(context.current.role) && (definition.key === "incidencias" || definition.key === "reservas");
  if (taskForResident && source.restore === true) throw new ApiError(403, "No puedes restaurar una solicitud archivada.", "forbidden");

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const beforeResult = await client.query(
      `SELECT *, id::text FROM ${definition.table} WHERE id = $1 AND community_id = $2 LIMIT 1`,
      [id, context.current.communityId]
    );
    if (!beforeResult.rowCount) throw new ApiError(404, "El registro no existe.", "not_found");
    const beforeRaw = beforeResult.rows[0] as Record<string, unknown>;
    const before = normalizeRow(beforeRaw);
    if (taskForResident && String(beforeRaw.created_by ?? "") !== context.user.id) {
      throw new ApiError(403, "Solo puedes modificar los registros que has creado.", "forbidden");
    }

    if (source.restore === true) {
      const restored = await client.query(
        `UPDATE ${definition.table}
            SET archived_at = NULL, updated_by = $3, version = version + 1
          WHERE id = $1 AND community_id = $2 AND version = $4
          RETURNING ${selectColumnsFor(definition)}`,
        [id, context.current.communityId, context.user.id, expectedVersion]
      );
      if (!restored.rowCount) throw new ApiError(409, "El registro cambió antes de poder restaurarlo.", "version_conflict");
      const restoredRaw = restored.rows[0] as Record<string, unknown>;
      if (definition.key === "economia") {
        const restoredRecord = automaticFinancialRecord(restoredRaw);
        await syncFinancialRecordAccounting(client, {
          communityId: context.current.communityId,
          userId: context.user.id,
          userAgent,
        }, { ...restoredRecord, status: "returned", version: Math.max(1, restoredRecord.version - 1) }, restoredRecord);
      }
      const row = normalizeRow(restoredRaw);
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: `${definition.key}.restored`, resourceType: definition.key, resourceId: id, before: auditState(before), after: auditState(row), userAgent });
      return row;
    }

    if (before.archivedAt) throw new ApiError(409, "El registro está archivado.", "archived");
    const values = parsePayload(definition, taskForResident ? protectResidentTaskPayload(definition, body, true) : body, true, context.current.timeZone, before);
    if (!values.length) throw new ApiError(400, "No hay cambios que guardar.", "validation_error");

    const requestedStatus = values.find((item) => item.column === "status")?.value;
    let decisionColumns = "";
    if (definition.key === "aprobaciones" && (requestedStatus === "approved" || requestedStatus === "rejected")) {
      if (!can(context.current.role, definition.key, "approve")) {
        throw new ApiError(403, "No tienes permiso para decidir esta aprobación.", "forbidden");
      }
      if (beforeRaw.proposed_by && String(beforeRaw.proposed_by) === context.user.id) {
        throw new ApiError(409, "La misma persona no puede proponer y aprobar esta operación.", "segregation_required");
      }
      decisionColumns = ", decided_by = $DECIDER, decided_at = now()";
    }
    if (definition.key === "economia" && requestedStatus === "paid" && before.status !== "paid") {
      decisionColumns += ", paid_at = now(), paid_time_precision = 'second'";
    } else if (definition.key === "economia" && requestedStatus && requestedStatus !== "paid" && before.status === "paid") {
      decisionColumns += ", paid_at = NULL, paid_time_precision = NULL";
    }

    const params: unknown[] = [];
    const sets = values.map((item) => {
      params.push(item.value);
      return `${item.column} = $${params.length}`;
    });
    params.push(context.user.id);
    const userParam = params.length;
    if (decisionColumns) decisionColumns = decisionColumns.replace("$DECIDER", `$${userParam}`);
    params.push(id, context.current.communityId, expectedVersion);
    const idParam = params.length - 2;
    const communityParam = params.length - 1;
    const versionParam = params.length;

    const result = await client.query(
      `UPDATE ${definition.table}
          SET ${sets.join(", ")}, updated_by = $${userParam}, version = version + 1${decisionColumns}
        WHERE id = $${idParam} AND community_id = $${communityParam} AND version = $${versionParam} AND archived_at IS NULL
        RETURNING ${selectColumnsFor(definition)}`,
      params
    );
    if (!result.rowCount) throw new ApiError(409, "Otra persona ha modificado el registro. Actualiza la tabla.", "version_conflict");
    const resultRaw = result.rows[0] as Record<string, unknown>;
    if (definition.key === "economia") {
      await syncFinancialRecordAccounting(client, {
        communityId: context.current.communityId,
        userId: context.user.id,
        userAgent,
      }, automaticFinancialRecord(beforeRaw), automaticFinancialRecord(resultRaw));
    }
    const row = normalizeRow(resultRaw);
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: `${definition.key}.updated`, resourceType: definition.key, resourceId: id, before: auditState(before), after: auditState(row), userAgent });
    return row;
  });
}

export async function archiveRecord(
  context: AuthContext,
  definition: ModuleDefinition,
  id: string,
  version: number,
  userAgent?: string | null
) {
  if (definition.readOnly || !can(context.current.role, definition.key, "archive")) {
    throw new ApiError(403, "No tienes permiso para archivar este registro.", "forbidden");
  }
  if (!/^[0-9a-f-]{36}$/i.test(id) || !Number.isInteger(version)) {
    throw new ApiError(400, "Identificador o versión no válidos.", "validation_error");
  }

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const beforeResult = await client.query(
      `SELECT ${selectColumnsFor(definition)} FROM ${definition.table}
        WHERE id = $1 AND community_id = $2 AND archived_at IS NULL LIMIT 1`,
      [id, context.current.communityId]
    );
    if (!beforeResult.rowCount) throw new ApiError(404, "El registro no existe o ya está archivado.", "not_found");
    const before = normalizeRow(beforeResult.rows[0]);
    const result = await client.query(
      `UPDATE ${definition.table}
          SET archived_at = now(), updated_by = $3, version = version + 1
        WHERE id = $1 AND community_id = $2 AND version = $4 AND archived_at IS NULL
        RETURNING ${selectColumnsFor(definition)}`,
      [id, context.current.communityId, context.user.id, version]
    );
    if (!result.rowCount) throw new ApiError(409, "Otra persona ha modificado el registro. Actualiza la tabla.", "version_conflict");
    const archivedRaw = result.rows[0] as Record<string, unknown>;
    if (definition.key === "economia") {
      const beforeRecord = automaticFinancialRecord(beforeResult.rows[0] as Record<string, unknown>);
      const archivedRecord = automaticFinancialRecord(archivedRaw);
      await syncFinancialRecordAccounting(client, {
        communityId: context.current.communityId,
        userId: context.user.id,
        userAgent,
      }, beforeRecord, { ...archivedRecord, status: "returned" });
    }
    const row = normalizeRow(archivedRaw);
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: `${definition.key}.archived`, resourceType: definition.key, resourceId: id, before: auditState(before), after: auditState(row), userAgent });
    return row;
  });
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export function recordsToCsv(definition: ModuleDefinition, rows: RecordRow[], preferences: TemporalPreferences) {
  const eventField = definition.fields.find((field) => field.key === "eventDate");
  const dueField = definition.fields.find((field) => field.key === "dueDate");
  const headers = ["Título", "Referencia", "Tipo", "Estado", "Descripción", "Importe", eventField?.label ?? "Fecha y hora", dueField?.label ?? "Fecha y hora límite", "Contacto", "Ubicación", "Prioridad", "Responsable", `Última actualización (${preferences.timeZone})`];
  const lines = rows.map((row) => [
    row.title,
    row.code,
    optionLabel(definition.fields.find((field) => field.key === "kind")?.options, row.kind),
    optionLabel(definition.statusOptions, row.status),
    row.description,
    row.amount,
    row.eventDate ? formatBusinessMoment(row.eventDate, row.eventTimePrecision, preferences) : null,
    row.dueDate ? formatBusinessMoment(row.dueDate, row.dueTimePrecision, preferences, { deadline: dueField?.deadline, inclusive: dueField?.inclusive ?? row.dueInclusive }) : null,
    row.contact,
    row.location,
    row.priority,
    row.assignedTo,
    formatDateTime(row.updatedAt, preferences)
  ].map(csvCell).join(";"));
  return `\uFEFF${headers.map(csvCell).join(";")}\r\n${lines.join("\r\n")}`;
}

export async function allRecordsForExport(context: AuthContext, definition: ModuleDefinition, search?: string, status?: string) {
  if (!can(context.current.role, definition.key, "export")) {
    throw new ApiError(403, "No tienes permiso para exportar este módulo.", "forbidden");
  }
  const first = await listRecords(context, definition, { search, status, page: 1, pageSize: 100 });
  if (first.total <= 100) return first.rows;

  const pages = Math.ceil(first.total / 100);
  const rows = [...first.rows];
  for (let page = 2; page <= pages; page += 1) {
    const result = await listRecords(context, definition, { search, status, page, pageSize: 100 });
    rows.push(...result.rows);
  }
  return rows;
}

export function moduleActionAllowed(context: AuthContext, module: ModuleKey, action: "write" | "archive" | "export") {
  return can(context.current.role, module, action);
}
