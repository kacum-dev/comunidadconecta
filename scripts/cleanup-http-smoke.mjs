import { createPool } from "./db-config.mjs";

const pool = createPool();
const client = await pool.connect();

try {
  await client.query("BEGIN");
  const rows = await client.query(
    `SELECT id::text, code, title, archived_at
       FROM tickets
      WHERE code LIKE 'SMOKE-%'
      FOR UPDATE`
  );

  for (const row of rows.rows) {
    if (row.title !== "Comprobación automática de funcionamiento" || !row.archived_at) {
      throw new Error(`Se rechazó limpiar el registro inesperado ${row.id}`);
    }
  }

  if (rows.rowCount) {
    await client.query("DELETE FROM tickets WHERE id = ANY($1::uuid[])", [rows.rows.map((row) => row.id)]);
  }
  await client.query("COMMIT");
  console.log(`✓ ${rows.rowCount ?? 0} registros temporales eliminados; la auditoría inmutable se conserva.`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
