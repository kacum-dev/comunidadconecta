import { execFileSync, spawnSync } from "node:child_process";

const OFFICIAL_REMOTE = "upstream";
const OFFICIAL_URL = "https://github.com/kacum-dev/comunidadconecta.git";
const OFFICIAL_BRANCH = "main";
const prepare = process.argv.includes("--prepare");

function run(args, options = {}) {
  return execFileSync("git", args, {
    cwd: process.cwd(),
    encoding: "utf8",
    stdio: options.inherit ? "inherit" : ["ignore", "pipe", "pipe"],
  }).trim();
}

function fail(message) {
  console.error(`\n${message}\n`);
  process.exit(1);
}

try {
  run(["rev-parse", "--show-toplevel"]);
} catch {
  fail("Ejecuta este comando desde una copia Git de Comunidad Conecta.");
}

const dirty = run(["status", "--porcelain"]);
if (dirty) {
  fail("Hay cambios sin guardar. Haz commit o stash antes de actualizar para no mezclar trabajo local con el upstream.");
}

let upstreamUrl = "";
try {
  upstreamUrl = run(["remote", "get-url", OFFICIAL_REMOTE]);
} catch {
  // El remoto todavía no existe.
}

if (!upstreamUrl) {
  run(["remote", "add", OFFICIAL_REMOTE, OFFICIAL_URL]);
  console.log(`Añadido ${OFFICIAL_REMOTE} -> ${OFFICIAL_URL}`);
} else if (upstreamUrl !== OFFICIAL_URL) {
  run(["remote", "set-url", OFFICIAL_REMOTE, OFFICIAL_URL]);
  console.log(`Actualizado ${OFFICIAL_REMOTE} -> ${OFFICIAL_URL}`);
}

console.log("Buscando actualizaciones oficiales…");
run(["fetch", OFFICIAL_REMOTE, OFFICIAL_BRANCH, "--tags"], { inherit: true });

const currentBranch = run(["branch", "--show-current"]);
if (!currentBranch) {
  fail("El repositorio está en detached HEAD. Cambia a una rama antes de actualizar.");
}

const counts = run(["rev-list", "--left-right", "--count", `HEAD...${OFFICIAL_REMOTE}/${OFFICIAL_BRANCH}`])
  .split(/\s+/)
  .map((value) => Number(value));
const [ahead, behind] = counts;

if (!behind) {
  console.log("Comunidad Conecta ya está al día con el repositorio oficial.");
  process.exit(0);
}

if (!ahead) {
  console.log(`Hay ${behind} cambio(s) oficial(es) pendiente(s). Aplicando actualización segura…`);
  run(["merge", "--ff-only", `${OFFICIAL_REMOTE}/${OFFICIAL_BRANCH}`], { inherit: true });
  console.log("\nActualización aplicada. Revisa las notas de versión y ejecuta las pruebas antes de desplegar.");
  process.exit(0);
}

console.log(`Tu rama tiene ${ahead} cambio(s) propio(s) y el oficial tiene ${behind} cambio(s) nuevo(s).`);
if (!prepare) {
  console.log("No se ha modificado ningún archivo porque esta copia está personalizada.");
  console.log("Para preparar una integración revisable ejecuta:");
  console.log("  npm run update:official -- --prepare");
  process.exit(2);
}

const stamp = new Date().toISOString().replace(/[-:]/g, "").replace(/\..+/, "").replace("T", "-");
const updateBranch = `update/comunidad-conecta-${stamp}`;
run(["switch", "-c", updateBranch], { inherit: true });
console.log(`\nCreada rama ${updateBranch}. Preparando merge para revisión…`);

const merge = spawnSync(
  "git",
  ["merge", "--no-ff", "--no-commit", `${OFFICIAL_REMOTE}/${OFFICIAL_BRANCH}`],
  { cwd: process.cwd(), stdio: "inherit" },
);

if (merge.status === 0) {
  console.log("\nLa actualización se ha preparado sin conflictos y todavía NO se ha confirmado.");
  console.log("Revisa los cambios, ejecuta typecheck/test/lint/build y después haz commit/PR.");
  process.exit(0);
}

console.log("\nGit ha detectado conflictos. La rama de actualización queda preparada para resolverlos de forma explícita.");
console.log("No se ha sobrescrito el historial ni se ha hecho push automático.");
process.exit(2);
