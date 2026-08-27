import pg from "pg";

const client = new pg.Client({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: false } : false
});

try {
  await client.connect();
  const identity = await client.query(
    "select current_database() as database, current_user as user, version() as version"
  );
  const tables = await client.query(
    `select table_schema, table_name
       from information_schema.tables
      where table_schema not in ('pg_catalog', 'information_schema')
      order by table_schema, table_name`
  );
  console.log(JSON.stringify({ identity: identity.rows[0], tables: tables.rows }, null, 2));
} finally {
  await client.end();
}
