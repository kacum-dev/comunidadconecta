import "server-only";

import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { withTenant } from "./db";
import { allocateFees, buildFeeOccurrencePlan, type FeeFrequency } from "./fees-domain";
import { can, isResidentRole } from "./permissions";
import { precisionForLocalDateTime, zonedLocalDateTimeToIso, type TemporalPrecision } from "./temporal";

type UnitRow = {
  id: string;
  code: string;
  coefficient: string;
  fixed_cents: string | null;
  owner_name: string | null;
  owner_email: string | null;
};

type IssueDraft = {
  name: string;
  kind: "ordinary" | "assessment";
  method: "unit_settings" | "coefficient" | "equal";
  totalCents: number;
  dueAt: string;
  duePrecision: TemporalPrecision;
  budgetId: string | null;
  scheduleId?: string | null;
  occurrenceId?: string | null;
  issuedAt: string;
  issuerUserId: string;
};

function read(context: AuthContext) {
  if (!can(context.current.role, "economia", "read")) throw new ApiError(403, "No puedes consultar presupuestos y cuotas.", "forbidden");
}
function write(context: AuthContext) {
  if (!can(context.current.role, "economia", "write")) throw new ApiError(403, "No puedes gestionar presupuestos y cuotas.", "forbidden");
}
const uuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

async function loadUnits(db: PoolClient, communityId: string, lock = false) {
  return db.query<UnitRow>(
    `SELECT unit.id::text, unit.code, unit.participation_coefficient::text AS coefficient,
            unit.fixed_quota_cents::text AS fixed_cents,
            owner.full_name AS owner_name, owner.email::text AS owner_email
       FROM private_units unit
       LEFT JOIN LATERAL (
         SELECT full_name, email FROM unit_relations
          WHERE community_id = unit.community_id AND unit_id = unit.id
            AND relation_type IN ('owner','co_owner') AND status = 'active'
          ORDER BY is_primary DESC, created_at LIMIT 1
       ) owner ON true
      WHERE unit.community_id = $1 AND unit.status = 'active'
      ORDER BY unit.code${lock ? " FOR SHARE OF unit" : ""}`,
    [communityId]
  );
}

function allocationFor(totalCents: number, method: IssueDraft["method"], units: UnitRow[]) {
  try {
    return allocateFees(totalCents, units.map((unit) => ({
      id: unit.id,
      code: unit.code,
      coefficient: Number(unit.coefficient),
      fixedCents: unit.fixed_cents === null ? null : Number(unit.fixed_cents)
    })), method);
  } catch (cause) {
    throw new ApiError(409, cause instanceof Error ? cause.message : "No se pudo repartir.", "allocation_error");
  }
}

async function insertIssuedFee(db: PoolClient, communityId: string, draft: IssueDraft) {
  const units = await loadUnits(db, communityId, true);
  const allocation = allocationFor(draft.totalCents, draft.method, units.rows);
  const issue = await db.query<{ id: string }>(
    `INSERT INTO fee_issues
      (community_id,budget_id,name,kind,calculation_method,total_cents,due_at,due_time_precision,
       due_inclusive,status,issued_at,issued_by,created_by,schedule_id,schedule_occurrence_id)
     VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,'issued',$9,$10,$10,$11,$12)
     RETURNING id::text`,
    [communityId, draft.budgetId, draft.name, draft.kind, draft.method, draft.totalCents,
      draft.dueAt, draft.duePrecision, draft.issuedAt, draft.issuerUserId,
      draft.scheduleId ?? null, draft.occurrenceId ?? null]
  );
  for (const line of allocation) {
    const source = units.rows.find((unit) => unit.id === line.id);
    const record = await db.query<{ id: string }>(
      `INSERT INTO financial_records
        (community_id,title,code,description,status,kind,amount_cents,event_at,event_time_precision,
         due_at,due_time_precision,due_inclusive,contact,location,private_unit_id,created_by,updated_by)
       VALUES($1,$2,$3,$4,'issued',$5,$6,$7,'second',$8,$9,true,$10,$11,$12,$13,$13)
       RETURNING id::text`,
      [communityId, `${draft.name} · ${line.code}`, `${issue.rows[0].id.slice(0, 8)}-${line.code}`,
        line.explanation, draft.kind === "assessment" ? "assessment" : "charge", line.amountCents,
        draft.issuedAt, draft.dueAt, draft.duePrecision, source?.owner_name ?? null, line.code, line.id, draft.issuerUserId]
    );
    await db.query(
      `INSERT INTO fee_issue_lines
        (community_id,issue_id,private_unit_id,owner_name,owner_email,coefficient,amount_cents,financial_record_id,calculation)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [communityId, issue.rows[0].id, line.id, source?.owner_name ?? null, source?.owner_email ?? null,
        line.coefficient, line.amountCents, record.rows[0].id,
        JSON.stringify({ method: draft.method, weight: draft.method === "equal" ? 1 : draft.method === "unit_settings" ? line.fixedCents ?? line.coefficient : line.coefficient, explanation: line.explanation })]
    );
  }
  if (draft.occurrenceId) {
    await db.query(
      `UPDATE fee_schedule_occurrences
          SET status='issued', fee_issue_id=$1, issued_at=$2, failure_reason=NULL
        WHERE id=$3 AND community_id=$4 AND status='planned'`,
      [issue.rows[0].id, draft.issuedAt, draft.occurrenceId, communityId]
    );
  }
  return { id: issue.rows[0].id, units: allocation.length };
}

function occurrenceTitle(name: string, dueAt: Date, timeZone: string) {
  const period = new Intl.DateTimeFormat("es-ES", { month: "long", year: "numeric", timeZone }).format(dueAt);
  return `${name} · ${period}`;
}

export async function runScheduledFees(context: AuthContext) {
  if (!can(context.current.role, "economia", "write")) return 0;
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const pending = await db.query<{
      occurrence_id: string; schedule_id: string; due_at: Date; due_time_precision: "minute" | "second";
      name: string; kind: "ordinary" | "assessment"; calculation_method: IssueDraft["method"];
      total_cents: string; budget_id: string | null; timezone: string; created_by: string | null;
    }>(
      `SELECT occurrence.id::text AS occurrence_id, schedule.id::text AS schedule_id,
              occurrence.due_at, occurrence.due_time_precision, schedule.name, schedule.kind,
              schedule.calculation_method, occurrence.total_cents::text, schedule.budget_id::text,
              schedule.timezone, schedule.created_by::text
         FROM fee_schedule_occurrences occurrence
         JOIN fee_schedules schedule ON schedule.id = occurrence.schedule_id
        WHERE occurrence.community_id = $1 AND occurrence.status = 'planned'
          AND occurrence.scheduled_issue_at <= now() AND schedule.status = 'active'
        ORDER BY occurrence.scheduled_issue_at
        LIMIT 24
        FOR UPDATE OF occurrence SKIP LOCKED`,
      [context.current.communityId]
    );
    for (const item of pending.rows) {
      const issuedAt = new Date().toISOString();
      const result = await insertIssuedFee(db, context.current.communityId, {
        name: occurrenceTitle(item.name, item.due_at, item.timezone),
        kind: item.kind,
        method: item.calculation_method,
        totalCents: Number(item.total_cents),
        dueAt: item.due_at.toISOString(),
        duePrecision: item.due_time_precision,
        budgetId: item.budget_id,
        scheduleId: item.schedule_id,
        occurrenceId: item.occurrence_id,
        issuedAt,
        issuerUserId: item.created_by ?? context.user.id
      });
      await writeAudit(db, {
        communityId: context.current.communityId,
        userId: item.created_by ?? context.user.id,
        action: "economia.recurring_fee_issued",
        resourceType: "fee_issue",
        resourceId: result.id,
        after: { scheduleId: item.schedule_id, dueAt: item.due_at.toISOString(), units: result.units },
        reason: "Generación automática de una cuota programada"
      });
    }
    return pending.rowCount ?? 0;
  });
}

export async function getFeesDashboard(context: AuthContext) {
  read(context);
  await runScheduledFees(context);
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const resident = isResidentRole(context.current.role);
    const budgets = resident ? { rows: [] } : await db.query(
      `SELECT budget.id::text,budget.name,budget.fiscal_year,budget.status,
              COALESCE(sum(line.amount_cents),0)::text AS total_cents,count(line.id)::int AS line_count
         FROM finance_budgets budget
         LEFT JOIN finance_budget_lines line ON line.budget_id=budget.id
        WHERE budget.community_id=$1 GROUP BY budget.id
        ORDER BY budget.fiscal_year DESC,budget.created_at DESC`,
      [context.current.communityId]
    );
    const issues = resident ? await db.query(
      `SELECT issue.id::text,issue.name,issue.kind,issue.calculation_method,
              COALESCE(sum(line.amount_cents),0)::text AS total_cents,issue.due_at,
              issue.due_time_precision,issue.due_inclusive,issue.status,issue.issued_at,
              count(line.id)::int AS unit_count,COALESCE(sum(line.amount_cents),0)::text AS allocated_cents,
              schedule.frequency,issue.schedule_id::text
         FROM fee_issues issue
         JOIN fee_issue_lines line ON line.issue_id=issue.id
         LEFT JOIN fee_schedules schedule ON schedule.id=issue.schedule_id
        WHERE issue.community_id=$1 AND EXISTS (
          SELECT 1 FROM unit_relations relation
           WHERE relation.community_id=issue.community_id AND relation.unit_id=line.private_unit_id
             AND relation.user_id=$2 AND relation.status='active'
             AND relation.valid_from<=current_date AND (relation.valid_to IS NULL OR relation.valid_to>=current_date)
        )
        GROUP BY issue.id,schedule.frequency ORDER BY issue.due_at DESC,issue.created_at DESC`,
      [context.current.communityId, context.user.id]
    ) : await db.query(
      `SELECT issue.id::text,issue.name,issue.kind,issue.calculation_method,issue.total_cents::text,
              issue.due_at,issue.due_time_precision,issue.due_inclusive,issue.status,issue.issued_at,
              count(line.id)::int AS unit_count,COALESCE(sum(line.amount_cents),0)::text AS allocated_cents,
              schedule.frequency,issue.schedule_id::text
         FROM fee_issues issue
         LEFT JOIN fee_issue_lines line ON line.issue_id=issue.id
         LEFT JOIN fee_schedules schedule ON schedule.id=issue.schedule_id
        WHERE issue.community_id=$1 GROUP BY issue.id,schedule.frequency
        ORDER BY issue.due_at DESC,issue.created_at DESC`,
      [context.current.communityId]
    );
    const annual = await db.query<{ generated_cents: string; paid_cents: string }>(
      `SELECT COALESCE(sum(line.amount_cents),0)::text AS generated_cents,
              COALESCE(sum(line.amount_cents) FILTER (WHERE record.status='paid'),0)::text AS paid_cents
         FROM fee_issue_lines line
         JOIN fee_issues issue ON issue.id=line.issue_id AND issue.community_id=line.community_id
         LEFT JOIN financial_records record ON record.id=line.financial_record_id
        WHERE line.community_id=$1 AND issue.status='issued'
          AND extract(year FROM issue.due_at AT TIME ZONE $2)=extract(year FROM now() AT TIME ZONE $2)
          AND ($3::boolean=false OR EXISTS (
            SELECT 1 FROM unit_relations relation
             WHERE relation.community_id=line.community_id AND relation.unit_id=line.private_unit_id
               AND relation.user_id=$4 AND relation.status='active'
               AND relation.valid_from<=current_date AND (relation.valid_to IS NULL OR relation.valid_to>=current_date)
          ))`,
      [context.current.communityId, context.current.timeZone, resident, context.user.id]
    );
    const plannedRows = await db.query<{
      total_cents: string; calculation_method: IssueDraft["method"];
    }>(
      `SELECT occurrence.total_cents::text,schedule.calculation_method
         FROM fee_schedule_occurrences occurrence
         JOIN fee_schedules schedule ON schedule.id=occurrence.schedule_id
        WHERE occurrence.community_id=$1 AND occurrence.status='planned' AND schedule.status='active'
          AND extract(year FROM occurrence.due_at AT TIME ZONE $2)=extract(year FROM now() AT TIME ZONE $2)`,
      [context.current.communityId, context.current.timeZone]
    );
    let plannedCents = plannedRows.rows.reduce((sum, row) => sum + Number(row.total_cents), 0);
    if (resident && plannedRows.rowCount) {
      const homes = await db.query<{ id: string }>(
        `SELECT DISTINCT unit_id::text AS id FROM unit_relations
          WHERE community_id=$1 AND user_id=$2 AND status='active'
            AND valid_from<=current_date AND (valid_to IS NULL OR valid_to>=current_date)`,
        [context.current.communityId, context.user.id]
      );
      const homeIds = new Set(homes.rows.map((row) => row.id));
      const units = await loadUnits(db, context.current.communityId);
      plannedCents = plannedRows.rows.reduce((sum, row) => {
        try {
          return sum + allocationFor(Number(row.total_cents), row.calculation_method, units.rows)
            .filter((line) => homeIds.has(line.id)).reduce((subtotal, line) => subtotal + line.amountCents, 0);
        } catch { return sum; }
      }, 0);
    }
    const schedules = resident ? { rows: [] } : await db.query(
      `SELECT schedule.id::text,schedule.name,schedule.frequency,schedule.total_cents::text,
              schedule.status,schedule.issue_lead_days,schedule.ends_on,
              min(occurrence.due_at) FILTER (WHERE occurrence.status='planned') AS next_due_at,
              count(occurrence.id) FILTER (WHERE occurrence.status='planned')::int AS planned_count
         FROM fee_schedules schedule
         LEFT JOIN fee_schedule_occurrences occurrence ON occurrence.schedule_id=schedule.id
        WHERE schedule.community_id=$1 GROUP BY schedule.id ORDER BY schedule.created_at DESC`,
      [context.current.communityId]
    );
    const generatedCents = Number(annual.rows[0]?.generated_cents ?? 0);
    const paidCents = Number(annual.rows[0]?.paid_cents ?? 0);
    return {
      budgets: budgets.rows,
      issues: issues.rows,
      schedules: schedules.rows,
      annualForecast: {
        year: Number(new Intl.DateTimeFormat("en", { year: "numeric", timeZone: context.current.timeZone }).format(new Date())),
        scope: resident ? "home" : "community",
        generatedCents,
        paidCents,
        pendingCents: Math.max(0, generatedCents - paidCents),
        plannedCents,
        estimatedCents: generatedCents + plannedCents
      }
    };
  });
}

export async function createBudget(context: AuthContext, input: Record<string, unknown>, userAgent?: string | null) {
  write(context);
  const name = String(input.name || "").trim();
  const fiscalYear = Number(input.fiscalYear);
  const lines = Array.isArray(input.lines) ? input.lines as Array<{ category?: string; description?: string; amount?: number }> : [];
  if (name.length < 2 || !Number.isInteger(fiscalYear) || fiscalYear < 2000 || fiscalYear > 2200 || lines.length === 0) throw new ApiError(400, "Presupuesto no válido.", "validation_error");
  const normalized = lines.map((line) => ({ category: String(line.category || "general").trim(), description: String(line.description || "").trim(), amountCents: Math.round(Number(line.amount || 0) * 100) }));
  if (normalized.some((line) => line.description.length < 2 || !Number.isInteger(line.amountCents) || line.amountCents < 0)) throw new ApiError(400, "Revisa las partidas del presupuesto.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const budget = await db.query<{ id: string }>("INSERT INTO finance_budgets(community_id,name,fiscal_year,created_by) VALUES($1,$2,$3,$4) RETURNING id::text", [context.current.communityId, name, fiscalYear, context.user.id]);
    for (const line of normalized) await db.query("INSERT INTO finance_budget_lines(community_id,budget_id,category,description,amount_cents) VALUES($1,$2,$3,$4,$5)", [context.current.communityId, budget.rows[0].id, line.category, line.description, line.amountCents]);
    await writeAudit(db, { communityId: context.current.communityId, userId: context.user.id, action: "economia.budget_created", resourceType: "finance_budget", resourceId: budget.rows[0].id, after: { name, fiscalYear, lines: normalized.length }, userAgent });
    return budget.rows[0];
  });
}

export async function approveBudget(context: AuthContext, id: string, userAgent?: string | null) {
  write(context);
  if (!uuid(id)) throw new ApiError(400, "Presupuesto no válido.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const result = await db.query<{ status: string }>(`UPDATE finance_budgets SET status='approved',approved_at=now(),approved_by=$3 WHERE id=$1 AND community_id=$2 AND status='draft' RETURNING status`, [id, context.current.communityId, context.user.id]);
    if (!result.rowCount) throw new ApiError(409, "El presupuesto no está en borrador.", "invalid_state");
    await writeAudit(db, { communityId: context.current.communityId, userId: context.user.id, action: "economia.budget_approved", resourceType: "finance_budget", resourceId: id, after: { status: "approved" }, userAgent });
    return result.rows[0];
  });
}

export async function previewFeeIssue(context: AuthContext, input: Record<string, unknown>) {
  write(context);
  const totalCents = Math.round(Number(input.total || 0) * 100);
  const method = String(input.method || "coefficient") as IssueDraft["method"];
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || !["unit_settings","coefficient","equal"].includes(method)) throw new ApiError(400, "Reparto no válido.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const units = await loadUnits(db, context.current.communityId);
    const allocation = allocationFor(totalCents, method, units.rows);
    return allocation.map((line) => ({ ...line, ownerName: units.rows.find((unit) => unit.id === line.id)?.owner_name || "Sin titular", ownerEmail: units.rows.find((unit) => unit.id === line.id)?.owner_email || null }));
  });
}

export async function issueFees(context: AuthContext, input: Record<string, unknown>, userAgent?: string | null) {
  write(context);
  const name = String(input.name || "").trim();
  const kind = String(input.kind || "ordinary") as IssueDraft["kind"];
  const method = String(input.method || "coefficient") as IssueDraft["method"];
  const totalCents = Math.round(Number(input.total || 0) * 100);
  const dueInput = String(input.dueAt || input.dueDate || "");
  const dueAt = zonedLocalDateTimeToIso(dueInput, context.current.timeZone) ?? (/(?:Z|[+-]\d{2}:?\d{2})$/.test(dueInput) && !Number.isNaN(new Date(dueInput).getTime()) ? new Date(dueInput).toISOString() : null);
  const duePrecision = dueAt ? precisionForLocalDateTime(dueInput) : null;
  const budgetId = String(input.budgetId || "");
  const recurrence = String(input.recurrence || "once") as "once" | FeeFrequency;
  const issueLeadDays = Number(input.issueLeadDays ?? 10);
  const endsOn = String(input.endsOn || "").trim() || null;
  if (name.length < 2 || !["ordinary","assessment"].includes(kind) || !["unit_settings","coefficient","equal"].includes(method) || !Number.isSafeInteger(totalCents) || totalCents <= 0 || !dueAt || new Date(dueAt) <= new Date() || (budgetId && !uuid(budgetId)) || !["once","monthly","quarterly","yearly"].includes(recurrence)) {
    throw new ApiError(400, "La emisión necesita un vencimiento futuro con fecha y hora exactas.", "validation_error");
  }
  if (recurrence !== "once" && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2})?$/.test(dueInput)) {
    throw new ApiError(400, "La serie necesita la primera fecha y hora en el horario de la comunidad.", "validation_error");
  }
  let plan = [] as ReturnType<typeof buildFeeOccurrencePlan>;
  if (recurrence !== "once") {
    try {
      plan = buildFeeOccurrencePlan(dueInput, recurrence, issueLeadDays, endsOn, recurrence === "monthly" ? 24 : recurrence === "quarterly" ? 12 : 5);
    } catch (cause) {
      throw new ApiError(400, cause instanceof Error ? cause.message : "La periodicidad no es válida.", "validation_error");
    }
    if (!plan.length) throw new ApiError(400, "La fecha final no permite crear ninguna cuota.", "validation_error");
  }
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    if (budgetId) {
      const budget = await db.query("SELECT 1 FROM finance_budgets WHERE id=$1 AND community_id=$2 AND status='approved'", [budgetId, context.current.communityId]);
      if (!budget.rowCount) throw new ApiError(409, "El presupuesto debe pertenecer a la comunidad y estar aprobado.", "invalid_budget");
    }
    const issuedAt = new Date().toISOString();
    let scheduleId: string | null = null;
    let firstOccurrenceId: string | null = null;
    if (recurrence !== "once") {
      const schedule = await db.query<{ id: string }>(
        `INSERT INTO fee_schedules
          (community_id,budget_id,name,kind,calculation_method,total_cents,frequency,first_due_at,
           first_due_local,issue_lead_days,ends_on,timezone,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13) RETURNING id::text`,
        [context.current.communityId, budgetId || null, name, kind, method, totalCents, recurrence,
          dueAt, dueInput.length === 16 ? `${dueInput}:00` : dueInput, issueLeadDays, endsOn, context.current.timeZone, context.user.id]
      );
      scheduleId = schedule.rows[0].id;
      for (const occurrence of plan) {
        const occurrenceDueAt = zonedLocalDateTimeToIso(occurrence.dueLocal, context.current.timeZone);
        const occurrenceIssueAt = occurrence.number === 1 ? issuedAt : zonedLocalDateTimeToIso(occurrence.issueLocal, context.current.timeZone);
        if (!occurrenceDueAt || !occurrenceIssueAt) throw new ApiError(409, "Una fecha de la serie no existe en la zona horaria configurada.", "invalid_schedule_time");
        const row = await db.query<{ id: string }>(
          `INSERT INTO fee_schedule_occurrences
            (community_id,schedule_id,occurrence_number,scheduled_issue_at,due_at,due_time_precision,total_cents,status)
           VALUES($1,$2,$3,$4,$5,$6,$7,'planned') RETURNING id::text`,
          [context.current.communityId, scheduleId, occurrence.number, occurrenceIssueAt, occurrenceDueAt, duePrecision, totalCents]
        );
        if (occurrence.number === 1) firstOccurrenceId = row.rows[0].id;
      }
    }
    const result = await insertIssuedFee(db, context.current.communityId, {
      name, kind, method, totalCents, dueAt, duePrecision: duePrecision ?? "minute",
      budgetId: budgetId || null, scheduleId, occurrenceId: firstOccurrenceId, issuedAt, issuerUserId: context.user.id
    });
    await writeAudit(db, {
      communityId: context.current.communityId,
      userId: context.user.id,
      action: scheduleId ? "economia.recurring_fees_created" : "economia.fees_issued",
      resourceType: scheduleId ? "fee_schedule" : "fee_issue",
      resourceId: scheduleId ?? result.id,
      after: { name, kind, method, totalCents, units: result.units, issuedAt, dueAt, dueInclusive: true, timeZone: context.current.timeZone, recurrence, issueLeadDays, endsOn, plannedOccurrences: Math.max(0, plan.length - 1) },
      userAgent
    });
    return { ...result, scheduleId, plannedOccurrences: Math.max(0, plan.length - 1) };
  });
}
