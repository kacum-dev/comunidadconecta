import pg from "pg";

const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3122";
const adminEmail = process.env.SEED_ADMIN_EMAIL;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const ownerEmail = "ana.torres@demo.comunidadconecta.local";
const ownerPassword = process.env.SEED_DEMO_PASSWORD || adminPassword;

if (!adminEmail || !adminPassword || !ownerPassword || !process.env.DATABASE_URL) {
  throw new Error("Faltan credenciales sintéticas o DATABASE_URL para la prueba automática");
}

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function responseCookies(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

async function login(email, password) {
  const response = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl },
    body: JSON.stringify({ email, password }),
  });
  const body = await response.json();
  ensure(response.ok && body.ok, `El acceso de ${email} devolvió ${response.status}`);
  return responseCookies(response);
}

async function api(cookie, path, options = {}, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}${path}`, {
    ...options,
    headers: {
      ...(options.body ? { "Content-Type": "application/json", Origin: baseUrl } : {}),
      Cookie: cookie,
      ...options.headers,
    },
  });
  const body = await response.json().catch(() => ({}));
  ensure(response.status === expectedStatus, `${options.method || "GET"} ${path} devolvió ${response.status}: ${body.error || "sin detalle"}`);
  return body;
}

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
});
const recordIds = [];
let originalSettings = null;
let currentSettings = null;
let adminCookie = "";

async function saveAccountingState(enabled) {
  currentSettings = await api(adminCookie, "/api/settings", {
    method: "PATCH",
    body: JSON.stringify({
      community: currentSettings.community,
      preferences: { ...currentSettings.preferences, accountingEnabled: enabled },
    }),
  });
}

async function createRecord(kind, suffix) {
  const created = await api(adminCookie, "/api/modules/economia", {
    method: "POST",
    body: JSON.stringify({
      title: `Prueba automática ${suffix}`,
      code: `AUTO-${suffix}-${Date.now()}`,
      description: "Registro temporal de verificación",
      status: "pending",
      kind,
      amount: kind === "invoice" ? 73.2 : 48.35,
      eventDate: new Date().toISOString(),
      contact: kind === "invoice" ? "Proveedor de prueba" : "Propietario de prueba",
    }),
  }, 201);
  recordIds.push(created.row.id);
  return created.row;
}

async function mark(record, status) {
  const result = await api(adminCookie, `/api/modules/economia/${record.id}`, {
    method: "PATCH",
    body: JSON.stringify({ version: record.version, status }),
  });
  return result.row;
}

async function cleanup() {
  if (!recordIds.length) return;
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL session_replication_role = replica");
    const entries = await client.query(
      "SELECT id::text FROM accounting_entries WHERE source_id = ANY($1::uuid[])",
      [recordIds]
    );
    const entryIds = entries.rows.map((row) => row.id);
    if (entryIds.length) {
      await client.query("DELETE FROM accounting_entry_lines WHERE entry_id = ANY($1::uuid[])", [entryIds]);
      await client.query("DELETE FROM accounting_entries WHERE id = ANY($1::uuid[])", [entryIds]);
    }
    await client.query("DELETE FROM financial_records WHERE id = ANY($1::uuid[])", [recordIds]);
    await client.query(
      "DELETE FROM audit_events WHERE resource_id = ANY($1::text[])",
      [[...recordIds, ...entryIds]]
    );
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}

try {
  adminCookie = await login(adminEmail, adminPassword);
  originalSettings = await api(adminCookie, "/api/settings");
  currentSettings = originalSettings;

  await saveAccountingState(false);
  const disabledDashboard = await api(adminCookie, "/api/finance/dashboard");
  ensure(disabledDashboard.accounting.enabled === false, "Economía no refleja la desactivación contable");
  await api(adminCookie, "/api/finance/accounting", {}, 409);

  const disabledRecord = await createRecord("receipt", "OFF");
  await mark(disabledRecord, "paid");

  await saveAccountingState(true);
  const enabledDashboard = await api(adminCookie, "/api/finance/dashboard");
  ensure(enabledDashboard.accounting.enabled === true && enabledDashboard.accounting.accessible === true, "Economía no refleja la activación contable");

  const ownerCookie = await login(ownerEmail, ownerPassword);
  await api(ownerCookie, "/api/finance/accounting", {}, 403);

  const receipt = await createRecord("receipt", "RECIBO");
  const paidReceipt = await mark(receipt, "paid");
  let accounting = await api(adminCookie, "/api/finance/accounting");
  const receiptEntry = accounting.entries.find((entry) => entry.sourceId === receipt.id && entry.sourceType?.startsWith("financial_record.payment.v"));
  ensure(receiptEntry?.status === "posted", "El cobro no generó un asiento contabilizado");
  ensure(receiptEntry.lines.some((line) => line.accountCode === "572" && Number(line.debit) === 48.35), "El cobro no cargó Banco");
  ensure(receiptEntry.lines.some((line) => line.accountCode === "705" && Number(line.credit) === 48.35), "El cobro no abonó Cuotas ordinarias");
  await mark(paidReceipt, "returned");

  const invoice = await createRecord("invoice", "FACTURA");
  const paidInvoice = await mark(invoice, "paid");
  accounting = await api(adminCookie, "/api/finance/accounting");
  const invoiceEntry = accounting.entries.find((entry) => entry.sourceId === invoice.id && entry.sourceType?.startsWith("financial_record.payment.v"));
  ensure(invoiceEntry?.status === "posted", "El pago de factura no generó un asiento contabilizado");
  ensure(invoiceEntry.lines.some((line) => line.accountCode === "629" && Number(line.debit) === 73.2), "La factura no cargó Otros servicios");
  ensure(invoiceEntry.lines.some((line) => line.accountCode === "572" && Number(line.credit) === 73.2), "La factura no abonó Banco");
  await mark(paidInvoice, "returned");

  accounting = await api(adminCookie, "/api/finance/accounting");
  for (const original of [receiptEntry, invoiceEntry]) {
    const refreshed = accounting.entries.find((entry) => entry.id === original.id);
    ensure(refreshed?.reversedByEntryId, `El asiento ${original.id} no quedó revertido`);
    ensure(accounting.entries.some((entry) => entry.reversalOfId === original.id && entry.status === "posted"), `Falta la reversión de ${original.id}`);
  }

  const client = await pool.connect();
  try {
    const disabledEntry = await client.query(
      "SELECT 1 FROM accounting_entries WHERE source_id = $1 LIMIT 1",
      [disabledRecord.id]
    );
    ensure(disabledEntry.rowCount === 0, "Se creó un asiento mientras el módulo estaba desactivado");
  } finally {
    client.release();
  }

  console.log(JSON.stringify({
    moduleToggle: "ok",
    disabledMeansNoPosting: "ok",
    roleBoundary: "ok",
    receiptPosting: "572 / 705",
    invoicePosting: "629 / 572",
    automaticReversals: "ok",
  }, null, 2));
} finally {
  if (originalSettings && currentSettings && currentSettings.preferences.accountingEnabled !== originalSettings.preferences.accountingEnabled) {
    await saveAccountingState(originalSettings.preferences.accountingEnabled).catch(() => undefined);
  }
  await cleanup();
  await pool.end();
}

