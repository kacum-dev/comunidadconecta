import "server-only";

import { Pool, type PoolClient, type QueryResult, type QueryResultRow } from "pg";

declare global {
  var comunidadConectaPool: Pool | undefined;
}

function createPool() {
  if (!process.env.DATABASE_URL) throw new Error("DATABASE_URL no está configurada");

  return new Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    max: 10,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 10_000,
    statement_timeout: 15_000,
    application_name: "comunidad-conecta-web"
  });
}

export function getPool() {
  if (!global.comunidadConectaPool) global.comunidadConectaPool = createPool();
  return global.comunidadConectaPool;
}

export function query<T extends QueryResultRow = QueryResultRow>(text: string, values: unknown[] = []): Promise<QueryResult<T>> {
  return getPool().query<T>(text, values);
}

export async function withTenant<T>(
  communityId: string,
  userId: string,
  callback: (client: PoolClient) => Promise<T>
): Promise<T> {
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    await client.query("SET LOCAL ROLE comunidad_conecta_app");
    await client.query("SELECT set_config('app.community_id', $1, true)", [communityId]);
    await client.query("SELECT set_config('app.user_id', $1, true)", [userId]);
    const result = await callback(client);
    await client.query("COMMIT");
    return result;
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
