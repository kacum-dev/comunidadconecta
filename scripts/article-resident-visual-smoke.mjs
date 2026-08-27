import { spawn } from "node:child_process";
import { cp, mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = "http://127.0.0.1:3122";
const debugUrl = "http://127.0.0.1:9335";
const chromePath = "C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe";
const outputDirectory = resolve("tmp", "article-resident-visual");
const profileDirectory = resolve("tmp", "runtime", `chrome-article-resident-${Date.now()}`);
const ownerEmail = "ana.torres@demo.comunidadconecta.local";
const ownerPassword = process.env.SEED_DEMO_PASSWORD;

if (!ownerPassword) throw new Error("Falta SEED_DEMO_PASSWORD para la comprobación visual del propietario");

await mkdir(outputDirectory, { recursive: true });
await mkdir(profileDirectory, { recursive: true });
await mkdir(resolve(".next", "standalone", ".next"), { recursive: true });
await cp(resolve(".next", "static"), resolve(".next", "standalone", ".next", "static"), { recursive: true, force: true });
await cp(resolve("public"), resolve(".next", "standalone", "public"), { recursive: true, force: true });

const server = spawn(process.execPath, [".next/standalone/server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: "3122", HOSTNAME: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});
let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-8_000); });
server.stderr.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-8_000); });

const chrome = spawn(chromePath, [
  "--headless=new",
  "--disable-gpu",
  "--disable-extensions",
  "--disable-background-networking",
  "--no-first-run",
  "--no-default-browser-check",
  "--remote-debugging-port=9335",
  `--user-data-dir=${profileDirectory}`,
  "about:blank"
], { stdio: "ignore", windowsHide: true });

const delay = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));

async function waitForUrl(url, attempts = 240) {
  for (let attempt = 0; attempt < attempts; attempt += 1) {
    try {
      const response = await fetch(url);
      if (response.ok) return;
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
  await command("Emulation.setDeviceMetricsOverride", { width, height, deviceScaleFactor: 1, mobile, screenWidth: width, screenHeight: height });
}

async function screenshot(filename) {
  const result = await command("Page.captureScreenshot", { format: "png", fromSurface: true, captureBeyondViewport: false });
  await writeFile(resolve(outputDirectory, filename), Buffer.from(result.data, "base64"));
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
      body: JSON.stringify({ email: ${JSON.stringify(ownerEmail)}, password: ${JSON.stringify(ownerPassword)} })
    });
    return { ok: response.ok, status: response.status, body: await response.text() };
  })()`);
  if (!login.ok) throw new Error(`No se pudo autenticar la cuenta sintética de propietario (${login.status}): ${login.body}`);

  await navigate(`${baseUrl}/ayuda-y-privacidad`);
  await waitFor("document.querySelector('.resident-privacy-heading h1')?.textContent.includes('Tu información')");
  const originalReadingMode = await evaluate("document.querySelector('.resident-reading-card input[type=\"checkbox\"]')?.checked === true");
  await evaluate("document.querySelector('.resident-reading-card input[type=\"checkbox\"]')?.click()");
  await waitFor(`document.querySelector('.platform-shell')?.classList.contains('readable-mode') === ${!originalReadingMode}`);
  await evaluate("document.querySelector('.resident-reading-card input[type=\"checkbox\"]')?.click()");
  await waitFor(`document.querySelector('.platform-shell')?.classList.contains('readable-mode') === ${originalReadingMode}`);
  await screenshot("privacy-desktop.png");
  const privacyDesktop = await evaluate(`(() => ({
    title: document.querySelector('.resident-privacy-heading h1')?.textContent,
    navLink: Array.from(document.querySelectorAll('.resident-app-link')).some((link) => link.textContent.includes('Ayuda y privacidad')),
    panels: document.querySelectorAll('.resident-privacy-panel').length,
    readingToggle: Boolean(document.querySelector('.resident-reading-card input[type="checkbox"]')),
    readingPreferenceRoundTrip: document.querySelector('.resident-reading-card input[type="checkbox"]')?.checked === ${originalReadingMode},
    ownRequests: Boolean(document.querySelector('#requests-title')),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth
  }))()`);
  if (!privacyDesktop.navLink || privacyDesktop.panels < 5 || !privacyDesktop.readingToggle || !privacyDesktop.readingPreferenceRoundTrip || !privacyDesktop.ownRequests || privacyDesktop.documentWidth > privacyDesktop.viewportWidth) {
    throw new Error(`La pantalla de privacidad no está completa en escritorio: ${JSON.stringify(privacyDesktop)}`);
  }

  await navigate(`${baseUrl}/incidencias?new=1`);
  await waitFor("document.querySelector('#resident-task-title')?.textContent.includes('Qué ha ocurrido')");
  await evaluate(`(() => {
    const clickText = (selector, text) => Array.from(document.querySelectorAll(selector)).find((item) => item.textContent.includes(text))?.click();
    clickText('.guided-choice', 'Agua o humedad');
    clickText('.guided-chips button', 'Portal o escalera');
    const description = document.querySelector('textarea');
    const setValue = Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, 'value').set;
    setValue.call(description, 'Hay una filtración junto a los buzones desde esta mañana.');
    description.dispatchEvent(new Event('input', { bubbles: true }));
    clickText('.urgency-grid button', 'Necesita atención');
    const fileInput = document.querySelector('.guided-file-field input');
    const transfer = new DataTransfer();
    transfer.items.add(new File([new Uint8Array([137,80,78,71,13,10,26,10])], 'filtracion.png', { type: 'image/png' }));
    fileInput.files = transfer.files;
    fileInput.dispatchEvent(new Event('change', { bubbles: true }));
    return true;
  })()`);
  await waitFor("document.querySelector('.guided-selected-file')?.textContent.includes('filtracion.png')");
  await evaluate(`Array.from(document.querySelectorAll('.guided-footer button')).find((button) => button.textContent.includes('Revisar incidencia'))?.click()`);
  await waitFor("document.querySelector('#resident-task-title')?.textContent.includes('Comprueba tu incidencia')");
  await screenshot("incident-review-desktop.png");
  const incidentReview = await evaluate(`(() => ({
    title: document.querySelector('#resident-task-title')?.textContent,
    reviewRows: document.querySelectorAll('.incident-review dl > div').length,
    photo: document.querySelector('.incident-review')?.textContent.includes('filtracion.png'),
    visibility: document.querySelector('.incident-visibility-note')?.textContent.includes('Quién podrá verlo'),
    confirms: Array.from(document.querySelectorAll('.guided-footer button')).some((button) => button.textContent.includes('Confirmar y enviar')),
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth
  }))()`);
  if (incidentReview.reviewRows !== 5 || !incidentReview.photo || !incidentReview.visibility || !incidentReview.confirms || incidentReview.documentWidth > incidentReview.viewportWidth) {
    throw new Error(`La revisión de incidencia no está completa: ${JSON.stringify(incidentReview)}`);
  }

  await setViewport(390, 844, true);
  await navigate(`${baseUrl}/ayuda-y-privacidad`);
  await waitFor("Boolean(document.querySelector('.resident-privacy-heading'))");
  await screenshot("privacy-mobile.png");
  const privacyMobile = await evaluate(`(() => ({
    documentWidth: document.documentElement.scrollWidth,
    viewportWidth: document.documentElement.clientWidth,
    bottomNavFont: Number.parseFloat(getComputedStyle(document.querySelector('.mobile-bottom-nav span')).fontSize),
    headingFont: Number.parseFloat(getComputedStyle(document.querySelector('.resident-privacy-heading h1')).fontSize),
    privacyVisible: getComputedStyle(document.querySelector('.resident-privacy-panel')).display !== 'none'
  }))()`);
  if (privacyMobile.documentWidth > privacyMobile.viewportWidth || privacyMobile.bottomNavFont < 11 || privacyMobile.headingFont < 28 || !privacyMobile.privacyVisible) {
    throw new Error(`La pantalla de privacidad móvil no es legible: ${JSON.stringify(privacyMobile)}`);
  }

  console.log(JSON.stringify({ screenshots: outputDirectory, privacyDesktop, incidentReview, privacyMobile }, null, 2));
} catch (error) {
  throw new Error(`${error instanceof Error ? error.message : String(error)}\nServidor:\n${serverLog}`);
} finally {
  if (socket?.readyState === WebSocket.OPEN) await command("Browser.close").catch(() => undefined);
  socket?.close();
  chrome.kill();
  server.kill();
  await delay(300);
}
