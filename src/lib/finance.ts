import "server-only";

import { createHash } from "node:crypto";
import { syncFinancialRecordAccounting, type AutomaticFinancialRecord } from "./accounting-automation";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { withTenant } from "./db";
import { allocationStatus, financialStatusAfterReversal, parseBankStatement, reconciliationScore } from "./finance-domain";
import type { BankTransactionSummary, FinanceDashboardDTO, FinanceRecordSummary } from "./finance-types";
import { can, canManageSettings, canUseAccounting } from "./permissions";
import { runScheduledFees } from "./fees";

type RecordDb = {
  id: string; title: string; code: string | null; kind: string; status: string;
  amount_cents: string | number; allocated_cents: string | number; event_at: string | Date | null;
  due_at: string | Date | null; event_time_precision: "day" | "minute" | "second" | null;
  due_time_precision: "day" | "minute" | "second" | null; due_inclusive: boolean;
  paid_at: string | Date | null; paid_time_precision: "minute" | "second" | null; contact: string | null;
};
type TransactionDb = {
  id: string; title: string; code: string | null; description: string | null; status: string; kind: string;
  amount_cents: string | number; allocated_cents: string | number; event_at: string | Date; event_time_precision: "day" | "minute" | "second" | null; contact: string | null;
};
const isoDate = (value: string | Date | null) => value ? (value instanceof Date ? value.toISOString() : String(value)).slice(0, 10) : null;
const euros = (value: string | number) => Number(value) / 100;

function automaticFinancialRecord(row: {
  id: string; title: string; code: string | null; kind: string; status: string;
  amount_cents: string | number; paid_at: string | Date | null; version: number;
}): AutomaticFinancialRecord {
  return {
    id: row.id,
    title: row.title,
    code: row.code,
    kind: row.kind,
    status: row.status,
    amountCents: Number(row.amount_cents),
    paidAt: row.paid_at,
    version: Number(row.version),
  };
}

function assertFinanceRead(context: AuthContext) {
  if (!can(context.current.role, "economia", "read") && !can(context.current.role, "bancos", "read")) {
    throw new ApiError(403, "No puedes consultar la gestión financiera.", "forbidden");
  }
}

function assertBankWrite(context: AuthContext) {
  if (!can(context.current.role, "bancos", "write")) {
    throw new ApiError(403, "No puedes modificar la conciliación bancaria.", "forbidden");
  }
}

function recordSummary(row: RecordDb): FinanceRecordSummary {
  const amount = euros(row.amount_cents);
  const allocated = euros(row.allocated_cents);
  return {
    id: row.id, title: row.title, code: row.code ?? "", kind: row.kind, status: row.status,
    amount, allocated, remaining: Math.max(0, Math.abs(amount) - allocated),
    eventDate: row.event_at instanceof Date ? row.event_at.toISOString() : row.event_at,
    dueDate: row.due_at instanceof Date ? row.due_at.toISOString() : row.due_at,
    eventTimePrecision: row.event_time_precision, dueTimePrecision: row.due_time_precision,
    dueInclusive: row.due_inclusive !== false,
    paidAt: row.paid_at instanceof Date ? row.paid_at.toISOString() : row.paid_at,
    paidTimePrecision: row.paid_time_precision,
    contact: row.contact ?? ""
  };
}

export async function getFinanceDashboard(context: AuthContext): Promise<FinanceDashboardDTO> {
  assertFinanceRead(context);
  await runScheduledFees(context);
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const residentScope = context.current.role === "owner";
    const records = await client.query<RecordDb>(
      `SELECT f.id::text,f.title,f.code,f.kind,f.status,f.amount_cents,f.event_at,f.due_at,f.event_time_precision,f.due_time_precision,f.due_inclusive,f.paid_at,f.paid_time_precision,f.contact,
              COALESCE(sum(r.amount_cents) FILTER (WHERE r.status='active'),0)::bigint AS allocated_cents
         FROM financial_records f
         LEFT JOIN financial_reconciliations r ON r.community_id=f.community_id AND r.financial_record_id=f.id
        WHERE f.community_id=$1 AND f.archived_at IS NULL
          AND ($2::boolean = false OR EXISTS (
            SELECT 1 FROM unit_relations ur
             WHERE ur.community_id=f.community_id AND ur.user_id=$3 AND ur.unit_id=f.private_unit_id
               AND ur.status='active' AND ur.valid_from<=current_date
               AND (ur.valid_to IS NULL OR ur.valid_to>=current_date)
          ))
        GROUP BY f.id
        ORDER BY f.due_at NULLS LAST,f.updated_at DESC LIMIT 250`,
      [context.current.communityId,residentScope,context.user.id]
    );
    const transactions = residentScope ? { rows: [] as TransactionDb[] } : await client.query<TransactionDb>(
      `SELECT b.id::text,b.title,b.code,b.description,b.status,b.kind,b.amount_cents,b.event_at,b.event_time_precision,b.contact,
              COALESCE(sum(r.amount_cents) FILTER (WHERE r.status='active'),0)::bigint AS allocated_cents
         FROM bank_transactions b
         LEFT JOIN financial_reconciliations r ON r.community_id=b.community_id AND r.bank_transaction_id=b.id
        WHERE b.community_id=$1 AND b.archived_at IS NULL
        GROUP BY b.id
        ORDER BY b.event_at DESC,b.created_at DESC LIMIT 250`,
      [context.current.communityId]
    );
    const allocations = residentScope ? { rows: [] as Array<{
      id: string; bank_transaction_id: string; financial_record_id: string; financial_title: string;
      amount_cents: string | number; created_at: Date;
    }> } : await client.query<{
      id: string; bank_transaction_id: string; financial_record_id: string; financial_title: string;
      amount_cents: string | number; created_at: Date;
    }>(
      `SELECT r.id::text,r.bank_transaction_id::text,r.financial_record_id::text,
              f.title AS financial_title,r.amount_cents,r.created_at
         FROM financial_reconciliations r
         JOIN financial_records f ON f.id=r.financial_record_id AND f.community_id=r.community_id
        WHERE r.community_id=$1 AND r.status='active'
        ORDER BY r.created_at DESC`,
      [context.current.communityId]
    );
    const accountingState = await client.query<{ accounting_enabled: boolean; automatic_entries: number }>(
      `SELECT settings.accounting_enabled,
              (SELECT count(*)::int FROM accounting_entries entry
                WHERE entry.community_id=settings.community_id
                  AND entry.source_type LIKE 'financial_record.%') AS automatic_entries
         FROM community_app_settings settings
        WHERE settings.community_id=$1`,
      [context.current.communityId]
    );
    const recordRows = records.rows.map(recordSummary);
    const transactionRows: BankTransactionSummary[] = transactions.rows.map((row) => {
      const amount = euros(row.amount_cents);
      const allocated = euros(row.allocated_cents);
      const ownAllocations = allocations.rows.filter((item) => item.bank_transaction_id === row.id).map((item) => ({
        id: item.id, financialRecordId: item.financial_record_id, financialTitle: item.financial_title,
        amount: euros(item.amount_cents), createdAt: item.created_at.toISOString()
      }));
      const suggestions = recordRows
        .filter((record) => record.remaining > 0 && !["paid", "returned"].includes(record.status))
        .map((record) => {
          const match = reconciliationScore({
            bankAmountCents: Number(row.amount_cents),
            bankDate: isoDate(row.event_at) ?? "",
            bankText: [row.title,row.code,row.description,row.contact].filter(Boolean).join(" "),
            recordAmountCents: Math.round(record.remaining * 100),
            recordDate: record.dueDate ?? record.eventDate,
            recordText: [record.title,record.code,record.contact].filter(Boolean).join(" ")
          });
          return {
            financialRecordId: record.id, title: record.title, code: record.code, score: match.score,
            recommendedAmount: Math.min(Math.abs(amount) - allocated, record.remaining), reasons: match.reasons
          };
        })
        .filter((item) => item.score >= 35 && item.recommendedAmount > 0)
        .sort((a,b) => b.score - a.score).slice(0,3);
      return {
        id: row.id, title: row.title, code: row.code ?? "", status: row.status, kind: row.kind,
        amount, allocated, remaining: Math.max(0, Math.abs(amount) - allocated),
        eventDate: row.event_at instanceof Date ? row.event_at.toISOString() : String(row.event_at), eventTimePrecision: row.event_time_precision,
        contact: row.contact ?? "", description: row.description ?? "",
        suggestions, allocations: ownAllocations
      };
    });
    const now = new Date().toISOString();
    const metrics = {
      receivable: recordRows.filter((r) => ["charge","assessment","receipt"].includes(r.kind) && !["paid","returned"].includes(r.status)).reduce((sum,r)=>sum+r.remaining,0),
      overdue: recordRows.filter((r) => r.dueDate && r.dueDate < now && !["paid","returned"].includes(r.status)).reduce((sum,r)=>sum+r.remaining,0),
      paid: recordRows.filter((r) => r.status === "paid").reduce((sum,r)=>sum+Math.abs(r.amount),0),
      invoicesPending: recordRows.filter((r) => r.kind === "invoice" && r.status !== "paid").reduce((sum,r)=>sum+r.remaining,0),
      bankUnmatched: transactionRows.reduce((sum,r)=>sum+r.remaining,0),
      bankUnmatchedCount: transactionRows.filter((r)=>r.remaining>0).length
    };
    return {
      metrics,
      records: recordRows,
      transactions: transactionRows,
      accounting: {
        enabled: accountingState.rows[0]?.accounting_enabled === true,
        accessible: canUseAccounting(context.current.role),
        canManage: canManageSettings(context.current.role) && !context.isDemo,
        automaticEntries: Number(accountingState.rows[0]?.automatic_entries ?? 0),
      },
    };
  });
}

export async function importBankStatement(context: AuthContext, fileName: string, content: string, userAgent?: string | null) {
  assertBankWrite(context);
  if (content.length > 5_000_000) throw new ApiError(413, "El extracto supera el límite de 5 MB.", "file_too_large");
  let parsed;
  try { parsed = parseBankStatement(fileName, content); }
  catch (error) { throw new ApiError(400, error instanceof Error ? error.message : "El extracto no es válido.", "validation_error"); }

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const batch = await client.query<{ id: string }>(
      `INSERT INTO bank_import_batches (community_id,original_name,row_count,error_count,created_by)
       VALUES ($1,$2,$3,$4,$5) RETURNING id::text`,
      [context.current.communityId,fileName.slice(0,240),parsed.rows.length+parsed.errors.length,parsed.errors.length,context.user.id]
    );
    let imported = 0;
    let duplicates = 0;
    for (const row of parsed.rows) {
      const fingerprint = createHash("sha256").update([
        context.current.communityId,row.date,String(row.amountCents),row.description.toLowerCase(),row.reference.toLowerCase()
      ].join("|")).digest("hex");
      const inserted = await client.query(
        `INSERT INTO bank_transactions
          (community_id,title,code,description,status,kind,amount_cents,event_date,contact,import_batch_id,import_fingerprint,created_by,updated_by)
         VALUES ($1,$2,$3,$4,'unmatched',$5,$6,$7,$8,$9,$10,$11,$11)
         ON CONFLICT (community_id,import_fingerprint) WHERE import_fingerprint IS NOT NULL DO NOTHING`,
        [context.current.communityId,row.description.slice(0,200),row.reference||null,row.description,
         row.amountCents>=0?"credit":"debit",row.amountCents,row.date,row.contact||null,batch.rows[0].id,fingerprint,context.user.id]
      );
      if (inserted.rowCount) imported += 1; else duplicates += 1;
    }
    await client.query(
      "UPDATE bank_import_batches SET imported_count=$2,duplicate_count=$3 WHERE id=$1 AND community_id=$4",
      [batch.rows[0].id,imported,duplicates,context.current.communityId]
    );
    const result = { batchId: batch.rows[0].id, imported, duplicates, errors: parsed.errors, format: parsed.format };
    await writeAudit(client,{communityId:context.current.communityId,userId:context.user.id,action:"bancos.statement_imported",
      resourceType:"bank_import",resourceId:batch.rows[0].id,after:{fileName:fileName.slice(0,240),format:parsed.format,imported,duplicates,errorCount:parsed.errors.length},userAgent});
    return result;
  });
}

export async function importBankCsv(context: AuthContext, fileName: string, content: string, userAgent?: string | null) {
  return importBankStatement(context, fileName, content, userAgent);
}

export async function saveManualBankConnection(
  context: AuthContext,
  input: { bankName: string; accountReference?: string },
  userAgent?: string | null
) {
  assertBankWrite(context);
  const bankName = input.bankName.trim().slice(0, 120);
  const accountReference = input.accountReference?.trim().slice(0, 160) || null;
  if (bankName.length < 2) throw new ApiError(400, "Indica el banco.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const existing = await client.query<{ id: string }>(`SELECT id::text FROM community_integrations
      WHERE community_id=$1 AND kind='banking' AND provider='manual_import' AND archived_at IS NULL
      ORDER BY updated_at DESC LIMIT 1 FOR UPDATE`, [context.current.communityId]);
    let id: string;
    if (existing.rowCount) {
      id = existing.rows[0].id;
      await client.query(`UPDATE community_integrations SET name=$3,account_reference=$4,status='enabled',
        config=$5::jsonb,updated_by=$6 WHERE id=$1 AND community_id=$2`, [id, context.current.communityId,
        `${bankName} · Extractos`, accountReference, JSON.stringify({ mode: "manual_import", formats: ["csv", "norma43"] }), context.user.id]);
    } else {
      const inserted = await client.query<{ id: string }>(`INSERT INTO community_integrations
        (community_id,name,kind,provider,account_reference,status,config,created_by,updated_by)
        VALUES($1,$2,'banking','manual_import',$3,'enabled',$4::jsonb,$5,$5) RETURNING id::text`,
      [context.current.communityId, `${bankName} · Extractos`, accountReference, JSON.stringify({ mode: "manual_import", formats: ["csv", "norma43"] }), context.user.id]);
      id = inserted.rows[0].id;
    }
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id,
      action: "bancos.manual_connection_saved", resourceType: "community_integration", resourceId: id,
      after: { bankName, accountReference, mode: "manual_import" }, userAgent });
    return { id, name: bankName, accountReference: accountReference ?? "", mode: "manual_import", status: "enabled" };
  });
}

export async function reconcileTransaction(context: AuthContext, input: {
  bankTransactionId: string; allocations: Array<{ financialRecordId: string; amount: number }>; note?: string;
}, userAgent?: string | null) {
  assertBankWrite(context);
  if (!/^[0-9a-f-]{36}$/i.test(input.bankTransactionId)) throw new ApiError(400,"Movimiento no válido.","validation_error");
  if (!Array.isArray(input.allocations) || !input.allocations.length || input.allocations.length > 50) {
    throw new ApiError(400,"Selecciona al menos un registro económico.","validation_error");
  }
  return withTenant(context.current.communityId,context.user.id,async(client)=>{
    const bank=await client.query<{amount_cents:number;event_at:string|Date}>(
      "SELECT amount_cents,event_at FROM bank_transactions WHERE id=$1 AND community_id=$2 AND archived_at IS NULL FOR UPDATE",
      [input.bankTransactionId,context.current.communityId]
    );
    if(!bank.rowCount) throw new ApiError(404,"El movimiento no existe.","not_found");
    const already=await client.query<{total:number}>(
      "SELECT COALESCE(sum(amount_cents),0)::bigint AS total FROM financial_reconciliations WHERE community_id=$1 AND bank_transaction_id=$2 AND status='active'",
      [context.current.communityId,input.bankTransactionId]
    );
    let available=Math.abs(Number(bank.rows[0].amount_cents))-Number(already.rows[0].total);
    if(available<=0) throw new ApiError(409,"El movimiento ya está conciliado por completo.","already_matched");
    const created:string[]=[];
    const automaticEntries:string[]=[];
    for(const allocation of input.allocations){
      const cents=Math.round(Number(allocation.amount)*100);
      if(!Number.isInteger(cents)||cents<=0) throw new ApiError(400,"Todos los importes deben ser positivos.","validation_error");
      if(cents>available) throw new ApiError(409,"La suma supera el importe pendiente del movimiento.","overallocated");
      const record=await client.query<{id:string;title:string;code:string|null;kind:string;status:string;amount_cents:number;paid_at:string|Date|null;version:number}>(
        "SELECT id::text,title,code,kind,status,amount_cents,paid_at,version FROM financial_records WHERE id=$1 AND community_id=$2 AND archived_at IS NULL FOR UPDATE",
        [allocation.financialRecordId,context.current.communityId]
      );
      if(!record.rowCount) throw new ApiError(404,"Uno de los registros económicos no existe.","not_found");
      const recordAllocation=await client.query<{total:number}>(
        "SELECT COALESCE(sum(amount_cents),0)::bigint AS total FROM financial_reconciliations WHERE community_id=$1 AND financial_record_id=$2 AND status='active'",
        [context.current.communityId,allocation.financialRecordId]
      );
      const remaining=Math.abs(Number(record.rows[0].amount_cents))-Number(recordAllocation.rows[0].total);
      if(cents>remaining) throw new ApiError(409,"Una asignación supera el saldo del registro económico.","record_overallocated");
      const inserted=await client.query<{id:string}>(
        `INSERT INTO financial_reconciliations
          (community_id,bank_transaction_id,financial_record_id,amount_cents,note,previous_financial_status,created_by)
         VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING id::text`,
        [context.current.communityId,input.bankTransactionId,allocation.financialRecordId,cents,input.note?.trim().slice(0,500)||null,record.rows[0].status,context.user.id]
      );
      created.push(inserted.rows[0].id);
      const recordAllocated=Number(recordAllocation.rows[0].total)+cents;
      if(recordAllocated>=Math.abs(Number(record.rows[0].amount_cents))){
        const paid=await client.query<{id:string;title:string;code:string|null;kind:string;status:string;amount_cents:number;paid_at:string|Date|null;version:number}>(
          "UPDATE financial_records SET status='paid',paid_at=COALESCE(paid_at,now()),paid_time_precision=COALESCE(paid_time_precision,'second'),version=version+1,updated_by=$3 WHERE id=$1 AND community_id=$2 RETURNING id::text,title,code,kind,status,amount_cents,paid_at,version",
          [allocation.financialRecordId,context.current.communityId,context.user.id]
        );
        const accountingResult=await syncFinancialRecordAccounting(client, {
          communityId: context.current.communityId,
          userId: context.user.id,
          userAgent,
        }, automaticFinancialRecord(record.rows[0]), automaticFinancialRecord(paid.rows[0]), {
          entryDate: isoDate(bank.rows[0].event_at) ?? undefined,
          bankTransactionId: input.bankTransactionId,
        });
        if(accountingResult.posted?.id) automaticEntries.push(accountingResult.posted.id);
      }
      available-=cents;
    }
    const allocated=Math.abs(Number(bank.rows[0].amount_cents))-available;
    const status=allocationStatus(Number(bank.rows[0].amount_cents),allocated);
    await client.query("UPDATE bank_transactions SET status=$3,assigned_to=$4,version=version+1,updated_by=$5 WHERE id=$1 AND community_id=$2",
      [input.bankTransactionId,context.current.communityId,status,created.join(","),context.user.id]);
    await writeAudit(client,{communityId:context.current.communityId,userId:context.user.id,action:"bancos.reconciled",
      resourceType:"bank_transaction",resourceId:input.bankTransactionId,after:{allocationIds:created,allocatedCents:Math.abs(Number(bank.rows[0].amount_cents))-available,status},userAgent});
    return {status,remaining:available/100,allocationIds:created,accountingEntries:automaticEntries};
  });
}

export async function reverseReconciliation(context:AuthContext,id:string,userAgent?:string|null){
  assertBankWrite(context);
  if(!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400,"Conciliación no válida.","validation_error");
  return withTenant(context.current.communityId,context.user.id,async(client)=>{
    const row=await client.query<{bank_transaction_id:string;financial_record_id:string;amount_cents:number;previous_financial_status:string}>(
      `SELECT bank_transaction_id::text,financial_record_id::text,amount_cents,previous_financial_status
         FROM financial_reconciliations WHERE id=$1 AND community_id=$2 AND status='active' FOR UPDATE`,
      [id,context.current.communityId]
    );
    if(!row.rowCount) throw new ApiError(404,"La conciliación no existe o ya fue deshecha.","not_found");
    await client.query("UPDATE financial_reconciliations SET status='reversed',reversed_by=$3,reversed_at=now() WHERE id=$1 AND community_id=$2",
      [id,context.current.communityId,context.user.id]);
    const lockedBank=await client.query<{amount_cents:number}>(
      "SELECT amount_cents FROM bank_transactions WHERE id=$1 AND community_id=$2 FOR UPDATE",
      [row.rows[0].bank_transaction_id,context.current.communityId]
    );
    const remainingBank=await client.query<{total:number}>(
      "SELECT COALESCE(sum(amount_cents),0)::bigint AS total FROM financial_reconciliations WHERE community_id=$1 AND bank_transaction_id=$2 AND status='active'",
      [context.current.communityId,row.rows[0].bank_transaction_id]
    );
    const status=allocationStatus(Number(lockedBank.rows[0].amount_cents),Number(remainingBank.rows[0].total));
    await client.query("UPDATE bank_transactions SET status=$3,version=version+1,updated_by=$4 WHERE id=$1 AND community_id=$2",
      [row.rows[0].bank_transaction_id,context.current.communityId,status,context.user.id]);
    const lockedRecord=await client.query<{id:string;title:string;code:string|null;kind:string;status:string;amount_cents:number;paid_at:string|Date|null;version:number}>(
      "SELECT id::text,title,code,kind,status,amount_cents,paid_at,version FROM financial_records WHERE id=$1 AND community_id=$2 FOR UPDATE",
      [row.rows[0].financial_record_id,context.current.communityId]
    );
    if(!lockedRecord.rowCount) throw new ApiError(409,"El registro económico asociado ya no está disponible.","invalid_state");
    const remainingRecord=await client.query<{total:number}>(
      "SELECT COALESCE(sum(amount_cents),0)::bigint AS total FROM financial_reconciliations WHERE community_id=$1 AND financial_record_id=$2 AND status='active'",
      [context.current.communityId,row.rows[0].financial_record_id]
    );
    const financialStatus=financialStatusAfterReversal(Number(lockedRecord.rows[0].amount_cents),Number(remainingRecord.rows[0].total),row.rows[0].previous_financial_status);
    const updatedRecord=await client.query<{id:string;title:string;code:string|null;kind:string;status:string;amount_cents:number;paid_at:string|Date|null;version:number}>(
      "UPDATE financial_records SET status=$3,paid_at=CASE WHEN $3='paid' THEN paid_at ELSE NULL END,paid_time_precision=CASE WHEN $3='paid' THEN paid_time_precision ELSE NULL END,version=version+1,updated_by=$4 WHERE id=$1 AND community_id=$2 RETURNING id::text,title,code,kind,status,amount_cents,paid_at,version",
      [row.rows[0].financial_record_id,context.current.communityId,financialStatus,context.user.id]
    );
    const accountingResult=await syncFinancialRecordAccounting(client, {
      communityId: context.current.communityId,
      userId: context.user.id,
      userAgent,
    }, automaticFinancialRecord(lockedRecord.rows[0]), automaticFinancialRecord(updatedRecord.rows[0]), {
      bankTransactionId: row.rows[0].bank_transaction_id,
    });
    await writeAudit(client,{communityId:context.current.communityId,userId:context.user.id,action:"bancos.reconciliation_reversed",
      resourceType:"financial_reconciliation",resourceId:id,before:{amountCents:Number(row.rows[0].amount_cents)},after:{status:"reversed"},userAgent});
    return {id,status,accountingReversal:accountingResult.reversed?.id??null};
  });
}
