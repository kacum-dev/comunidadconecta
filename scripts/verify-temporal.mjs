import { createPool } from "./db-config.mjs";

const pool = createPool();
const client = await pool.connect();

try {
  const counts = await client.query(`
    SELECT
      (SELECT count(*)::int FROM communications WHERE event_at IS NOT NULL AND event_time_precision='day') AS legacy_notices,
      (SELECT count(*)::int FROM financial_records WHERE due_at IS NOT NULL AND due_time_precision='day') AS legacy_deadlines,
      (SELECT count(*)::int FROM financial_records WHERE status='paid' AND paid_at IS NULL) AS legacy_paid_without_invented_time
  `);
  const legacySamples = await client.query(`
    SELECT
      (SELECT json_build_object('date',communication.event_date::text,'local',to_char(communication.event_at AT TIME ZONE community.timezone,'YYYY-MM-DD HH24:MI:SS'))
         FROM communications communication JOIN communities community ON community.id=communication.community_id
        WHERE communication.event_time_precision='day' LIMIT 1) AS communication,
      (SELECT json_build_object('date',record.due_date::text,'local',to_char(record.due_at AT TIME ZONE community.timezone,'YYYY-MM-DD HH24:MI:SS'))
         FROM financial_records record JOIN communities community ON community.id=record.community_id
        WHERE record.due_time_precision='day' LIMIT 1) AS financial_deadline
  `);
  await client.query("BEGIN");
  const probe = await client.query(`
    INSERT INTO communications
      (community_id,title,status,kind,event_at,event_time_precision,due_at,due_time_precision,due_inclusive)
    SELECT id,'Temporal trigger probe','draft','notice',
           '2026-08-21T08:15:16Z'::timestamptz,'second',
           '2026-08-21T21:59:59Z'::timestamptz,'second',true
      FROM communities ORDER BY created_at LIMIT 1
    RETURNING event_date::text,due_date::text,event_at::text,due_at::text,
              event_time_precision,due_time_precision,due_inclusive
  `);
  await client.query("ROLLBACK");
  const samples = legacySamples.rows[0];
  if (samples.communication && !String(samples.communication.local).endsWith("00:00:00")) throw new Error("Legacy communication did not preserve date-only semantics.");
  if (samples.financial_deadline && !String(samples.financial_deadline.local).endsWith("23:59:59")) throw new Error("Legacy deadline is not inclusive through the end of day.");
  if (probe.rows[0]?.event_time_precision !== "second" || probe.rows[0]?.due_inclusive !== true) throw new Error("Exact trigger probe failed.");
  console.log(JSON.stringify({ counts: counts.rows[0], legacySamples: samples, triggerProbe: probe.rows[0] }, null, 2));
} finally {
  client.release();
  await pool.end();
}
