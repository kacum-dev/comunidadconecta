import { readdir, readFile } from "node:fs/promises";
import { resolve } from "node:path";
import { createPool } from "./db-config.mjs";

const pool = createPool();
const client = await pool.connect();

try {
  await client.query("SELECT pg_advisory_lock(hashtext('comunidad_conecta_migrations'))");
  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name text PRIMARY KEY,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const migrationDirectory = resolve("database", "migrations");
  const files = (await readdir(migrationDirectory)).filter((name) => name.endsWith(".sql")).sort();

  for (const file of files) {
    const exists = await client.query("SELECT 1 FROM schema_migrations WHERE name = $1", [file]);
    if (exists.rowCount) {
      console.log(`✓ ${file} ya aplicada`);
      continue;
    }

    const sql = await readFile(resolve(migrationDirectory, file), "utf8");
    await client.query("BEGIN");
    try {
      await client.query(sql);
      await client.query("INSERT INTO schema_migrations (name) VALUES ($1)", [file]);
      await client.query("COMMIT");
      console.log(`✓ ${file} aplicada`);
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    }
  }
} finally {
  await client.query("SELECT pg_advisory_unlock(hashtext('comunidad_conecta_migrations'))").catch(() => undefined);
  client.release();
  await pool.end();
}

