import { createPool } from "./db-config.mjs";
import { createPasswordHash } from "./password.mjs";

function enabled(value) {
  return ["1", "true", "yes", "on"].includes(String(value || "").trim().toLowerCase());
}

function slugify(value) {
  return value
    .trim()
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 70) || "comunidad";
}

async function uniqueCommunitySlug(client, requested) {
  const base = slugify(requested);
  let candidate = base;
  let suffix = 2;
  while (true) {
    const exists = await client.query("SELECT 1 FROM communities WHERE slug = $1 LIMIT 1", [candidate]);
    if (!exists.rowCount) return candidate;
    candidate = `${base.slice(0, 64)}-${suffix}`;
    suffix += 1;
  }
}

if (!enabled(process.env.INITIAL_ADMIN_BOOTSTRAP_ENABLED)) {
  console.log("[bootstrap] Bootstrap inicial desactivado");
  process.exit(0);
}

const email = String(process.env.SEED_ADMIN_EMAIL || "").trim().toLowerCase();
const password = String(process.env.SEED_ADMIN_PASSWORD || "");
const adminName = String(process.env.INITIAL_ADMIN_NAME || "Administrador").trim() || "Administrador";
const communityName = String(process.env.INITIAL_COMMUNITY_NAME || "").trim();
const communityAddress = String(process.env.INITIAL_COMMUNITY_ADDRESS || "Pendiente de completar").trim() || "Pendiente de completar";

if (!email || !email.includes("@")) {
  throw new Error("SEED_ADMIN_EMAIL es obligatorio para el bootstrap inicial");
}
if (password.length < 12) {
  throw new Error("SEED_ADMIN_PASSWORD debe contener al menos 12 caracteres");
}
if (!communityName) {
  throw new Error("INITIAL_COMMUNITY_NAME es obligatorio para el bootstrap inicial");
}

const pool = createPool();
const client = await pool.connect();

try {
  await client.query("BEGIN");

  let userResult = await client.query(
    "SELECT id, email FROM app_users WHERE email = $1 LIMIT 1",
    [email],
  );
  let userId;
  let userCreated = false;
  if (userResult.rowCount) {
    userId = userResult.rows[0].id;
  } else {
    const passwordData = await createPasswordHash(password);
    userResult = await client.query(
      `INSERT INTO app_users (email, full_name, password_hash, password_salt, password_params, status, is_demo)
       VALUES ($1, $2, $3, $4, $5::jsonb, 'active', false)
       RETURNING id`,
      [email, adminName, passwordData.hash, passwordData.salt, JSON.stringify(passwordData.params)],
    );
    userId = userResult.rows[0].id;
    userCreated = true;
  }

  // Si el administrador ya pertenece a una comunidad, esa relación es la
  // identidad estable del bootstrap. Así un cambio posterior de nombre no crea
  // una segunda comunidad al reiniciar el contenedor.
  let communityResult = await client.query(
    `SELECT c.id, c.name
       FROM memberships m
       JOIN communities c ON c.id = m.community_id
      WHERE m.user_id = $1
        AND m.role IN ('administrator', 'platform_admin')
        AND m.status = 'active'
      ORDER BY m.created_at ASC
      LIMIT 1`,
    [userId],
  );

  let communityId;
  let communityCreated = false;
  if (communityResult.rowCount) {
    communityId = communityResult.rows[0].id;
  } else {
    // Recupera de forma segura una creación parcial en una base recién
    // provisionada antes de crear una comunidad nueva.
    communityResult = await client.query(
      "SELECT id, name FROM communities ORDER BY created_at ASC LIMIT 2",
    );
    if (communityResult.rowCount === 1) {
      communityId = communityResult.rows[0].id;
    } else if (communityResult.rowCount > 1) {
      throw new Error("No se puede inferir de forma segura qué comunidad debe recibir el administrador inicial");
    } else {
      const communitySlug = await uniqueCommunitySlug(client, communityName);
      communityResult = await client.query(
        `INSERT INTO communities (name, slug, address, status)
         VALUES ($1, $2, $3, 'active')
         RETURNING id`,
        [communityName, communitySlug, communityAddress],
      );
      communityId = communityResult.rows[0].id;
      communityCreated = true;
    }
  }

  for (const role of ["administrator", "platform_admin"]) {
    await client.query(
      `INSERT INTO memberships (community_id, user_id, role, status)
       VALUES ($1, $2, $3, 'active')
       ON CONFLICT (community_id, user_id, role)
       DO UPDATE SET status = 'active', valid_to = NULL, updated_at = now()`,
      [communityId, userId, role],
    );
  }

  await client.query("COMMIT");
  console.log(
    `[bootstrap] Administrador inicial preparado (${userCreated ? "usuario creado" : "usuario existente"}; ${communityCreated ? "comunidad creada" : "comunidad existente"})`,
  );
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
