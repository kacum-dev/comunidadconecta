import "server-only";

import type { PoolClient } from "pg";
import type { AuthContext } from "./auth";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import {
  AccountingInputError,
  DEFAULT_ACCOUNTING_ACCOUNTS,
  DEFAULT_ACCOUNTING_JOURNALS,
  calculateAccountingMetrics,
  parseAccountingCommand,
  type AccountingCommand,
  type AccountingEntryDraft,
} from "./accounting-domain";
import { withTenant } from "./db";
import { can, canUseAccounting } from "./permissions";

const identifierPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const templateAccountCodes = new Set(DEFAULT_ACCOUNTING_ACCOUNTS.map((account) => account.code));

function requireRead(context: AuthContext) {
  if (!can(context.current.role, "economia", "read") || !canUseAccounting(context.current.role)) {
    throw new ApiError(403, "No tienes acceso a la contabilidad.", "forbidden");
  }
}

function requirePrepare(context: AuthContext) {
  if (!can(context.current.role, "economia", "write")) {
    throw new ApiError(403, "No tienes permiso para preparar la contabilidad.", "forbidden");
  }
}

function canPost(context: AuthContext) {
  return ["president", "treasurer", "platform_admin"].includes(context.current.role);
}

function requirePost(context: AuthContext) {
  if (!canPost(context)) {
    throw new ApiError(403, "Solo Presidencia, Tesorería o Plataforma puede contabilizar y revertir asientos.", "forbidden");
  }
}

function canClose(context: AuthContext) {
  return ["president", "platform_admin"].includes(context.current.role);
}

function requireClose(context: AuthContext) {
  if (!canClose(context)) {
    throw new ApiError(403, "Solo Presidencia o Plataforma puede cerrar un ejercicio.", "forbidden");
  }
}

export async function ensureAccountingFoundation(client: PoolClient, communityId: string) {
  await client.query(
    `INSERT INTO accounting_accounts (community_id, code, name, account_type, normal_side, system_key)
     SELECT $1, item.code, item.name, item.account_type, item.normal_side, item.system_key
       FROM jsonb_to_recordset($2::jsonb) AS item(
         code text, name text, account_type text, normal_side text, system_key text
       )
     ON CONFLICT (community_id, code) DO NOTHING`,
    [
      communityId,
      JSON.stringify(DEFAULT_ACCOUNTING_ACCOUNTS.map((account) => ({
        code: account.code,
        name: account.name,
        account_type: account.accountType,
        normal_side: account.normalSide,
        system_key: account.systemKey,
      }))),
    ]
  );
  await client.query(
    `INSERT INTO accounting_journals (community_id, code, name, kind)
     SELECT $1, item.code, item.name, item.kind
       FROM jsonb_to_recordset($2::jsonb) AS item(code text, name text, kind text)
     ON CONFLICT (community_id, code) DO NOTHING`,
    [
      communityId,
      JSON.stringify(DEFAULT_ACCOUNTING_JOURNALS.map(([code, name, kind]) => ({ code, name, kind }))),
    ]
  );
}

export async function ensureAccountingPeriod(client: PoolClient, communityId: string, userId: string, targetDate = new Date().toISOString().slice(0, 10)) {
  const current = await client.query<{ id: string }>(
    `SELECT id::text
       FROM accounting_periods
      WHERE community_id = $1 AND status = 'open' AND $2::date BETWEEN starts_on AND ends_on
      ORDER BY starts_on DESC
      LIMIT 1`,
    [communityId, targetDate]
  );
  if (current.rowCount) return current.rows[0].id;

  const existing = await client.query<{ status: string }>(
    `SELECT status FROM accounting_periods
      WHERE community_id = $1 AND $2::date BETWEEN starts_on AND ends_on
      ORDER BY starts_on DESC LIMIT 1`,
    [communityId, targetDate]
  );
  if (existing.rowCount) {
    throw new ApiError(409, "El ejercicio correspondiente a la fecha del movimiento está cerrado.", "accounting_period_closed");
  }

  const fiscal = await client.query<{ fiscal_year_start_month: number }>(
    "SELECT fiscal_year_start_month FROM community_app_settings WHERE community_id = $1",
    [communityId]
  );
  const startMonth = Number(fiscal.rows[0]?.fiscal_year_start_month ?? 1);
  const parsed = new Date(`${targetDate}T00:00:00Z`);
  const startYear = parsed.getUTCMonth() + 1 >= startMonth ? parsed.getUTCFullYear() : parsed.getUTCFullYear() - 1;
  const startsOn = `${startYear}-${String(startMonth).padStart(2, "0")}-01`;
  const endDate = new Date(Date.UTC(startYear + 1, startMonth - 1, 0));
  const endsOn = endDate.toISOString().slice(0, 10);
  const name = startMonth === 1 ? `Ejercicio ${startYear}` : `Ejercicio ${startYear}/${startYear + 1}`;
  const created = await client.query<{ id: string }>(
    `INSERT INTO accounting_periods (community_id, name, starts_on, ends_on, created_by)
     VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (community_id, starts_on, ends_on)
     DO UPDATE SET name = EXCLUDED.name
     RETURNING id::text`,
    [communityId, name, startsOn, endsOn, userId]
  );
  return created.rows[0].id;
}

export async function accountingIsEnabled(client: PoolClient, communityId: string) {
  const result = await client.query<{ accounting_enabled: boolean }>(
    "SELECT accounting_enabled FROM community_app_settings WHERE community_id = $1",
    [communityId]
  );
  return result.rows[0]?.accounting_enabled === true;
}

async function requireAccountingEnabled(client: PoolClient, communityId: string) {
  if (!await accountingIsEnabled(client, communityId)) {
    throw new ApiError(409, "La contabilidad está desactivada para esta comunidad. Administración puede activarla en Configuración.", "accounting_disabled");
  }
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function getAccountingDashboard(context: AuthContext, requestedPeriodId?: string | null) {
  requireRead(context);
  if (requestedPeriodId && !identifierPattern.test(requestedPeriodId)) {
    throw new ApiError(400, "El ejercicio seleccionado no es válido.", "invalid_period");
  }

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    await requireAccountingEnabled(client, context.current.communityId);
    await ensureAccountingFoundation(client, context.current.communityId);
    await ensureAccountingPeriod(client, context.current.communityId, context.user.id);

    const periodsResult = await client.query(
      `SELECT id::text, name, starts_on::text AS "startsOn", ends_on::text AS "endsOn",
              status, locked_through::text AS "lockedThrough", closed_at AS "closedAt"
         FROM accounting_periods
        WHERE community_id = $1
        ORDER BY starts_on DESC`,
      [context.current.communityId]
    );
    const periods = periodsResult.rows as Array<{ id: string; status: string; startsOn: string; endsOn: string }>;
    const selectedPeriod = requestedPeriodId
      ? periods.find((period) => period.id === requestedPeriodId)
      : periods.find((period) => period.status === "open" && period.startsOn <= new Date().toISOString().slice(0, 10) && period.endsOn >= new Date().toISOString().slice(0, 10))
        ?? periods.find((period) => period.status === "open")
        ?? periods[0];
    if (requestedPeriodId && !selectedPeriod) throw new ApiError(404, "El ejercicio seleccionado no existe.", "period_not_found");
    const periodId = selectedPeriod?.id ?? null;

    // `withTenant` aporta un único cliente transaccional: las consultas deben
    // ejecutarse en secuencia para no solaparlas sobre la misma conexión.
    const accountsResult = await client.query(
        `SELECT id::text, code, name, account_type AS "accountType", normal_side AS "normalSide",
                parent_id::text AS "parentId", level, accepts_entries AS "acceptsEntries", active,
                system_key AS "systemKey"
           FROM accounting_accounts
          WHERE community_id = $1
          ORDER BY code`,
        [context.current.communityId]
      );
    const journalsResult = await client.query(
        `SELECT id::text, code, name, kind, active
           FROM accounting_journals
          WHERE community_id = $1
          ORDER BY active DESC, code`,
        [context.current.communityId]
      );
    const entriesResult = await client.query(
        `SELECT e.id::text, e.period_id::text AS "periodId", e.journal_id::text AS "journalId",
                e.entry_number::text AS "entryNumber", e.entry_date::text AS "entryDate",
                e.document_date::text AS "documentDate", e.concept, e.reference, e.status,
                e.created_by::text AS "createdBy", creator.full_name AS "createdByName",
                e.submitted_by::text AS "submittedBy", submitter.full_name AS "submittedByName",
                e.submitted_at AS "submittedAt", e.posted_by::text AS "postedBy",
                poster.full_name AS "postedByName", e.posted_at AS "postedAt",
                e.created_at AS "createdAt", e.reversal_of_id::text AS "reversalOfId",
                e.reversed_by_entry_id::text AS "reversedByEntryId", e.source_type AS "sourceType",
                e.source_id::text AS "sourceId", j.code AS "journalCode",
                COALESCE(sum(l.debit_cents), 0)::numeric / 100 AS debit,
                COALESCE(sum(l.credit_cents), 0)::numeric / 100 AS credit,
                COALESCE(
                  jsonb_agg(
                    jsonb_build_object(
                      'id', l.id::text,
                      'lineNumber', l.line_number,
                      'accountId', a.id::text,
                      'accountCode', a.code,
                      'accountName', a.name,
                      'description', l.description,
                      'debit', l.debit_cents::numeric / 100,
                      'credit', l.credit_cents::numeric / 100
                    ) ORDER BY l.line_number
                  ) FILTER (WHERE l.id IS NOT NULL),
                  '[]'::jsonb
                ) AS lines
           FROM accounting_entries e
           JOIN accounting_journals j ON j.id = e.journal_id
           LEFT JOIN accounting_entry_lines l ON l.entry_id = e.id
           LEFT JOIN accounting_accounts a ON a.id = l.account_id
           LEFT JOIN app_users creator ON creator.id = e.created_by
           LEFT JOIN app_users submitter ON submitter.id = e.submitted_by
           LEFT JOIN app_users poster ON poster.id = e.posted_by
          WHERE e.community_id = $1 AND ($2::uuid IS NULL OR e.period_id = $2)
          GROUP BY e.id, j.code, creator.full_name, submitter.full_name, poster.full_name
          ORDER BY e.entry_date DESC, e.created_at DESC
          LIMIT 250`,
        [context.current.communityId, periodId]
      );
    const balancesResult = await client.query(
        `SELECT a.id::text, a.code, a.name, a.account_type AS "accountType",
                a.normal_side AS "normalSide", a.active,
                COALESCE(sum(CASE WHEN e.id IS NOT NULL THEN l.debit_cents ELSE 0 END), 0)::numeric / 100 AS debit,
                COALESCE(sum(CASE WHEN e.id IS NOT NULL THEN l.credit_cents ELSE 0 END), 0)::numeric / 100 AS credit,
                COALESCE(sum(CASE WHEN e.id IS NOT NULL THEN l.debit_cents - l.credit_cents ELSE 0 END), 0)::numeric / 100 AS balance
           FROM accounting_accounts a
           LEFT JOIN accounting_entry_lines l ON l.account_id = a.id
           LEFT JOIN accounting_entries e
             ON e.id = l.entry_id AND e.status = 'posted' AND ($2::uuid IS NULL OR e.period_id = $2)
          WHERE a.community_id = $1
          GROUP BY a.id
          ORDER BY a.code`,
        [context.current.communityId, periodId]
      );
    const statsResult = await client.query<{ draft: number; review: number; posted: number }>(
        `SELECT count(*) FILTER (WHERE status = 'draft')::int AS draft,
                count(*) FILTER (WHERE status = 'review')::int AS review,
                count(*) FILTER (WHERE status = 'posted')::int AS posted
           FROM accounting_entries
          WHERE community_id = $1 AND ($2::uuid IS NULL OR period_id = $2)`,
        [context.current.communityId, periodId]
      );

    const accounts = accountsResult.rows.map((account) => ({ ...account, isTemplate: templateAccountCodes.has(String(account.code)) }));
    const trialBalance = balancesResult.rows as Array<{ code: string; accountType: string; balance: string | number }>;
    const metrics = calculateAccountingMetrics(trialBalance);
    return {
      periods: periodsResult.rows,
      selectedPeriodId: periodId,
      accounts,
      journals: journalsResult.rows,
      entries: entriesResult.rows,
      trialBalance: balancesResult.rows,
      metrics,
      stats: statsResult.rows[0],
      chart: {
        templateAccounts: DEFAULT_ACCOUNTING_ACCOUNTS.length,
        totalAccounts: accounts.length,
        activeAccounts: accounts.filter((account) => account.active).length,
        customAccounts: accounts.filter((account) => !account.isTemplate).length,
      },
      capabilities: {
        write: can(context.current.role, "economia", "write"),
        post: canPost(context),
        close: canClose(context),
        export: can(context.current.role, "economia", "export"),
      },
    };
  });
}

export async function exportAccountingCsv(context: AuthContext, periodId?: string | null) {
  if (!can(context.current.role, "economia", "export")) {
    throw new ApiError(403, "No tienes permiso para exportar la contabilidad.", "forbidden");
  }
  const dashboard = await getAccountingDashboard(context, periodId);
  const headers = ["Código", "Cuenta", "Tipo", "Debe", "Haber", "Saldo"];
  const rows = dashboard.trialBalance.map((row) => [row.code, row.name, row.accountType, row.debit, row.credit, row.balance]);
  return `\uFEFF${headers.map(csvCell).join(";")}\r\n${rows.map((row) => row.map(csvCell).join(";")).join("\r\n")}`;
}

async function validateEntryReferences(client: PoolClient, context: AuthContext, draft: AccountingEntryDraft) {
  const period = await client.query(
    `SELECT id
       FROM accounting_periods
      WHERE id = $1 AND community_id = $2 AND status = 'open'
        AND $3::date BETWEEN starts_on AND ends_on
        AND (locked_through IS NULL OR $3::date > locked_through)
      FOR SHARE`,
    [draft.periodId, context.current.communityId, draft.entryDate]
  );
  if (!period.rowCount) throw new ApiError(409, "El ejercicio no está abierto para la fecha indicada.", "period_closed");

  const journal = await client.query(
    `SELECT id FROM accounting_journals WHERE id = $1 AND community_id = $2 AND active = true`,
    [draft.journalId, context.current.communityId]
  );
  if (!journal.rowCount) throw new ApiError(400, "El diario seleccionado no está disponible.", "invalid_journal");

  const accountIds = [...new Set(draft.lines.map((line) => line.accountId))];
  const accounts = await client.query<{ id: string }>(
    `SELECT id::text
       FROM accounting_accounts
      WHERE community_id = $1 AND id = ANY($2::uuid[]) AND active = true AND accepts_entries = true`,
    [context.current.communityId, accountIds]
  );
  if (accounts.rowCount !== accountIds.length) {
    throw new ApiError(400, "Alguna cuenta no pertenece a la comunidad, está inactiva o no admite apuntes.", "invalid_account");
  }
}

async function insertEntryLines(client: PoolClient, context: AuthContext, entryId: string, draft: AccountingEntryDraft) {
  for (const [index, line] of draft.lines.entries()) {
    await client.query(
      `INSERT INTO accounting_entry_lines
        (community_id, entry_id, line_number, account_id, description, debit_cents, credit_cents)
       VALUES ($1, $2, $3, $4, $5, $6, $7)`,
      [context.current.communityId, entryId, index + 1, line.accountId, line.description ?? draft.concept, line.debitCents, line.creditCents]
    );
  }
}

function entryAudit(command: AccountingEntryDraft) {
  return {
    periodId: command.periodId,
    journalId: command.journalId,
    entryDate: command.entryDate,
    concept: command.concept,
    reference: command.reference,
    lineCount: command.lines.length,
    debitCents: command.debitCents,
    creditCents: command.creditCents,
  };
}

async function createEntry(client: PoolClient, context: AuthContext, command: Extract<AccountingCommand, { action: "create_entry" }>) {
  await validateEntryReferences(client, context, command);
  const entry = await client.query<{ id: string }>(
    `INSERT INTO accounting_entries
      (community_id, period_id, journal_id, entry_date, document_date, concept, reference, created_by)
     VALUES ($1, $2, $3, $4, $4, $5, $6, $7)
     RETURNING id::text`,
    [context.current.communityId, command.periodId, command.journalId, command.entryDate, command.concept, command.reference, context.user.id]
  );
  await insertEntryLines(client, context, entry.rows[0].id, command);
  return entry.rows[0].id;
}

async function parseCommand(input: unknown) {
  try {
    return parseAccountingCommand(input);
  } catch (error) {
    if (error instanceof AccountingInputError) throw new ApiError(400, error.message, "invalid_accounting_input");
    throw error;
  }
}

export async function executeAccountingCommand(context: AuthContext, input: unknown) {
  requireRead(context);
  const command = await parseCommand(input);

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    await requireAccountingEnabled(client, context.current.communityId);
    await ensureAccountingFoundation(client, context.current.communityId);

    if (command.action === "create_period") {
      requirePrepare(context);
      await client.query("SELECT pg_advisory_xact_lock(hashtext('accounting_periods:' || $1))", [context.current.communityId]);
      const overlap = await client.query(
        `SELECT 1
           FROM accounting_periods
          WHERE community_id = $1
            AND daterange(starts_on, ends_on, '[]') && daterange($2::date, $3::date, '[]')
          LIMIT 1`,
        [context.current.communityId, command.startsOn, command.endsOn]
      );
      if (overlap.rowCount) throw new ApiError(409, "Las fechas se solapan con otro ejercicio.", "period_overlap");
      const result = await client.query<{ id: string }>(
        `INSERT INTO accounting_periods (community_id, name, starts_on, ends_on, created_by)
         VALUES ($1, $2, $3, $4, $5)
         RETURNING id::text`,
        [context.current.communityId, command.name, command.startsOn, command.endsOn, context.user.id]
      );
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "accounting.period.create", resourceType: "accounting_period", resourceId: result.rows[0].id, after: command });
      return { id: result.rows[0].id };
    }

    if (command.action === "create_account") {
      requirePrepare(context);
      let level = 1;
      if (command.parentId) {
        const parent = await client.query<{ level: number }>(
          `SELECT level FROM accounting_accounts WHERE id = $1 AND community_id = $2 AND active = true`,
          [command.parentId, context.current.communityId]
        );
        if (!parent.rowCount) throw new ApiError(400, "La cuenta superior no está disponible.", "invalid_parent_account");
        level = parent.rows[0].level + 1;
        if (level > 8) throw new ApiError(400, "El plan no admite más niveles para esta cuenta.", "account_level_limit");
      }
      const result = await client.query<{ id: string }>(
        `INSERT INTO accounting_accounts
          (community_id, code, name, account_type, normal_side, parent_id, level)
         VALUES ($1, $2, $3, $4, $5, $6, $7)
         RETURNING id::text`,
        [context.current.communityId, command.code, command.name, command.accountType, command.normalSide, command.parentId, level]
      );
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "accounting.account.create", resourceType: "accounting_account", resourceId: result.rows[0].id, after: command });
      return { id: result.rows[0].id };
    }

    if (command.action === "set_account_active") {
      requirePrepare(context);
      const account = await client.query<{ code: string }>(
        `SELECT code FROM accounting_accounts WHERE id = $1 AND community_id = $2`,
        [command.id, context.current.communityId]
      );
      if (!account.rowCount) throw new ApiError(404, "La cuenta no existe.", "account_not_found");
      if (templateAccountCodes.has(account.rows[0].code)) throw new ApiError(409, "Las cuentas del catálogo base deben permanecer activas.", "protected_account");
      const result = await client.query<{ id: string; active: boolean }>(
        `UPDATE accounting_accounts
            SET active = $3
          WHERE id = $1 AND community_id = $2
          RETURNING id::text, active`,
        [command.id, context.current.communityId, command.active]
      );
      if (!result.rowCount) throw new ApiError(404, "La cuenta no existe.", "account_not_found");
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "accounting.account.status", resourceType: "accounting_account", resourceId: command.id, after: { active: command.active } });
      return result.rows[0];
    }

    if (command.action === "create_entry") {
      requirePrepare(context);
      const id = await createEntry(client, context, command);
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "accounting.entry.create", resourceType: "accounting_entry", resourceId: id, after: { ...entryAudit(command), status: "draft" } });
      return { id };
    }

    if (command.action === "update_entry") {
      requirePrepare(context);
      const before = await client.query(
        `SELECT id::text, concept, reference, entry_date::text AS "entryDate", status
           FROM accounting_entries
          WHERE id = $1 AND community_id = $2
          FOR UPDATE`,
        [command.id, context.current.communityId]
      );
      if (!before.rowCount) throw new ApiError(404, "El asiento no existe.", "entry_not_found");
      if (before.rows[0].status !== "draft") throw new ApiError(409, "Solo se pueden editar asientos en borrador.", "entry_not_draft");
      await validateEntryReferences(client, context, command);
      await client.query(
        `UPDATE accounting_entries
            SET period_id = $3, journal_id = $4, entry_date = $5, document_date = $5,
                concept = $6, reference = $7, updated_by = $8
          WHERE id = $1 AND community_id = $2`,
        [command.id, context.current.communityId, command.periodId, command.journalId, command.entryDate, command.concept, command.reference, context.user.id]
      );
      await client.query("DELETE FROM accounting_entry_lines WHERE entry_id = $1 AND community_id = $2", [command.id, context.current.communityId]);
      await insertEntryLines(client, context, command.id, command);
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "accounting.entry.update", resourceType: "accounting_entry", resourceId: command.id, before: before.rows[0], after: entryAudit(command) });
      return { id: command.id };
    }

    if (command.action === "delete_entry") {
      requirePrepare(context);
      const removed = await client.query(
        `DELETE FROM accounting_entries
          WHERE id = $1 AND community_id = $2 AND status = 'draft'
          RETURNING id::text, concept, entry_date::text AS "entryDate"`,
        [command.id, context.current.communityId]
      );
      if (!removed.rowCount) throw new ApiError(409, "Solo se pueden eliminar asientos en borrador.", "entry_not_draft");
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "accounting.entry.delete", resourceType: "accounting_entry", resourceId: command.id, before: removed.rows[0] });
      return { id: command.id };
    }

    if (command.action === "submit_entry") {
      requirePrepare(context);
      const result = await client.query(
        `UPDATE accounting_entries entry
            SET status = 'review', submitted_by = $3, submitted_at = now()
          WHERE entry.id = $1 AND entry.community_id = $2 AND entry.status = 'draft'
            AND EXISTS (
              SELECT 1 FROM accounting_entry_lines line WHERE line.entry_id = entry.id
              GROUP BY line.entry_id
              HAVING count(*) >= 2 AND sum(line.debit_cents) = sum(line.credit_cents) AND sum(line.debit_cents) > 0
            )
          RETURNING entry.id::text`,
        [command.id, context.current.communityId, context.user.id]
      );
      if (!result.rowCount) throw new ApiError(409, "El borrador ya cambió o no está cuadrado.", "invalid_entry_state");
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "accounting.entry.submit", resourceType: "accounting_entry", resourceId: command.id, after: { status: "review" } });
      return { id: command.id };
    }

    if (command.action === "return_entry") {
      requirePost(context);
      const result = await client.query(
        `UPDATE accounting_entries
            SET status = 'draft', submitted_by = NULL, submitted_at = NULL, updated_by = $3
          WHERE id = $1 AND community_id = $2 AND status = 'review'
          RETURNING id::text`,
        [command.id, context.current.communityId, context.user.id]
      );
      if (!result.rowCount) throw new ApiError(409, "El asiento ya no está pendiente de revisión.", "invalid_entry_state");
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "accounting.entry.return", resourceType: "accounting_entry", resourceId: command.id, after: { status: "draft" } });
      return { id: command.id };
    }

    if (command.action === "post_entry") {
      requirePost(context);
      const entry = await client.query<{ created_by: string | null }>(
        `SELECT created_by::text
           FROM accounting_entries
          WHERE id = $1 AND community_id = $2 AND status = 'review'
          FOR UPDATE`,
        [command.id, context.current.communityId]
      );
      if (!entry.rowCount) throw new ApiError(409, "El asiento debe estar pendiente de revisión.", "invalid_entry_state");
      if (entry.rows[0].created_by === context.user.id && context.current.role !== "platform_admin") {
        throw new ApiError(409, "Otra persona debe revisar y contabilizar este asiento.", "separation_required");
      }
      const result = await client.query<{ entry_number: string }>(
        `UPDATE accounting_entries
            SET status = 'posted', posted_by = $3
          WHERE id = $1 AND community_id = $2
          RETURNING entry_number::text`,
        [command.id, context.current.communityId, context.user.id]
      );
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "accounting.entry.post", resourceType: "accounting_entry", resourceId: command.id, after: { status: "posted", entryNumber: result.rows[0].entry_number } });
      return { id: command.id, entryNumber: result.rows[0].entry_number };
    }

    if (command.action === "reverse_entry") {
      requirePost(context);
      const original = await client.query<{ journal_id: string; concept: string }>(
        `SELECT journal_id::text, concept
           FROM accounting_entries
          WHERE id = $1 AND community_id = $2 AND status = 'posted'
            AND reversal_of_id IS NULL AND reversed_by_entry_id IS NULL
          FOR UPDATE`,
        [command.id, context.current.communityId]
      );
      if (!original.rowCount) throw new ApiError(409, "El asiento no se puede revertir.", "entry_not_reversible");
      const period = await client.query<{ id: string }>(
        `SELECT id::text FROM accounting_periods
          WHERE community_id = $1 AND status = 'open' AND current_date BETWEEN starts_on AND ends_on
            AND (locked_through IS NULL OR current_date > locked_through)
          ORDER BY starts_on DESC LIMIT 1`,
        [context.current.communityId]
      );
      if (!period.rowCount) throw new ApiError(409, "No hay un ejercicio abierto para registrar la reversión hoy.", "open_period_required");
      const reversal = await client.query<{ id: string }>(
        `INSERT INTO accounting_entries
          (community_id, period_id, journal_id, entry_date, document_date, concept, status, reversal_of_id, created_by)
         VALUES ($1, $2, $3, current_date, current_date, $4, 'draft', $5, $6)
         RETURNING id::text`,
        [context.current.communityId, period.rows[0].id, original.rows[0].journal_id, `Reversión: ${original.rows[0].concept}`, command.id, context.user.id]
      );
      await client.query(
        `INSERT INTO accounting_entry_lines
          (community_id, entry_id, line_number, account_id, description, debit_cents, credit_cents,
           third_party_name, third_party_tax_id, cost_center_id, private_unit_id, financial_record_id,
           bank_transaction_id, due_date)
         SELECT community_id, $2, line_number, account_id,
                'Reversión: ' || COALESCE(description, ''), credit_cents, debit_cents,
                third_party_name, third_party_tax_id, cost_center_id, private_unit_id,
                financial_record_id, bank_transaction_id, due_date
           FROM accounting_entry_lines
          WHERE entry_id = $1`,
        [command.id, reversal.rows[0].id]
      );
      const posted = await client.query<{ entry_number: string }>(
        `UPDATE accounting_entries SET status = 'posted', posted_by = $3
          WHERE id = $1 AND community_id = $2 RETURNING entry_number::text`,
        [reversal.rows[0].id, context.current.communityId, context.user.id]
      );
      await client.query("UPDATE accounting_entries SET reversed_by_entry_id = $2 WHERE id = $1", [command.id, reversal.rows[0].id]);
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "accounting.entry.reverse", resourceType: "accounting_entry", resourceId: command.id, after: { reversalId: reversal.rows[0].id, reversalNumber: posted.rows[0].entry_number } });
      return { id: reversal.rows[0].id, originalId: command.id, entryNumber: posted.rows[0].entry_number };
    }

    if (command.action === "close_period") {
      requireClose(context);
      const period = await client.query(
        `SELECT id::text, name, starts_on::text, ends_on::text
           FROM accounting_periods
          WHERE id = $1 AND community_id = $2 AND status = 'open'
          FOR UPDATE`,
        [command.id, context.current.communityId]
      );
      if (!period.rowCount) throw new ApiError(409, "El ejercicio ya no está abierto.", "period_not_open");
      const pending = await client.query(
        `SELECT 1 FROM accounting_entries
          WHERE period_id = $1 AND community_id = $2 AND status <> 'posted' LIMIT 1`,
        [command.id, context.current.communityId]
      );
      if (pending.rowCount) throw new ApiError(409, "Revisa o elimina todos los borradores antes de cerrar.", "pending_entries");
      await client.query(
        `UPDATE accounting_periods
            SET status = 'closed', locked_through = ends_on, closed_by = $3, closed_at = now()
          WHERE id = $1 AND community_id = $2`,
        [command.id, context.current.communityId, context.user.id]
      );
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "accounting.period.close", resourceType: "accounting_period", resourceId: command.id, before: period.rows[0], after: { status: "closed" } });
      return { id: command.id };
    }

    throw new ApiError(400, "La operación contable no está disponible.", "unsupported_accounting_action");
  });
}
