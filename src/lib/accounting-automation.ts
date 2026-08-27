import "server-only";

import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { accountingIsEnabled, ensureAccountingFoundation, ensureAccountingPeriod } from "./accounting";
import { automaticPostingRule } from "./accounting-domain";
import { writeAudit } from "./audit";

export interface AutomaticFinancialRecord {
  id: string;
  title: string;
  code: string | null;
  kind: string;
  status: string;
  amountCents: number;
  paidAt: string | Date | null;
  version: number;
}

export interface AccountingAutomationIdentity {
  communityId: string;
  userId: string;
  userAgent?: string | null;
}

function paymentDate(value: string | Date | null) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === "string" && /^\d{4}-\d{2}-\d{2}/.test(value)) return value.slice(0, 10);
  return new Date().toISOString().slice(0, 10);
}

function validAmount(record: AutomaticFinancialRecord) {
  const amount = Math.abs(Number(record.amountCents));
  if (!Number.isSafeInteger(amount) || amount <= 0) {
    throw new ApiError(409, "El registro económico necesita un importe válido para contabilizarse.", "invalid_accounting_amount");
  }
  return amount;
}

async function automaticContext(
  client: PoolClient,
  identity: AccountingAutomationIdentity,
  record: AutomaticFinancialRecord,
  entryDate: string
) {
  await ensureAccountingFoundation(client, identity.communityId);
  const periodId = await ensureAccountingPeriod(client, identity.communityId, identity.userId, entryDate);
  const journal = await client.query<{ id: string }>(
    "SELECT id::text FROM accounting_journals WHERE community_id = $1 AND code = 'BANCO' AND active = true",
    [identity.communityId]
  );
  const rule = automaticPostingRule(record.kind);
  if (!rule) return null;
  const accounts = await client.query<{ id: string; code: string }>(
    `SELECT id::text, code FROM accounting_accounts
      WHERE community_id = $1 AND code = ANY($2::text[]) AND active = true AND accepts_entries = true`,
    [identity.communityId, [rule.debitCode, rule.creditCode]]
  );
  const byCode = new Map(accounts.rows.map((account) => [account.code, account.id]));
  if (!journal.rowCount || !byCode.has(rule.debitCode) || !byCode.has(rule.creditCode)) {
    throw new ApiError(409, "Faltan el diario bancario o las cuentas automáticas del plan contable.", "accounting_foundation_incomplete");
  }
  return { periodId, journalId: journal.rows[0].id, rule, byCode };
}

async function postAutomaticPayment(
  client: PoolClient,
  identity: AccountingAutomationIdentity,
  record: AutomaticFinancialRecord,
  options: { entryDate?: string; bankTransactionId?: string | null } = {}
) {
  const rule = automaticPostingRule(record.kind);
  if (!rule || !await accountingIsEnabled(client, identity.communityId)) return null;

  const amountCents = validAmount(record);
  const entryDate = options.entryDate ?? paymentDate(record.paidAt);
  const foundation = await automaticContext(client, identity, record, entryDate);
  if (!foundation) return null;
  const sourceType = `financial_record.payment.v${record.version}`;

  await client.query("SELECT pg_advisory_xact_lock(hashtext($1))", [`${identity.communityId}:${sourceType}:${record.id}`]);
  const existing = await client.query<{ id: string; entry_number: string | null }>(
    `SELECT id::text, entry_number::text
       FROM accounting_entries
      WHERE community_id = $1 AND source_type = $2 AND source_id = $3
        AND reversal_of_id IS NULL
      LIMIT 1`,
    [identity.communityId, sourceType, record.id]
  );
  if (existing.rowCount) return { id: existing.rows[0].id, entryNumber: existing.rows[0].entry_number, created: false };

  const concept = `${foundation.rule.label}: ${record.title}`.slice(0, 240);
  const reference = (record.code || `AUTO-${record.id.slice(0, 8)}`).slice(0, 120);
  const entry = await client.query<{ id: string }>(
    `INSERT INTO accounting_entries
      (community_id, period_id, journal_id, entry_date, document_date, concept, reference,
       status, source_type, source_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4, $5, $6, 'draft', $7, $8, $9, $9)
     RETURNING id::text`,
    [identity.communityId, foundation.periodId, foundation.journalId, entryDate, concept, reference, sourceType, record.id, identity.userId]
  );
  const entryId = entry.rows[0].id;
  await client.query(
    `INSERT INTO accounting_entry_lines
      (community_id, entry_id, line_number, account_id, description, debit_cents, credit_cents,
       financial_record_id, bank_transaction_id)
     VALUES
      ($1, $2, 1, $3, $5, $6, 0, $7, $8),
      ($1, $2, 2, $4, $5, 0, $6, $7, $8)`,
    [identity.communityId, entryId, foundation.byCode.get(foundation.rule.debitCode), foundation.byCode.get(foundation.rule.creditCode), concept, amountCents, record.id, options.bankTransactionId ?? null]
  );
  const posted = await client.query<{ entry_number: string }>(
    `UPDATE accounting_entries
        SET status = 'posted', posted_by = $3
      WHERE id = $1 AND community_id = $2
      RETURNING entry_number::text`,
    [entryId, identity.communityId, identity.userId]
  );
  await writeAudit(client, {
    communityId: identity.communityId,
    userId: identity.userId,
    action: "accounting.entry.automatic_payment",
    resourceType: "accounting_entry",
    resourceId: entryId,
    after: { entryNumber: posted.rows[0].entry_number, sourceType, financialRecordId: record.id, amountCents, rule: foundation.rule },
    userAgent: identity.userAgent,
  });
  return { id: entryId, entryNumber: posted.rows[0].entry_number, created: true };
}

async function reverseLatestAutomaticPayment(
  client: PoolClient,
  identity: AccountingAutomationIdentity,
  record: AutomaticFinancialRecord,
  options: { entryDate?: string; bankTransactionId?: string | null } = {}
) {
  if (!await accountingIsEnabled(client, identity.communityId)) return null;
  const original = await client.query<{ id: string; journal_id: string; concept: string; reference: string | null }>(
    `SELECT id::text, journal_id::text, concept, reference
       FROM accounting_entries
      WHERE community_id = $1 AND source_id = $2
        AND source_type LIKE 'financial_record.payment.v%'
        AND status = 'posted' AND reversal_of_id IS NULL AND reversed_by_entry_id IS NULL
      ORDER BY posted_at DESC, created_at DESC
      LIMIT 1
      FOR UPDATE`,
    [identity.communityId, record.id]
  );
  if (!original.rowCount) return null;

  const entryDate = options.entryDate ?? new Date().toISOString().slice(0, 10);
  const periodId = await ensureAccountingPeriod(client, identity.communityId, identity.userId, entryDate);
  const sourceType = `financial_record.reversal.v${record.version}`;
  const reversal = await client.query<{ id: string }>(
    `INSERT INTO accounting_entries
      (community_id, period_id, journal_id, entry_date, document_date, concept, reference, status,
       source_type, source_id, reversal_of_id, created_by, updated_by)
     VALUES ($1, $2, $3, $4, $4, $5, $6, 'draft', $7, $8, $9, $10, $10)
     RETURNING id::text`,
    [identity.communityId, periodId, original.rows[0].journal_id, entryDate,
      `Reversión automática: ${original.rows[0].concept}`.slice(0, 240), original.rows[0].reference,
      sourceType, record.id, original.rows[0].id, identity.userId]
  );
  await client.query(
    `INSERT INTO accounting_entry_lines
      (community_id, entry_id, line_number, account_id, description, debit_cents, credit_cents,
       third_party_name, third_party_tax_id, cost_center_id, private_unit_id, financial_record_id,
       bank_transaction_id, due_date)
     SELECT community_id, $2, line_number, account_id,
            'Reversión automática: ' || COALESCE(description, ''), credit_cents, debit_cents,
            third_party_name, third_party_tax_id, cost_center_id, private_unit_id, financial_record_id,
            COALESCE($3::uuid, bank_transaction_id), due_date
       FROM accounting_entry_lines
      WHERE entry_id = $1`,
    [original.rows[0].id, reversal.rows[0].id, options.bankTransactionId ?? null]
  );
  const posted = await client.query<{ entry_number: string }>(
    `UPDATE accounting_entries SET status = 'posted', posted_by = $3
      WHERE id = $1 AND community_id = $2 RETURNING entry_number::text`,
    [reversal.rows[0].id, identity.communityId, identity.userId]
  );
  await client.query(
    "UPDATE accounting_entries SET reversed_by_entry_id = $3 WHERE id = $1 AND community_id = $2",
    [original.rows[0].id, identity.communityId, reversal.rows[0].id]
  );
  await writeAudit(client, {
    communityId: identity.communityId,
    userId: identity.userId,
    action: "accounting.entry.automatic_reversal",
    resourceType: "accounting_entry",
    resourceId: original.rows[0].id,
    after: { reversalId: reversal.rows[0].id, reversalNumber: posted.rows[0].entry_number, financialRecordId: record.id },
    userAgent: identity.userAgent,
  });
  return { id: reversal.rows[0].id, entryNumber: posted.rows[0].entry_number };
}

function financiallyChanged(before: AutomaticFinancialRecord, after: AutomaticFinancialRecord) {
  return Math.abs(before.amountCents) !== Math.abs(after.amountCents) || before.kind !== after.kind;
}

export async function syncFinancialRecordAccounting(
  client: PoolClient,
  identity: AccountingAutomationIdentity,
  before: AutomaticFinancialRecord | null,
  after: AutomaticFinancialRecord,
  options: { entryDate?: string; bankTransactionId?: string | null } = {}
) {
  const wasPaid = before?.status === "paid";
  const isPaid = after.status === "paid";
  if (!wasPaid && !isPaid) return { posted: null, reversed: null };

  let reversed = null;
  if (wasPaid && (!isPaid || (before && financiallyChanged(before, after)))) {
    reversed = await reverseLatestAutomaticPayment(client, identity, after, options);
  }
  const shouldPost = isPaid && (!wasPaid || (before && financiallyChanged(before, after)));
  const posted = shouldPost ? await postAutomaticPayment(client, identity, after, options) : null;
  return { posted, reversed };
}
