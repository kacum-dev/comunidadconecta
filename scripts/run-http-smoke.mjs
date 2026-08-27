import { spawn } from "node:child_process";

const baseUrl = "http://127.0.0.1:3100";
const server = spawn(process.execPath, [".next/standalone/server.js"], {
  cwd: process.cwd(),
  env: { ...process.env, PORT: "3100", HOSTNAME: "127.0.0.1" },
  stdio: ["ignore", "pipe", "pipe"],
  windowsHide: true
});

let serverLog = "";
server.stdout.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-6000); });
server.stderr.on("data", (chunk) => { serverLog = `${serverLog}${chunk}`.slice(-6000); });

function delay(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForServer() {
  for (let attempt = 0; attempt < 80; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/api/health`);
      if (response.ok) return;
    } catch {}
    await delay(250);
  }
  throw new Error(`El servidor de producción no respondió.\n${serverLog}`);
}

function runSmoke() {
  return new Promise((resolve, reject) => {
    const smoke = spawn(process.execPath, ["--env-file=.env.local", "scripts/http-smoke.mjs"], {
      cwd: process.cwd(),
      env: { ...process.env, SMOKE_BASE_URL: baseUrl },
      stdio: "inherit",
      windowsHide: true
    });
    smoke.once("error", reject);
    smoke.once("exit", (code) => code === 0 ? resolve() : reject(new Error(`El smoke HTTP terminó con código ${code}`)));
  });
}

try {
  await waitForServer();
  await runSmoke();
} finally {
  server.kill();
  await Promise.race([
    new Promise((resolve) => server.once("exit", resolve)),
    delay(2_000)
  ]);
}
