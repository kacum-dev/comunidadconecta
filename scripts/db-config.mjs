import pg from "pg";

export function createPool() {
  if (!process.env.DATABASE_URL) {
    throw new Error("DATABASE_URL no está configurada");
  }

  return new pg.Pool({
    connectionString: process.env.DATABASE_URL,
    ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false,
    max: 5,
    connectionTimeoutMillis: 10_000,
    idleTimeoutMillis: 30_000
  });
}

