import { spawn } from "node:child_process";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = "http://127.0.0.1:3110";
const debugUrl = "http://127.0.0.1:9333";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outputDirectory = resolve("tmp", "visual");
const profileDirectory = resolve("tmp", "runtime", "chrome-visual-profile");
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;
const ownerEmail = "ana.torres@demo.comunidadconecta.local";
const ownerPassword = process.env.SEED_DEMO_PASSWORD || password;

if (!email || !password) throw new Error("Faltan credenciales sintéticas para la comprobación visual");

await mkdir(outputDirectory, { recursive: true });
await rm(profileDirectory, { recursive: true, force: true });
await mkdir(profileDirectory, { recursive: true });

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3110"], {
  cwd: process.cwd(),
  env: process.env,
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-6000); });
server.stderr.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-6000); });

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--disable-default-apps",
  "--disable-sync",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=9333",
  `--user-data-dir=${profileDirectory}`,
  "about:blank"
], { stdio: "ignore", windowsHide: true });

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForUrl(url, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return response;
    } catch {}
    await delay(250);
  }
  throw new Error(`No respondió ${url}`);
}

let socket;
const pending = new Map();
const listeners = new Map();
let commandId = 0;
let demoSettingsToRestore = null;

function command(method, params = {}) {
  return new Promise((resolvePromise, reject) => {
    commandId += 1;
    pending.set(commandId, { resolve: resolvePromise, reject });
    socket.send(JSON.stringify({ id: commandId, method, params }));
  });
}

function once(method, timeout = 15_000) {
  return new Promise((resolvePromise, reject) => {
    const timer = setTimeout(() => reject(new Error(`Timeout esperando ${method}`)), timeout);
    listeners.set(method, (params) => {
      clearTimeout(timer);
      listeners.delete(method);
      resolvePromise(params);
    });
  });
}

async function navigate(url) {
  const loaded = once("Page.loadEventFired");
  await command("Page.navigate", { url });
  await loaded;
  await delay(350);
}

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.text || "Error evaluando el navegador");
  return result.result.value;
}

async function waitFor(expression, attempts = 80) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(expression)) return;
    await delay(250);
  }
  throw new Error(`No se cumplió la condición: ${expression}`);
}

async function screenshot(filename) {
  const result = await command("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(outputDirectory, filename), Buffer.from(result.data, "base64"));
}

async function setViewport(width, height, mobile = false) {
  await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
}

async function restoreDemoSettings() {
  if (!demoSettingsToRestore || socket?.readyState !== WebSocket.OPEN) return;
  const snapshot = demoSettingsToRestore;
  const result = await evaluate(`(async () => {
    const login = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} })
    });
    if (!login.ok) return { ok: false, stage: 'login', status: login.status };
    const role = await fetch('/api/context/role', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'platform_admin' })
    });
    if (!role.ok) return { ok: false, stage: 'role', status: role.status };
    const current = ${JSON.stringify(snapshot)};
    const response = await fetch('/api/settings/demo', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: current.enabled, title: current.title, description: current.description,
        enabledRoles: current.enabledRoles, sessionDurationMinutes: current.sessionDurationMinutes,
        expiresAt: current.expiresAt })
    });
    return { ok: response.ok, stage: 'settings', status: response.status };
  })()`);
  if (!result.ok) throw new Error(`No se pudo restaurar la demo (${result.stage}: ${result.status})`);
  demoSettingsToRestore = null;
}

try {
  await waitForUrl(`${baseUrl}/login`);
  const versionResponse = await waitForUrl(`${debugUrl}/json/version`);
  await versionResponse.json();
  const targetResponse = await fetch(`${debugUrl}/json/new?${encodeURIComponent("about:blank")}`, { method: "PUT" });
  const target = await targetResponse.json();
  socket = new WebSocket(target.webSocketDebuggerUrl);
  await new Promise((resolvePromise, reject) => {
    socket.addEventListener("open", resolvePromise, { once: true });
    socket.addEventListener("error", reject, { once: true });
  });
  socket.addEventListener("message", (event) => {
    const message = JSON.parse(event.data);
    if (message.id) {
      const waiting = pending.get(message.id);
      if (!waiting) return;
      pending.delete(message.id);
      if (message.error) waiting.reject(new Error(message.error.message));
      else waiting.resolve(message.result);
      return;
    }
    listeners.get(message.method)?.(message.params);
  });

  await command("Page.enable");
  await command("Runtime.enable");
  await command("Network.enable");
  await command("Network.setCacheDisabled", { cacheDisabled: true });

  await setViewport(1440, 900);
  await navigate(`${baseUrl}/login`);
  await waitFor("Boolean(document.querySelector('.login-form'))");
  await screenshot("01-login-desktop.png");

  const loginResult = await evaluate(`(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} })
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  })()`);
  if (!loginResult.ok) throw new Error(`No se pudo autenticar Chrome (${loginResult.status}): ${loginResult.body}`);
  const browserCookies = await command("Network.getAllCookies");
  if (!browserCookies.cookies.some((cookie) => cookie.name === "cc_session")) {
    throw new Error("Chrome no conservó la cookie de sesión segura");
  }
  await navigate(`${baseUrl}/inicio`);
  const dashboardDiagnostic = await evaluate(`({ path: location.pathname, title: document.title, text: document.body.innerText.slice(0, 300) })`);
  if (dashboardDiagnostic.path !== "/inicio") {
    throw new Error(`La navegación autenticada terminó en ${dashboardDiagnostic.path}: ${dashboardDiagnostic.text}`);
  }
  try {
    await waitFor("Boolean(document.querySelector('.dashboard-page'))", 120);
  } catch {
    await screenshot("debug-dashboard.png");
    const failure = await evaluate(`({ path: location.pathname, title: document.title, text: document.body.innerText.slice(0, 1200), html: document.body.innerHTML.slice(0, 500) })`);
    throw new Error(`El panel no llegó a renderizarse: ${JSON.stringify(failure)}\nServidor:\n${serverLog}`);
  }
  await screenshot("02-dashboard-desktop.png");

  await navigate(`${baseUrl}/economia?view=records`);
  await waitFor("Boolean(document.querySelector('.data-table tbody tr:not(.skeleton-row)'))", 120);
  await screenshot("03-economia-desktop.png");

  const desktopLayout = await evaluate(`({
    path: location.pathname,
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    rows: document.querySelectorAll('.data-table tbody tr:not(.skeleton-row)').length,
    title: document.querySelector('h1')?.textContent
  })`);

  await navigate(`${baseUrl}/configuracion`);
  await waitFor("Boolean(document.querySelector('.settings-page .settings-panel'))", 120);
  await screenshot("04-settings-desktop.png");
  const settingsDesktop = await evaluate(`({
    path: location.pathname,
    title: document.querySelector('h1')?.textContent,
    tabs: document.querySelectorAll('.settings-nav > button').length,
    visibleFields: document.querySelectorAll('.settings-panel input, .settings-panel select, .settings-panel textarea').length,
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);
  await evaluate(`Array.from(document.querySelectorAll('.settings-nav > button')).find((button) => button.textContent.includes('Conexiones'))?.click()`);
  await waitFor("Boolean(document.querySelector('.settings-integrations-panel'))");
  await screenshot("05-settings-connections-desktop.png");
  const settingsConnections = await evaluate(`({
    empty: Boolean(document.querySelector('.settings-integrations-empty')),
    cards: document.querySelectorAll('.settings-integration-card').length,
    warning: document.querySelector('.settings-integrations-panel')?.innerText.includes('SETTINGS_ENCRYPTION_KEY'),
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);

  await navigate(`${baseUrl}/incidencias`);
  await waitFor("Boolean(document.querySelector('.operations-table tbody tr'))", 120);
  await screenshot("06-admin-incidents-table-desktop.png");
  await evaluate(`document.querySelector('.operations-table tbody tr')?.click()`);
  await waitFor("Boolean(document.querySelector('.operations-detail-dialog'))", 120);
  await screenshot("06-admin-incident-detail-desktop.png");
  const incidentsDesktop = await evaluate(`({
    rows: document.querySelectorAll('.operations-table tbody tr').length,
    tabs: document.querySelectorAll('.operations-detail-tabs button').length,
    tabLabels: Array.from(document.querySelectorAll('.operations-detail-tabs button')).map((button) => button.textContent.trim()),
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);
  await evaluate(`document.querySelector('.operations-detail-dialog .dialog-header .icon-button')?.click()`);
  await waitFor("!document.querySelector('.operations-detail-dialog')");

  await navigate(`${baseUrl}/economia`);
  await waitFor("Boolean(document.querySelector('.finance-workspace .heading-actions button'))", 120);
  await evaluate(`Array.from(document.querySelectorAll('.heading-actions button')).find((button) => button.textContent.includes('Presupuestos y cuotas'))?.click()`);
  await waitFor("Boolean(document.querySelector('.fees-workspace .fee-forecast'))", 120);
  await evaluate(`Array.from(document.querySelectorAll('.fees-workspace .page-heading button')).find((button) => button.textContent.includes('Emitir o programar'))?.click()`);
  await waitFor("Boolean(document.querySelector('.recurring-fees-dialog'))", 120);
  await screenshot("06-admin-recurring-fee-desktop.png");
  const recurringFeesDesktop = await evaluate(`({
    forecastCards: document.querySelectorAll('.fee-forecast article').length,
    recurrenceOptions: document.querySelectorAll('.fee-recurrence-options label').length,
    dialogVisible: Boolean(document.querySelector('.recurring-fees-dialog')),
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);

  await navigate(`${baseUrl}/juntas`);
  await waitFor("Boolean(document.querySelector('.governance-workspace .meeting-lifecycle'))", 120);
  await screenshot("06-admin-juntas-desktop.png");
  const governanceDesktop = await evaluate(`({
    milestones: document.querySelectorAll('.meeting-lifecycle .meeting-milestone').length,
    actions: document.querySelectorAll('.meeting-lifecycle .meeting-milestone-action').length,
    profileAction: Boolean(document.querySelector('.meeting-lifecycle-header > .button')),
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);

  await setViewport(390, 844, true);
  await navigate(`${baseUrl}/inicio`);
  await waitFor("Boolean(document.querySelector('.dashboard-page'))");
  await screenshot("04-dashboard-mobile.png");
  const mobileDashboardLayout = await evaluate(`({
    path: location.pathname,
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    mobileTopbar: getComputedStyle(document.querySelector('.mobile-topbar')).display,
    sidebarVisible: document.querySelector('.sidebar').getBoundingClientRect().left >= 0
  })`);

  await navigate(`${baseUrl}/configuracion`);
  await waitFor("Boolean(document.querySelector('.settings-page .settings-panel'))", 120);
  await evaluate(`Array.from(document.querySelectorAll('.settings-nav > button')).find((button) => button.textContent.includes('Copias de seguridad'))?.click()`);
  await waitFor("Boolean(document.querySelector('.settings-backup-status'))");
  await screenshot("06-settings-backups-mobile.png");
  const settingsMobile = await evaluate(`({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    navOverflow: document.querySelector('.settings-nav').scrollWidth > document.querySelector('.settings-nav').clientWidth,
    saveVisible: getComputedStyle(document.querySelector('.settings-save-footer')).display !== 'none'
  })`);

  await navigate(`${baseUrl}/incidencias`);
  await waitFor("Boolean(document.querySelector('.operations-mobile-list > button'))", 120);
  await screenshot("06-admin-incidents-table-mobile.png");
  await evaluate(`document.querySelector('.operations-mobile-list > button')?.click()`);
  await waitFor("Boolean(document.querySelector('.operations-detail-dialog'))", 120);
  await screenshot("06-admin-incident-detail-mobile.png");
  const incidentsMobile = await evaluate(`({
    cards: document.querySelectorAll('.operations-mobile-list > button').length,
    tabs: document.querySelectorAll('.operations-detail-tabs button').length,
    dialogHeight: Math.round(document.querySelector('.operations-detail-dialog').getBoundingClientRect().height),
    viewportHeight: document.documentElement.clientHeight,
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);
  await evaluate(`document.querySelector('.operations-detail-dialog .dialog-header .icon-button')?.click()`);
  await waitFor("!document.querySelector('.operations-detail-dialog')");

  await navigate(`${baseUrl}/incidencias?view=records`);
  await waitFor("Boolean(document.querySelector('.mobile-record'))", 120);
  await screenshot("05-incidencias-mobile.png");
  const mobileTableLayout = await evaluate(`({
    path: location.pathname,
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    cards: document.querySelectorAll('.mobile-record').length,
    desktopTable: getComputedStyle(document.querySelector('.table-scroll')).display
  })`);

  await navigate(`${baseUrl}/juntas`);
  await waitFor("Boolean(document.querySelector('.governance-workspace .meeting-lifecycle'))", 120);
  await screenshot("06-admin-juntas-mobile.png");
  const governanceMobile = await evaluate(`({
    milestones: document.querySelectorAll('.meeting-lifecycle .meeting-milestone').length,
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);

  const ownerLoginResult = await evaluate(`(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST',
      credentials: 'include',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(ownerEmail)}, password: ${JSON.stringify(ownerPassword)} })
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  })()`);
  if (!ownerLoginResult.ok) throw new Error(`No se pudo autenticar la propietaria (${ownerLoginResult.status}): ${ownerLoginResult.body}`);

  await setViewport(390, 844, true);
  await navigate(`${baseUrl}/inicio`);
  await waitFor("Boolean(document.querySelector('.resident-home-status-main'))", 120);
  await screenshot("06-owner-dashboard-mobile.png");
  const ownerDashboardMobile = await evaluate(`({
    homeHref: document.querySelector('.resident-home-status-main')?.getAttribute('href'),
    homeSummary: document.querySelector('.resident-home-status-main')?.innerText,
    statusSummary: document.querySelector('.resident-home-status-indicator')?.getAttribute('aria-label'),
    quickActions: document.querySelectorAll('.resident-quick-actions > a').length,
    quickColumns: getComputedStyle(document.querySelector('.resident-quick-actions')).gridTemplateColumns.split(' ').length,
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);
  await evaluate(`document.querySelector('.resident-home-status-main')?.click()`);
  await waitFor("location.pathname === '/mi-vivienda' && Boolean(document.querySelector('.resident-bank-home-card'))", 120);
  await screenshot("07-owner-home-mobile.png");
  await evaluate(`document.querySelector('.resident-home-accordions details summary')?.click()`);
  await waitFor("Boolean(document.querySelector('.resident-home-accordions details[open]'))");
  await screenshot("07-owner-home-details-mobile.png");
  const ownerHomeMobile = await evaluate(`({
    facts: document.querySelector('.resident-home-accordions details[open] .resident-home-facts')?.innerText,
    duplicatedHeading: Boolean(document.querySelector('.my-home-page > .page-heading')),
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);

  await setViewport(1440, 900);
  await navigate(`${baseUrl}/economia`);
  await waitFor("Boolean(document.querySelector('.data-table tbody tr:not(.skeleton-row)'))", 120);
  await screenshot("06-owner-receipts-desktop.png");
  const ownerReceiptsDesktop = await evaluate(`({
    title: document.querySelector('h1')?.textContent,
    rows: document.querySelectorAll('.data-table tbody tr:not(.skeleton-row)').length,
    table: getComputedStyle(document.querySelector('.table-scroll')).display,
    cards: getComputedStyle(document.querySelector('.mobile-record-list')).display
  })`);

  await navigate(`${baseUrl}/mi-vivienda`);
  await waitFor("Boolean(document.querySelector('.resident-home-facts'))", 120);
  await screenshot("07-owner-home-desktop.png");
  const ownerHome = await evaluate(`({
    facts: document.querySelector('.resident-home-facts')?.textContent,
    quota: document.querySelector('.resident-economic-summary')?.textContent
  })`);

  await navigate(`${baseUrl}/avisos`);
  await waitFor("Boolean(document.querySelector('.data-table tbody tr:not(.skeleton-row)'))", 120);
  await screenshot("08-owner-notices-desktop.png");

  await setViewport(390, 844, true);
  await navigate(`${baseUrl}/economia`);
  await waitFor("Boolean(document.querySelector('.data-table tbody tr:not(.skeleton-row)'))", 120);
  await screenshot("09-owner-receipts-mobile.png");
  const ownerReceiptsMobile = await evaluate(`({
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth,
    table: getComputedStyle(document.querySelector('.table-scroll')).display,
    cards: getComputedStyle(document.querySelector('.mobile-record-list')).display,
    tableScroll: (() => { const element = document.querySelector('.table-scroll'); const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return { left: rect.left, right: rect.right, width: rect.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: style.overflowX, position: style.position }; })(),
    dataCard: (() => { const element = document.querySelector('.data-card'); const rect = element.getBoundingClientRect(); const style = getComputedStyle(element); return { left: rect.left, right: rect.right, width: rect.width, clientWidth: element.clientWidth, scrollWidth: element.scrollWidth, overflowX: style.overflowX }; })(),
    overflowElements: Array.from(document.querySelectorAll('body *')).map((element) => {
      const rect = element.getBoundingClientRect();
      return { tag: element.tagName, className: element.className, left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), scrollWidth: element.scrollWidth };
    }).filter((element) => element.right > document.documentElement.clientWidth + 1 || element.width > document.documentElement.clientWidth + 1).slice(0, 12)
  })`);
  await evaluate(`document.querySelector('.resident-receipts-workbench .record-primary')?.click()`);
  await waitFor("Boolean(document.querySelector('.record-dialog .readonly-record-content'))", 120);
  await screenshot("09-owner-receipt-detail-mobile.png");
  const ownerReceiptDetail = await evaluate(`({
    controls: document.querySelectorAll('.record-dialog input, .record-dialog select, .record-dialog textarea').length,
    facts: document.querySelectorAll('.record-dialog .readonly-record-facts > div').length,
    text: document.querySelector('.record-dialog .readonly-record-content')?.innerText,
    footerBottom: Math.round(document.querySelector('.record-dialog .dialog-footer').getBoundingClientRect().bottom),
    viewportHeight: document.documentElement.clientHeight
  })`);
  await evaluate(`document.querySelector('.record-dialog .dialog-header .icon-button')?.click()`);
  await waitFor("!document.querySelector('.record-dialog')");

  const residentModuleDetails = {};
  for (const moduleKey of ["avisos", "juntas", "activos", "documentos"]) {
    await navigate(`${baseUrl}/${moduleKey}`);
    await waitFor("Boolean(document.querySelector('.mobile-record:not(.mobile-record-skeleton)'))", 120);
    await screenshot(`10-owner-${moduleKey}-mobile.png`);
    const expectedDownload = await evaluate(`Boolean(document.querySelector('.mobile-record:not(.mobile-record-skeleton) .mobile-record-download'))`);
    const headerAlignment = await evaluate(`(() => {
      const heading = document.querySelector('.resident-workbench .module-heading');
      const filter = document.querySelector('.resident-mobile-tools');
      const headingRect = heading?.getBoundingClientRect();
      const filterRect = filter?.getBoundingClientRect();
      return headingRect && filterRect ? Math.abs((headingRect.top + headingRect.height / 2) - (filterRect.top + filterRect.height / 2)) : null;
    })()`);
    await evaluate(`(document.querySelector('.mobile-record:has(.mobile-record-download) .mobile-record-button') || document.querySelector('.mobile-record:not(.mobile-record-skeleton) .mobile-record-button'))?.click()`);
    await waitFor("Boolean(document.querySelector('.record-dialog'))", 120);
    if (moduleKey === "juntas") await waitFor("Boolean(document.querySelector('.record-dialog .meeting-lifecycle'))", 120);
    await screenshot(`11-owner-${moduleKey}-detail-mobile.png`);
    residentModuleDetails[moduleKey] = { ...await evaluate(`({
      title: document.querySelector('.record-dialog h2')?.textContent,
      controls: document.querySelectorAll('.record-dialog input, .record-dialog select, .record-dialog textarea').length,
      emptyControls: Array.from(document.querySelectorAll('.record-dialog input, .record-dialog select, .record-dialog textarea')).filter((control) => !control.value).length,
      facts: document.querySelectorAll('.record-dialog .readonly-record-facts > div').length,
      text: document.querySelector('.record-dialog .readonly-record-content')?.innerText,
      download: Boolean(document.querySelector('.record-dialog a[href*="/api/documents/"]')),
      viewport: document.documentElement.clientWidth,
      scrollWidth: document.documentElement.scrollWidth,
      dialogHeight: Math.round(document.querySelector('.record-dialog').getBoundingClientRect().height)
    })`), expectedDownload, headerAlignment };
    await evaluate(`document.querySelector('.record-dialog .dialog-header .icon-button')?.click()`);
    await waitFor("!document.querySelector('.record-dialog')");
  }

  const adminTourLogin = await evaluate(`(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} })
    });
    if (!response.ok) return { ok: false, status: response.status };
    const role = await fetch('/api/context/role', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'platform_admin' })
    });
    return { ok: role.ok, status: role.status };
  })()`);
  if (!adminTourLogin.ok) throw new Error(`No se pudo preparar la visita demo (${adminTourLogin.status})`);
  const demoSettings = await evaluate(`(async () => {
    const response = await fetch('/api/settings/demo', { cache: 'no-store' });
    return { ok: response.ok, status: response.status, body: await response.json() };
  })()`);
  if (!demoSettings.ok) throw new Error(`No se pudo leer la configuracion demo (${demoSettings.status})`);
  demoSettingsToRestore = demoSettings.body;
  const enabledDemo = await evaluate(`(async () => {
    const current = ${JSON.stringify(demoSettings.body)};
    const response = await fetch('/api/settings/demo', {
      method: 'PATCH', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ enabled: true, title: current.title, description: current.description,
        enabledRoles: current.enabledRoles, sessionDurationMinutes: current.sessionDurationMinutes,
        expiresAt: current.expiresAt })
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  })()`);
  if (!enabledDemo.ok) throw new Error(`No se pudo activar la demo para la visita (${enabledDemo.status}): ${enabledDemo.body}`);
  const demoTourLogin = await evaluate(`(async () => {
    const response = await fetch('/api/demo/session', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ role: 'owner', accessCode: '' })
    });
    sessionStorage.removeItem('cc-demo-tour-seen:owner');
    return { ok: response.ok, status: response.status, body: await response.text() };
  })()`);
  if (!demoTourLogin.ok) throw new Error(`No se pudo iniciar la visita demo (${demoTourLogin.status}): ${demoTourLogin.body}`);

  await setViewport(390, 844, true);
  await navigate(`${baseUrl}/inicio`);
  await waitFor("Boolean(document.querySelector('.demo-tour-card'))", 120);
  await screenshot("12-demo-tour-owner-mobile.png");
  await evaluate(`document.querySelector('.demo-tour-card .button-primary')?.click()`);
  await waitFor("document.querySelector('.demo-tour-card h2')?.textContent.includes('Lo que más utilizas')", 120);
  await evaluate(`document.querySelector('.demo-tour-card .button-primary')?.click()`);
  await waitFor("location.pathname === '/mi-vivienda' && document.querySelector('.demo-tour-card h2')?.textContent.includes('Tu vivienda')", 120);
  await evaluate(`document.querySelector('.demo-tour-card .button-primary')?.click()`);
  await waitFor("location.pathname === '/economia' && document.querySelector('.demo-tour-card h2')?.textContent.includes('previsión anual')", 120);
  await screenshot("12-demo-tour-forecast-mobile.png");
  const demoTourMobile = await evaluate(`({
    title: document.querySelector('.demo-tour-card h2')?.textContent,
    steps: document.querySelectorAll('.demo-tour-progress i').length,
    forecast: document.querySelector('.resident-fee-forecast')?.innerText,
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);
  await evaluate(`document.querySelector('.demo-tour-skip')?.click()`);
  await waitFor("!document.querySelector('.demo-tour-card')");

  await setViewport(1440, 900);
  await evaluate(`document.querySelector('.demo-session-actions button:first-child')?.click()`);
  await waitFor("location.pathname === '/inicio' && Boolean(document.querySelector('.demo-tour-card'))", 120);
  await screenshot("12-demo-tour-owner-desktop.png");
  const demoTourDesktop = await evaluate(`({
    title: document.querySelector('.demo-tour-card h2')?.textContent,
    focusVisible: Boolean(document.querySelector('.demo-tour-focus')),
    bannerAction: document.querySelector('.demo-session-actions button:first-child')?.textContent,
    viewport: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  })`);
  await evaluate(`document.querySelector('.demo-tour-skip')?.click()`);
  await restoreDemoSettings();

  console.log(JSON.stringify({ screenshots: outputDirectory, desktopLayout, settingsDesktop, settingsConnections, incidentsDesktop, recurringFeesDesktop, governanceDesktop, mobileDashboardLayout, settingsMobile, incidentsMobile, mobileTableLayout, governanceMobile, ownerDashboardMobile, ownerHomeMobile, ownerReceiptsDesktop, ownerHome, ownerReceiptsMobile, ownerReceiptDetail, residentModuleDetails, demoTourMobile, demoTourDesktop }, null, 2));
  if (desktopLayout.scrollWidth > desktopLayout.viewport) throw new Error("Desbordamiento horizontal en escritorio");
  if (settingsDesktop.path !== "/configuracion" || settingsDesktop.tabs !== 6 || settingsDesktop.visibleFields < 5) throw new Error("La configuración de escritorio no se renderizó completa");
  if (settingsDesktop.scrollWidth > settingsDesktop.viewport) throw new Error("La configuración desborda en escritorio");
  if ((!settingsConnections.empty && settingsConnections.cards < 1) || settingsConnections.scrollWidth > settingsConnections.viewport) throw new Error("La sección de conexiones no se adapta correctamente");
  if (incidentsDesktop.rows < 1 || incidentsDesktop.tabs !== 4 || incidentsDesktop.scrollWidth > incidentsDesktop.viewport) throw new Error("Las incidencias no usan la tabla y el modal con cuatro pestañas en escritorio");
  if (!incidentsDesktop.tabLabels.some((label) => label.includes("Evidencias")) || !incidentsDesktop.tabLabels.some((label) => label.includes("Seguimiento"))) throw new Error("El detalle de incidencia no organiza evidencias y seguimiento en pestañas");
  if (recurringFeesDesktop.forecastCards !== 4 || recurringFeesDesktop.recurrenceOptions !== 4 || !recurringFeesDesktop.dialogVisible || recurringFeesDesktop.scrollWidth > recurringFeesDesktop.viewport) throw new Error("La previsión o el selector de recurrencia de cuotas no se renderiza correctamente");
  if (demoTourMobile.steps < 5 || !demoTourMobile.title?.includes("previsión anual") || !demoTourMobile.forecast?.includes("Todavía previsto") || demoTourMobile.scrollWidth > demoTourMobile.viewport) throw new Error("La visita demo móvil no recorre la previsión anual correctamente");
  if (!demoTourDesktop.focusVisible || !demoTourDesktop.bannerAction?.includes("Visita guiada") || demoTourDesktop.scrollWidth > demoTourDesktop.viewport) throw new Error("La visita demo no se puede reiniciar o no resalta el contenido en escritorio");
  if (governanceDesktop.milestones < 10 || governanceDesktop.actions < 5 || !governanceDesktop.profileAction || governanceDesktop.scrollWidth > governanceDesktop.viewport) throw new Error("El ciclo administrativo de juntas no se renderiza completo en escritorio");
  if (mobileDashboardLayout.scrollWidth > mobileDashboardLayout.viewport) throw new Error("Desbordamiento horizontal en el panel móvil");
  if (settingsMobile.scrollWidth > settingsMobile.viewport || !settingsMobile.saveVisible) throw new Error("La configuración móvil no se adapta correctamente");
  if (incidentsMobile.cards < 1 || incidentsMobile.tabs !== 4 || incidentsMobile.scrollWidth > incidentsMobile.viewport || incidentsMobile.dialogHeight < incidentsMobile.viewportHeight - 30) throw new Error("El registro o el modal móvil de incidencias no se adapta correctamente");
  if (mobileTableLayout.scrollWidth > mobileTableLayout.viewport) throw new Error("Desbordamiento horizontal en la tabla móvil");
  if (governanceMobile.milestones < 10 || governanceMobile.scrollWidth > governanceMobile.viewport) throw new Error("El ciclo administrativo de juntas no se adapta al móvil");
  if (mobileDashboardLayout.mobileTopbar === "none") throw new Error("La cabecera móvil no se activó");
  if (mobileDashboardLayout.sidebarVisible) throw new Error("La barra lateral móvil aparece abierta por defecto");
  if (mobileTableLayout.desktopTable !== "none") throw new Error("La tabla de escritorio no se sustituyó por tarjetas móviles");
  if (ownerDashboardMobile.homeHref !== "/mi-vivienda" || ownerDashboardMobile.scrollWidth > ownerDashboardMobile.viewport) throw new Error("La tarjeta móvil de vivienda no abre su ficha correctamente");
  if (ownerDashboardMobile.quickActions !== 4 || ownerDashboardMobile.quickColumns !== 4) throw new Error("Los accesos rápidos de Inicio no están alineados en una sola fila");
  if (!ownerHomeMobile.facts?.includes("112,4 m²") || ownerHomeMobile.scrollWidth > ownerHomeMobile.viewport) throw new Error("La ficha móvil de vivienda no muestra sus datos correctamente");
  if (ownerHomeMobile.duplicatedHeading) throw new Error("La ficha móvil de vivienda mantiene un encabezado duplicado");
  if (ownerReceiptsDesktop.title !== "Mis recibos" || ownerReceiptsDesktop.table === "none" || ownerReceiptsDesktop.cards !== "none") throw new Error("Los recibos de la propietaria no usan la tabla común en escritorio");
  if (!ownerHome.facts?.includes("112,4 m²") || !ownerHome.quota?.includes("86,50")) throw new Error("La ficha de vivienda no muestra superficies y cuota");
  if (ownerReceiptsMobile.scrollWidth > ownerReceiptsMobile.viewport) throw new Error("La tabla de recibos desborda el documento en móvil");
  if (ownerReceiptsMobile.table === "none" || ownerReceiptsMobile.cards !== "none") throw new Error("Los recibos dejan de ser tabla en móvil");
  if (ownerReceiptDetail.controls !== 0 || ownerReceiptDetail.facts < 3 || Math.abs(ownerReceiptDetail.footerBottom - ownerReceiptDetail.viewportHeight) > 2) throw new Error("El detalle móvil del recibo no presenta correctamente sus datos");
  if (!ownerReceiptDetail.text?.includes("Fecha y hora de emisión") || !ownerReceiptDetail.text?.includes("Vence el (incluido)") || (!ownerReceiptDetail.text?.includes("Pagado el") && !ownerReceiptDetail.text?.includes("Emitido")) || !/\d{2}:\d{2}/.test(ownerReceiptDetail.text)) throw new Error("El recibo no distingue emisión, vencimiento y pago con precisión temporal");
  for (const [moduleKey, detail] of Object.entries(residentModuleDetails)) {
    if (!detail.title || detail.scrollWidth > detail.viewport || detail.dialogHeight < 800) throw new Error(`El detalle móvil de ${moduleKey} no ocupa correctamente la pantalla`);
    if (detail.headerAlignment === null || detail.headerAlignment > 2) throw new Error(`El filtro móvil de ${moduleKey} no está alineado con el encabezado`);
    if (detail.controls !== 0 || detail.emptyControls !== 0 || (moduleKey !== "documentos" && detail.facts < 2)) throw new Error(`El detalle móvil de ${moduleKey} sigue mostrando un formulario o carece de datos útiles`);
    if (moduleKey === "avisos" && (!detail.text?.includes("Fecha y hora de comunicación") || (!detail.text.includes("hora no registrada") && !/\d{2}:\d{2}/.test(detail.text)))) throw new Error("El aviso no identifica semánticamente su fecha y hora");
    if (moduleKey === "juntas" && (!detail.text?.includes("Ciclo y cumplimiento") || !detail.text.includes("Siguiente:"))) throw new Error("La propietaria no puede consultar el ciclo de la junta");
    if (detail.expectedDownload && !detail.download) throw new Error(`El detalle móvil de ${moduleKey} no permite descargar su archivo`);
  }

} finally {
  await restoreDemoSettings().catch(() => undefined);
  if (socket?.readyState === WebSocket.OPEN) await command("Browser.close").catch(() => undefined);
  socket?.close();
  chrome.kill();
  server.kill();
  await delay(300);
}
