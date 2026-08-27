const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3120";
const adminEmail = process.env.SEED_ADMIN_EMAIL;
const adminPassword = process.env.SEED_ADMIN_PASSWORD;
const presidentEmail = "miguel.ruiz@demo.comunidadconecta.local";
const presidentPassword = process.env.SEED_DEMO_PASSWORD || adminPassword;

if (!adminEmail || !adminPassword || !presidentPassword) throw new Error("Faltan credenciales sintéticas para la prueba contable");

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function cookies(response) {
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
  ensure(response.status === 200 && body.ok, `El acceso de ${email} devolvió ${response.status}`);
  return cookies(response);
}

async function command(cookie, body, expectedStatus = 200) {
  const response = await fetch(`${baseUrl}/api/finance/accounting`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
    body: JSON.stringify(body),
  });
  const result = await response.json();
  ensure(response.status === expectedStatus, `${body.action} devolvió ${response.status}: ${result.error || "sin detalle"}`);
  return result;
}

const adminCookie = await login(adminEmail, adminPassword);
const dashboardResponse = await fetch(`${baseUrl}/api/finance/accounting`, { headers: { Cookie: adminCookie } });
const dashboard = await dashboardResponse.json();
ensure(dashboardResponse.status === 200, `El panel contable devolvió ${dashboardResponse.status}`);
ensure(dashboard.chart?.templateAccounts >= 80 && dashboard.accounts?.length >= 80, "El catálogo contable no está completo");
ensure(dashboard.selectedPeriodId && dashboard.journals?.length >= 7, "Faltan el ejercicio o los diarios base");

const debitAccount = dashboard.accounts.find((account) => account.code === "622");
const creditAccount = dashboard.accounts.find((account) => account.code === "400");
const journal = dashboard.journals.find((item) => item.code === "GENERAL");
ensure(debitAccount && creditAccount && journal, "Faltan cuentas o diario para la prueba");

const reference = `SMOKE-ACCOUNTING-${Date.now()}`;
let entryId = null;
try {
  const created = await command(adminCookie, {
    action: "create_entry",
    periodId: dashboard.selectedPeriodId,
    journalId: journal.id,
    entryDate: new Date().toISOString().slice(0, 10),
    concept: "Prueba temporal de mantenimiento",
    reference,
    lines: [
      { accountId: debitAccount.id, description: "Gasto temporal", debit: 120.5, credit: 0 },
      { accountId: creditAccount.id, description: "Proveedor temporal", debit: 0, credit: 120.5 },
    ],
  });
  entryId = created.id;
  ensure(entryId, "La creación no devolvió el asiento");

  await command(adminCookie, {
    action: "update_entry",
    id: entryId,
    periodId: dashboard.selectedPeriodId,
    journalId: journal.id,
    entryDate: new Date().toISOString().slice(0, 10),
    concept: "Prueba temporal actualizada",
    reference,
    lines: [
      { accountId: debitAccount.id, description: "Gasto temporal", debit: 121, credit: 0 },
      { accountId: creditAccount.id, description: "Proveedor temporal", debit: 0, credit: 121 },
    ],
  });
  await command(adminCookie, { action: "submit_entry", id: entryId });

  const presidentCookie = await login(presidentEmail, presidentPassword);
  await command(presidentCookie, { action: "return_entry", id: entryId });

  const deleted = await command(adminCookie, { action: "delete_entry", id: entryId });
  ensure(deleted.id === entryId, "No se eliminó el borrador temporal");
  entryId = null;

  const csv = await fetch(`${baseUrl}/api/finance/accounting?format=csv&periodId=${dashboard.selectedPeriodId}`, { headers: { Cookie: adminCookie } });
  const csvText = await csv.text();
  ensure(csv.status === 200 && csvText.replace(/^\uFEFF/, "").includes("Código"), `La exportación contable devolvió ${csv.status}`);
} finally {
  if (entryId) {
    await command(adminCookie, { action: "return_entry", id: entryId }).catch(() => undefined);
    await command(adminCookie, { action: "delete_entry", id: entryId }).catch(() => undefined);
  }
}

console.log(JSON.stringify({
  accountingDashboard: "ok",
  templateAccounts: dashboard.chart.templateAccounts,
  journals: dashboard.journals.length,
  draftCreateUpdate: "ok",
  submitAndPresidentReturn: "ok",
  cleanup: "ok",
  csvExport: "ok",
}, null, 2));
