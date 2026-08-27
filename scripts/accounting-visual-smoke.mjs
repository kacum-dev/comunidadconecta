import { spawn } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = "http://127.0.0.1:3121";
const debugUrl = "http://127.0.0.1:9334";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outputDirectory = resolve("tmp", "accounting-visual");
const profileDirectory = resolve("tmp", "runtime", `chrome-accounting-${Date.now()}`);
const email = process.env.SEED_ADMIN_EMAIL;
const password = process.env.SEED_ADMIN_PASSWORD;

if (!email || !password) throw new Error("Faltan credenciales sintéticas para la comprobación visual contable");

await mkdir(outputDirectory, { recursive: true });
await mkdir(profileDirectory, { recursive: true });
await mkdir(resolve(".next", "standalone", ".next"), { recursive: true });
await cp(resolve(".next", "static"), resolve(".next", "standalone", ".next", "static"), { recursive: true, force: true });
await cp(resolve("public"), resolve(".next", "standalone", "public"), { recursive: true, force: true });

const server = spawn(process.execPath, [".next/standalone/server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: "3121", HOSTNAME: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true,
});
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-6_000); });
server.stderr.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-6_000); });

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=9334",
  `--user-data-dir=${profileDirectory}`,
  "about:blank",
], { stdio: "ignore", windowsHide: true });

function delay(milliseconds) {
  return new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
}

async function waitForUrl(url, attempts = 240) {
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
let commandId = 0;
const pending = new Map();
const listeners = new Map();

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

async function evaluate(expression) {
  const result = await command("Runtime.evaluate", { expression, awaitPromise: true, returnByValue: true });
  if (result.exceptionDetails) throw new Error(result.exceptionDetails.exception?.description || result.exceptionDetails.text || "Error en el navegador");
  return result.result.value;
}

async function navigate(url) {
  const loaded = once("Page.loadEventFired");
  await command("Page.navigate", { url });
  await loaded;
  await delay(350);
}

async function waitFor(expression, attempts = 120) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    if (await evaluate(expression)) return;
    await delay(250);
  }
  throw new Error(`No se cumplió la condición: ${expression}`);
}

async function setViewport(width, height, mobile = false) {
  await command("Emulation.setDeviceMetricsOverride", {
    width,
    height,
    deviceScaleFactor: 1,
    mobile,
    screenWidth: width,
    screenHeight: height,
  });
}

async function screenshot(filename) {
  const result = await command("Page.captureScreenshot", {
    format: "png",
    fromSurface: true,
    captureBeyondViewport: false,
  });
  await writeFile(resolve(outputDirectory, filename), Buffer.from(result.data, "base64"));
}

async function openEntryDialog() {
  await navigate(`${baseUrl}/economia`);
  await waitFor("Boolean(document.querySelector('.finance-workspace .heading-actions button'))");
  await evaluate(`Array.from(document.querySelectorAll('.heading-actions button')).find((button) => button.textContent.includes('Contabilidad'))?.click()`);
  await waitFor("Boolean(document.querySelector('[data-accounting-workspace]'))");
  await evaluate(`Array.from(document.querySelectorAll('[data-accounting-workspace] button')).find((button) => button.textContent.includes('Nuevo asiento'))?.click()`);
  await waitFor("document.querySelector('.record-dialog h2')?.textContent.includes('Nuevo asiento')");
}

function validateCommon(diagnostic, viewportName) {
  if (diagnostic.documentWidth > diagnostic.viewportWidth) throw new Error(`Hay desbordamiento horizontal en ${viewportName}`);
  if (!diagnostic.title?.includes("Nuevo asiento")) throw new Error(`No se abrió el editor contable en ${viewportName}`);
  if (diagnostic.accounts < 80 || diagnostic.journals < 7) throw new Error(`El editor no ofrece el catálogo completo en ${viewportName}`);
  if (diagnostic.controls.some((control) => control.background === "rgb(17, 17, 22)")) throw new Error(`Persisten campos negros en el tema claro (${viewportName})`);
  if (diagnostic.controls.some((control) => control.color === "rgb(17, 17, 22)" && control.background === "rgb(17, 17, 22)")) throw new Error(`Hay texto ilegible en ${viewportName}`);
}

try {
  await waitForUrl(`${baseUrl}/login`);
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

  await setViewport(1440, 1000);
  await navigate(`${baseUrl}/login`);
  const login = await evaluate(`(async () => {
    const response = await fetch('/api/auth/login', {
      method: 'POST', credentials: 'include', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email: ${JSON.stringify(email)}, password: ${JSON.stringify(password)} })
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  })()`);
  if (!login.ok) throw new Error(`No se pudo autenticar Chrome (${login.status}): ${login.body}`);

  await navigate(`${baseUrl}/proveedores`);
  await waitFor("document.querySelectorAll('.nav-group-toggle').length === 3");
  await screenshot("admin-menu-desktop.png");
  const desktopMenu = await evaluate(`(() => {
    const items = Array.from(document.querySelectorAll('.admin-sidebar-nav .nav-item'));
    const groups = Array.from(document.querySelectorAll('.nav-group-toggle'));
    return {
      primary: Array.from(document.querySelectorAll('.admin-primary-nav .nav-item')).map((item) => item.textContent.trim()),
      groups: groups.map((group) => ({ label: group.querySelector(':scope > span:nth-child(2)')?.textContent, expanded: group.getAttribute('aria-expanded') })),
      active: document.querySelector('.admin-sidebar-nav .nav-item.active')?.textContent.trim(),
      itemFontSizes: items.map((item) => Number.parseFloat(getComputedStyle(item).fontSize)),
      groupFontSizes: groups.map((group) => Number.parseFloat(getComputedStyle(group).fontSize)),
      sidebarFits: document.querySelector('.sidebar').scrollWidth <= document.querySelector('.sidebar').clientWidth,
    };
  })()`);
  if (desktopMenu.primary.join('|') !== 'Inicio|Economía|Notificaciones') throw new Error("Los accesos principales del menú no tienen el orden esperado");
  if (desktopMenu.groups.length !== 3 || desktopMenu.groups.filter((group) => group.expanded === "true").length !== 1 || desktopMenu.groups.find((group) => group.label === "Operaciones")?.expanded !== "true") throw new Error("Los grupos del menú administrativo no se pliegan correctamente");
  if (desktopMenu.active !== "Proveedores") throw new Error("El menú no conserva la opción activa");
  if (desktopMenu.itemFontSizes.some((size) => size < 14) || desktopMenu.groupFontSizes.some((size) => size < 13)) throw new Error("El texto del menú administrativo sigue siendo demasiado pequeño");
  if (!desktopMenu.sidebarFits) throw new Error("El menú administrativo desborda horizontalmente");

  await navigate(`${baseUrl}/configuracion?tab=accounting`);
  await waitFor("Boolean(document.querySelector('.settings-accounting-status'))");
  await screenshot("accounting-settings-desktop.png");
  const accountingSettings = await evaluate(`(() => ({
    title: document.querySelector('#settings-accounting-title')?.textContent,
    status: document.querySelector('.settings-accounting-status strong')?.textContent,
    tabs: document.querySelectorAll('.settings-nav > button').length,
    administrationExpanded: Array.from(document.querySelectorAll('.nav-group-toggle')).find((button) => button.textContent.includes('Administración'))?.getAttribute('aria-expanded'),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
  }))()`);
  if (accountingSettings.title !== "Contabilidad de la comunidad" || accountingSettings.tabs !== 6) throw new Error("La configuración contable no está completa");
  if (accountingSettings.administrationExpanded !== "true") throw new Error("El menú no abre automáticamente el grupo de la ruta activa");
  if (accountingSettings.documentWidth > accountingSettings.viewportWidth) throw new Error("La configuración contable desborda horizontalmente");

  await openEntryDialog();
  await screenshot("accounting-entry-desktop.png");
  const desktop = await evaluate(`(() => {
    const dialog = document.querySelector('.record-dialog');
    const rect = dialog.getBoundingClientRect();
    const controls = Array.from(dialog.querySelectorAll('input, select, textarea')).slice(0, 8).map((control) => {
      const style = getComputedStyle(control);
      return { background: style.backgroundColor, color: style.color, width: Math.round(control.getBoundingClientRect().width) };
    });
    return {
      title: dialog.querySelector('h2')?.textContent,
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      dialog: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), height: Math.round(rect.height) },
      controls,
      accounts: dialog.querySelectorAll('select[aria-label^="Cuenta línea"] option').length,
      journals: dialog.querySelectorAll('label select')[1]?.options.length || 0,
      amountWidths: Array.from(dialog.querySelectorAll('input[aria-label^="Debe línea"], input[aria-label^="Haber línea"]')).map((input) => Math.round(input.getBoundingClientRect().width)),
      footerVisible: dialog.querySelector('footer')?.getBoundingClientRect().bottom <= document.documentElement.clientHeight + 1,
    };
  })()`);
  validateCommon(desktop, "escritorio");
  if (desktop.dialog.left < 0 || desktop.dialog.right > desktop.viewportWidth || !desktop.footerVisible) throw new Error("El diálogo contable no cabe en el escritorio");
  if (desktop.amountWidths.some((width) => width < 90)) throw new Error("Los importes siguen demasiado estrechos en escritorio");

  await setViewport(390, 844, true);
  await navigate(`${baseUrl}/proveedores`);
  await evaluate(`document.querySelector('button[aria-label="Abrir menú"]')?.click()`);
  await waitFor("document.querySelector('.sidebar')?.classList.contains('is-open')");
  await delay(350);
  await screenshot("admin-menu-mobile.png");
  const mobileMenu = await evaluate(`(() => {
    const sidebar = document.querySelector('.sidebar');
    const items = Array.from(sidebar.querySelectorAll('.admin-sidebar-nav .nav-item'));
    return {
      width: Math.round(sidebar.getBoundingClientRect().width),
      left: Math.round(sidebar.getBoundingClientRect().left),
      right: Math.round(sidebar.getBoundingClientRect().right),
      viewportWidth: document.documentElement.clientWidth,
      itemFontSizes: items.map((item) => Number.parseFloat(getComputedStyle(item).fontSize)),
      active: sidebar.querySelector('.nav-item.active')?.textContent.trim(),
    };
  })()`);
  if (mobileMenu.left < 0 || mobileMenu.right > mobileMenu.viewportWidth || mobileMenu.itemFontSizes.some((size) => size < 14) || mobileMenu.active !== "Proveedores") throw new Error("El menú administrativo móvil no es legible o desborda");

  await openEntryDialog();
  await screenshot("accounting-entry-mobile.png");
  const mobile = await evaluate(`(() => {
    const dialog = document.querySelector('.record-dialog');
    const rect = dialog.getBoundingClientRect();
    const controls = Array.from(dialog.querySelectorAll('input, select, textarea')).slice(0, 8).map((control) => {
      const style = getComputedStyle(control);
      return { background: style.backgroundColor, color: style.color, width: Math.round(control.getBoundingClientRect().width) };
    });
    const firstLine = dialog.querySelector('input[aria-label^="Debe línea"]')?.closest('div');
    return {
      title: dialog.querySelector('h2')?.textContent,
      viewportWidth: document.documentElement.clientWidth,
      documentWidth: document.documentElement.scrollWidth,
      dialog: { left: Math.round(rect.left), right: Math.round(rect.right), width: Math.round(rect.width), height: Math.round(rect.height) },
      controls,
      accounts: dialog.querySelectorAll('select[aria-label^="Cuenta línea"] option').length,
      journals: dialog.querySelectorAll('label select')[1]?.options.length || 0,
      lineWidth: firstLine ? Math.round(firstLine.getBoundingClientRect().width) : 0,
      amountWidths: Array.from(dialog.querySelectorAll('input[aria-label^="Debe línea"], input[aria-label^="Haber línea"]')).map((input) => Math.round(input.getBoundingClientRect().width)),
    };
  })()`);
  validateCommon(mobile, "móvil");
  if (mobile.dialog.left < 0 || mobile.dialog.right > mobile.viewportWidth) throw new Error("El diálogo contable desborda en móvil");
  if (mobile.amountWidths.some((width) => width < 100)) throw new Error("Los importes siguen demasiado estrechos en móvil");

  console.log(JSON.stringify({ screenshots: outputDirectory, desktopMenu, accountingSettings, desktop, mobileMenu, mobile }, null, 2));
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\nServidor:\n${serverLog}`);
} finally {
  if (socket?.readyState === WebSocket.OPEN) await command("Browser.close").catch(() => undefined);
  socket?.close();
  chrome.kill();
  server.kill();
  await delay(300);
}
