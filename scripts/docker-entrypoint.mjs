import { spawn } from "node:child_process";

function run(command, args, label) {
  return new Promise((resolve, reject) => {
    console.log(`[startup] ${label}`);
    const child = spawn(command, args, { stdio: "inherit", env: process.env });
    child.once("error", reject);
    child.once("exit", (code, signal) => {
      if (code === 0) resolve();
      else reject(new Error(`${label} terminó con ${signal ? `señal ${signal}` : `código ${code}`}`));
    });
  });
}

const migrationsEnabled = !["0", "false", "no"].includes((process.env.RUN_MIGRATIONS || "true").toLowerCase());

try {
  if (migrationsEnabled) await run(process.execPath, ["scripts/migrate.mjs"], "Aplicando migraciones de PostgreSQL");
  else console.log("[startup] Migraciones desactivadas con RUN_MIGRATIONS=false");
} catch (error) {
  console.error("[startup] No se puede iniciar la aplicación:", error);
  process.exit(1);
}

const serverEnvironment = {
  ...process.env,
  HOSTNAME: process.env.HOSTNAME || "0.0.0.0",
  PORT: process.env.PORT || "3000"
};
const server = spawn(process.execPath, ["server.js"], { stdio: "inherit", env: serverEnvironment });
let stopping = false;

for (const signal of ["SIGTERM", "SIGINT"]) {
  process.once(signal, () => {
    if (stopping) return;
    stopping = true;
    console.log(`[startup] Recibida ${signal}; cerrando el servidor`);
    server.kill(signal);
    setTimeout(() => process.exit(1), 10_000).unref();
  });
}

server.once("error", (error) => {
  console.error("[startup] No se ha podido iniciar Next.js:", error);
  process.exit(1);
});
server.once("exit", (code, signal) => {
  if (signal && !stopping) console.error(`[startup] Next.js terminó por la señal ${signal}`);
  process.exit(code ?? (stopping ? 0 : 1));
});
