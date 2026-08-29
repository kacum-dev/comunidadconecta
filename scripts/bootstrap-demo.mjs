import { createPool } from "./db-config.mjs";

const mode = String(process.env.KACUM_INSTANCE_MODE || "customer").trim().toLowerCase();
if (mode !== "demo") {
  throw new Error("bootstrap-demo.mjs solo puede ejecutarse con KACUM_INSTANCE_MODE=demo");
}

const DEMO_SLUG = "mirador-del-segura";
const EXPECTED_ROLES = [
  "president",
  "vice_president",
  "secretary",
  "treasurer",
  "administrator",
  "owner",
  "resident"
];

async function demoState() {
  const pool = createPool();
  try {
    const result = await pool.query(
      `SELECT c.id::text AS community_id,
              COALESCE(s.enabled, false) AS enabled,
              count(DISTINCT m.role) FILTER (
                WHERE u.is_demo = true
                  AND u.status = 'active'
                  AND m.status = 'active'
                  AND m.role = ANY($2::text[])
              )::int AS role_count
         FROM communities c
         LEFT JOIN community_demo_settings s ON s.community_id = c.id
         LEFT JOIN memberships m ON m.community_id = c.id
         LEFT JOIN app_users u ON u.id = m.user_id
        WHERE c.slug = $1
          AND c.is_demo = true
          AND c.status IN ('onboarding', 'active', 'transition')
        GROUP BY c.id, s.enabled
        LIMIT 1`,
      [DEMO_SLUG, EXPECTED_ROLES]
    );
    return result.rows[0] ?? null;
  } finally {
    await pool.end();
  }
}

let state = await demoState();
if (!state || Number(state.role_count) < EXPECTED_ROLES.length) {
  console.log("[demo] Preparando datos sintéticos de demostración");
  await import("./seed.mjs");
  state = await demoState();
}

if (!state || Number(state.role_count) < EXPECTED_ROLES.length) {
  throw new Error("No se ha podido preparar una comunidad demo completa y aislada");
}

const pool = createPool();
const client = await pool.connect();
try {
  await client.query("BEGIN");
  const target = await client.query(
    `SELECT c.id
       FROM communities c
       JOIN community_demo_settings s ON s.community_id = c.id
      WHERE c.slug = $1
        AND c.is_demo = true
        AND c.status IN ('onboarding', 'active', 'transition')
      FOR UPDATE`,
    [DEMO_SLUG]
  );
  if (target.rowCount !== 1) {
    throw new Error("La comunidad sintética canónica no está disponible para publicar la demo");
  }
  const communityId = target.rows[0].id;
  await client.query(
    "UPDATE community_demo_settings SET enabled = false, updated_at = now() WHERE enabled = true AND community_id <> $1",
    [communityId]
  );
  await client.query(
    `UPDATE community_demo_settings
        SET enabled = true,
            enabled_roles = $2::text[],
            expires_at = NULL,
            updated_at = now()
      WHERE community_id = $1`,
    [communityId, EXPECTED_ROLES]
  );
  await client.query("COMMIT");
  console.log("[demo] Entorno de demostración listo y publicado");
} catch (error) {
  await client.query("ROLLBACK").catch(() => undefined);
  throw error;
} finally {
  client.release();
  await pool.end();
}
