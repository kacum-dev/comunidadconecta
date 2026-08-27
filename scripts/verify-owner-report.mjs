import { spawn } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { resolve } from "node:path";

const baseUrl = "http://127.0.0.1:3120";
const output = resolve("tmp", "pdfs", "owner-report.pdf");
const email = "ana.torres@demo.comunidadconecta.local";
const password = process.env.SEED_DEMO_PASSWORD || process.env.SEED_ADMIN_PASSWORD;
if (!password) throw new Error("Falta la credencial sintética de la propietaria.");

const server = spawn(process.execPath, ["node_modules/next/dist/bin/next", "start", "-p", "3120"], {
  cwd: process.cwd(), env: process.env, stdio: ["ignore", "pipe", "pipe"], windowsHide: true
});
let log = "";
server.stdout.on("data", (chunk) => { log = `${log}${chunk}`.slice(-5000); });
server.stderr.on("data", (chunk) => { log = `${log}${chunk}`.slice(-5000); });
const delay = (milliseconds) => new Promise((resolvePromise) => setTimeout(resolvePromise, milliseconds));
const cookies = (response) => (typeof response.headers.getSetCookie === "function" ? response.headers.getSetCookie() : [response.headers.get("set-cookie") || ""])
  .map((value) => value.split(";", 1)[0]).filter(Boolean).join("; ");

try {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try { if ((await fetch(`${baseUrl}/login`)).ok) break; } catch {}
    if (attempt === 79) throw new Error(`El servidor no respondió.\n${log}`);
    await delay(250);
  }
  const login = await fetch(`${baseUrl}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json", Origin: baseUrl }, body: JSON.stringify({ email, password })
  });
  if (!login.ok) throw new Error(`El login de la propietaria devolvió ${login.status}.`);
  const cookie = cookies(login);
  const homesResponse = await fetch(`${baseUrl}/api/homes`, { headers: { Cookie: cookie } });
  const homes = await homesResponse.json();
  const unitId = homes.homes?.[0]?.id;
  if (!homesResponse.ok || !unitId) throw new Error("La propietaria no tiene una vivienda disponible para el informe.");
  const report = await fetch(`${baseUrl}/api/homes/report?unitId=${encodeURIComponent(unitId)}`, { headers: { Cookie: cookie } });
  const bytes = new Uint8Array(await report.arrayBuffer());
  if (!report.ok || report.headers.get("content-type") !== "application/pdf" || new TextDecoder().decode(bytes.slice(0, 5)) !== "%PDF-") {
    throw new Error(`El informe devolvió ${report.status} y ${report.headers.get("content-type")}.`);
  }
  await mkdir(resolve("tmp", "pdfs"), { recursive: true });
  await writeFile(output, bytes);
  console.log(JSON.stringify({ output, bytes: bytes.length, unitId }, null, 2));
} finally {
  server.kill();
  await Promise.race([new Promise((resolvePromise) => server.once("exit", resolvePromise)), delay(2000)]);
}
