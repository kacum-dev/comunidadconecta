import { createPool } from "./db-config.mjs";

const pool = createPool();
const client = await pool.connect();

try {
  const migration = await client.query("SELECT name, applied_at FROM schema_migrations ORDER BY name");
  const community = await client.query("SELECT id, name FROM communities ORDER BY created_at LIMIT 1");
  if (!community.rowCount) throw new Error("No existe una comunidad inicial");

  const communityId = community.rows[0].id;
  await client.query("BEGIN");
  await client.query("SET LOCAL ROLE comunidad_conecta_app");
  const denied = await client.query("SELECT count(*)::int AS count FROM tickets");
  const deniedSettings = await client.query("SELECT count(*)::int AS count FROM community_app_settings");
  const deniedNewModules = await client.query(`
    SELECT
      (SELECT count(*) FROM bank_transactions) AS bank_transactions,
      (SELECT count(*) FROM meeting_agenda_items) AS meeting_agenda_items,
      (SELECT count(*) FROM ticket_work_orders) AS ticket_work_orders,
      (SELECT count(*) FROM transition_items) AS transition_items,
      (SELECT count(*) FROM reservation_resources) AS reservation_resources,
      (SELECT count(*) FROM finance_budgets) AS finance_budgets,
      (SELECT count(*) FROM privacy_request_details) AS privacy_request_details
  `);
  await client.query("SELECT set_config('app.community_id', $1, true)", [communityId]);
  const visible = await client.query("SELECT count(*)::int AS count FROM tickets");
  const visibleSettings = await client.query("SELECT count(*)::int AS count FROM community_app_settings");
  const modules = await client.query(`
    SELECT
      (SELECT count(*) FROM structure_nodes) AS structure_nodes,
      (SELECT count(*) FROM financial_records) AS financial_records,
      (SELECT count(*) FROM meetings) AS meetings,
      (SELECT count(*) FROM communications) AS communications,
      (SELECT count(*) FROM tickets) AS tickets,
      (SELECT count(*) FROM documents) AS documents,
      (SELECT count(*) FROM community_app_settings) AS community_app_settings,
      (SELECT count(*) FROM community_integrations WHERE archived_at IS NULL) AS community_integrations,
      (SELECT count(*) FROM audit_events) AS audit_events
      ,(SELECT count(*) FROM bank_transactions) AS bank_transactions
      ,(SELECT count(*) FROM meeting_agenda_items) AS meeting_agenda_items
      ,(SELECT count(*) FROM ticket_work_orders) AS ticket_work_orders
      ,(SELECT count(*) FROM transition_items) AS transition_items
      ,(SELECT count(*) FROM reservation_resources) AS reservation_resources
      ,(SELECT count(*) FROM finance_budgets) AS finance_budgets
      ,(SELECT count(*) FROM privacy_request_details) AS privacy_request_details
  `);
  await client.query("ROLLBACK");

  if (denied.rows[0].count !== 0) throw new Error("RLS no aplica denegación por defecto");
  if (deniedSettings.rows[0].count !== 0) throw new Error("RLS no protege la configuración por defecto");
  if (Object.values(deniedNewModules.rows[0]).some((count) => Number(count) !== 0)) throw new Error("RLS no protege uno de los módulos nuevos por defecto");
  if (visible.rows[0].count < 1) throw new Error("RLS no permite el tenant seleccionado");
  if (visibleSettings.rows[0].count !== 1) throw new Error("RLS no permite la configuración del tenant seleccionado");

  console.log(JSON.stringify({
    database: "ok",
    migrations: migration.rows.map((row) => row.name),
    community: community.rows[0].name,
    rlsDefaultDeny: true,
    counts: modules.rows[0]
  }, null, 2));
} finally {
  client.release();
  await pool.end();
}
