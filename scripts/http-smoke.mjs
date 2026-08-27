const baseUrl = process.env.SMOKE_BASE_URL || "http://127.0.0.1:3100";
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const ownerEmail = "ana.torres@demo.comunidadconecta.local";
const ownerPassword = process.env.SEED_DEMO_PASSWORD || password;

if (!email || !password) throw new Error("Faltan las credenciales de prueba en el entorno");

function ensure(condition, message) {
  if (!condition) throw new Error(message);
}

function cookieHeader(response) {
  const values = typeof response.headers.getSetCookie === "function"
    ? response.headers.getSetCookie()
    : [response.headers.get("set-cookie") || ""];
  return values.map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");
}

const loginPage = await fetch(`${baseUrl}/login`, { redirect: "manual" });
ensure(loginPage.status === 200, `GET /login devolvió ${loginPage.status}`);

const blockedOrigin = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: "https://attacker.invalid" },
  body: JSON.stringify({ email, password })
});
ensure(blockedOrigin.status === 403, `La protección de origen devolvió ${blockedOrigin.status}`);

const login = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: JSON.stringify({ email, password })
});
const loginBody = await login.json();
ensure(login.status === 200 && loginBody.ok, `Login falló con ${login.status}`);
const cookie = cookieHeader(login);
ensure(cookie.includes("cc_session="), "No se recibió la cookie de sesión");

const list = await fetch(`${baseUrl}/api/modules/incidencias?page=1&pageSize=10`, { headers: { Cookie: cookie } });
const listBody = await list.json();
ensure(list.status === 200 && listBody.total >= 2, "No se pudo listar el tenant autenticado");

for (const endpoint of [
  "/api/finance/dashboard",
  "/api/governance/dashboard",
  "/api/operations/dashboard",
  "/api/transition/dashboard",
  "/api/reservations/dashboard",
  "/api/fees/dashboard",
  "/api/privacy/dashboard",
  "/api/notifications",
]) {
  const response = await fetch(baseUrl + endpoint, { headers: { Cookie: cookie } });
  const body = await response.json();
  ensure(response.status === 200 && body && typeof body === "object", `${endpoint} devolvió ${response.status}`);
}

const unique = Date.now();
const created = await fetch(`${baseUrl}/api/modules/incidencias`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
  body: JSON.stringify({
    title: "Comprobación automática de funcionamiento",
    code: `SMOKE-${unique}`,
    kind: "maintenance",
    status: "received",
    description: "Registro temporal creado por la prueba HTTP.",
    location: "Entorno de prueba",
    priority: "low",
    eventDate: new Date().toISOString().slice(0, 10),
    dueDate: "",
    contact: "",
    assignedTo: ""
  })
});
const createdBody = await created.json();
ensure(created.status === 201 && createdBody.row?.id, `La creación devolvió ${created.status}`);

const updated = await fetch(`${baseUrl}/api/modules/incidencias/${createdBody.row.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
  body: JSON.stringify({ status: "in_progress", version: createdBody.row.version })
});
const updatedBody = await updated.json();
ensure(updated.status === 200 && updatedBody.row.status === "in_progress", `La edición devolvió ${updated.status}`);

const archived = await fetch(`${baseUrl}/api/modules/incidencias/${createdBody.row.id}`, {
  method: "DELETE",
  headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
  body: JSON.stringify({ version: updatedBody.row.version })
});
const archivedBody = await archived.json();
ensure(archived.status === 200 && archivedBody.row.archivedAt, `El archivado devolvió ${archived.status}`);

const restored = await fetch(`${baseUrl}/api/modules/incidencias/${createdBody.row.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
  body: JSON.stringify({ restore: true, version: archivedBody.row.version })
});
const restoredBody = await restored.json();
ensure(restored.status === 200 && !restoredBody.row.archivedAt, `La restauración devolvió ${restored.status}`);

const finalArchive = await fetch(`${baseUrl}/api/modules/incidencias/${createdBody.row.id}`, {
  method: "DELETE",
  headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
  body: JSON.stringify({ version: restoredBody.row.version })
});
ensure(finalArchive.status === 200, `El archivado final devolvió ${finalArchive.status}`);

const exportResponse = await fetch(`${baseUrl}/api/modules/incidencias/export`, { headers: { Cookie: cookie } });
const exportText = await exportResponse.text();
ensure(exportResponse.status === 200 && exportText.replace(/^\uFEFF/, "").includes("Título"), `La exportación CSV no es válida (${exportResponse.status})`);

const settingsResponse = await fetch(`${baseUrl}/api/settings`, { headers: { Cookie: cookie } });
const settingsBody = await settingsResponse.json();
ensure(settingsResponse.status === 200 && settingsBody.community?.name && settingsBody.community?.timezone && settingsBody.preferences?.backupFrequency, `La configuración devolvió ${settingsResponse.status}`);
ensure(Array.isArray(settingsBody.integrations), "La configuración no devolvió la lista de conexiones");
const settingsUpdate = await fetch(`${baseUrl}/api/settings`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
  body: JSON.stringify({ community: settingsBody.community, preferences: settingsBody.preferences })
});
const settingsUpdateBody = await settingsUpdate.json();
ensure(settingsUpdate.status === 200 && settingsUpdateBody.community?.name === settingsBody.community.name, `La edición de configuración devolvió ${settingsUpdate.status}`);

if (!settingsBody.secretStorageReady) {
  const blockedCredential = await fetch(`${baseUrl}/api/settings/integrations`, {
    method: "POST",
    headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
    body: JSON.stringify({ name: "Credencial bloqueada", kind: "other", provider: "Prueba HTTP", endpointUrl: "", accountReference: "", status: "draft", credential: "temporary-smoke-secret" })
  });
  ensure(blockedCredential.status === 503, `El servidor aceptó una credencial sin clave de cifrado (${blockedCredential.status})`);
}

const integrationCreated = await fetch(`${baseUrl}/api/settings/integrations`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
  body: JSON.stringify({ name: `Conexión temporal ${unique}`, kind: "other", provider: "Prueba HTTP", endpointUrl: "", accountReference: `SMOKE-${unique}`, status: "draft" })
});
const integrationCreatedBody = await integrationCreated.json();
ensure(integrationCreated.status === 201 && integrationCreatedBody.integration?.id, `La creación de conexión devolvió ${integrationCreated.status}`);
const integrationUpdated = await fetch(`${baseUrl}/api/settings/integrations/${integrationCreatedBody.integration.id}`, {
  method: "PATCH",
  headers: { "Content-Type": "application/json", Origin: baseUrl, Cookie: cookie },
  body: JSON.stringify({ name: `Conexión temporal ${unique}`, kind: "other", provider: "Prueba HTTP", endpointUrl: "", accountReference: `SMOKE-${unique}`, status: "paused" })
});
const integrationUpdatedBody = await integrationUpdated.json();
ensure(integrationUpdated.status === 200 && integrationUpdatedBody.integration?.status === "paused", `La edición de conexión devolvió ${integrationUpdated.status}`);
const integrationDeleted = await fetch(`${baseUrl}/api/settings/integrations/${integrationCreatedBody.integration.id}`, {
  method: "DELETE", headers: { Origin: baseUrl, Cookie: cookie }
});
ensure(integrationDeleted.status === 200, `La eliminación de conexión devolvió ${integrationDeleted.status}`);

const logout = await fetch(`${baseUrl}/api/auth/logout`, {
  method: "POST",
  headers: { Origin: baseUrl, Cookie: cookie }
});
ensure(logout.status === 200, `Logout devolvió ${logout.status}`);

const ownerLogin = await fetch(`${baseUrl}/api/auth/login`, {
  method: "POST",
  headers: { "Content-Type": "application/json", Origin: baseUrl },
  body: JSON.stringify({ email: ownerEmail, password: ownerPassword })
});
const ownerLoginBody = await ownerLogin.json();
ensure(ownerLogin.status === 200 && ownerLoginBody.ok, `Login de propietaria falló con ${ownerLogin.status}`);
const ownerCookie = cookieHeader(ownerLogin);

const forbiddenSettings = await fetch(`${baseUrl}/api/settings`, { headers: { Cookie: ownerCookie } });
ensure(forbiddenSettings.status === 403, `La configuración permitió acceso a una propietaria (${forbiddenSettings.status})`);

const residentModules = {};
for (const moduleKey of ["avisos", "juntas", "activos"]) {
  const response = await fetch(`${baseUrl}/api/modules/${moduleKey}?page=1&pageSize=10`, { headers: { Cookie: ownerCookie } });
  const body = await response.json();
  ensure(response.status === 200 && Array.isArray(body.rows), `${moduleKey} devolvió ${response.status}`);
  residentModules[moduleKey] = body.total;
}

const ownerHomes = await fetch(`${baseUrl}/api/homes`, { headers: { Cookie: ownerCookie } });
const ownerHomesBody = await ownerHomes.json();
const ownerHome = ownerHomesBody.homes?.[0];
ensure(ownerHomes.status === 200 && ownerHome, `Mi vivienda devolvió ${ownerHomes.status}`);
ensure(typeof ownerHome.builtAreaM2 === "number" && typeof ownerHome.usableAreaM2 === "number", "Mi vivienda no incluye las superficies");
ensure(["fixed_amount", "participation_coefficient"].includes(ownerHome.quotaMethod), "Mi vivienda no incluye el criterio de cuota");

const ownerLogout = await fetch(`${baseUrl}/api/auth/logout`, {
  method: "POST",
  headers: { Origin: baseUrl, Cookie: ownerCookie }
});
ensure(ownerLogout.status === 200, `Logout de propietaria devolvió ${ownerLogout.status}`);

console.log(JSON.stringify({
  login: "ok",
  csrfOriginCheck: "ok",
  tenantList: listBody.total,
  create: "ok",
  optimisticUpdate: "ok",
  archiveAndRestore: "ok",
  csvExport: "ok",
  settings: "ok",
  settingsAuthorization: "ok",
  integrationsLifecycle: "ok",
  logout: "ok",
  residentModules,
  ownerHome: {
    code: ownerHome.code,
    builtAreaM2: ownerHome.builtAreaM2,
    usableAreaM2: ownerHome.usableAreaM2,
    quotaMethod: ownerHome.quotaMethod
  }
}, null, 2));
