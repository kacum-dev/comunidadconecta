import type { PoolClient } from "pg";
import { safeUserAgent } from "./auth";

interface AuditInput {
  communityId: string;
  userId: string;
  action: string;
  resourceType: string;
  resourceId?: string | null;
  before?: unknown;
  after?: unknown;
  reason?: string | null;
  userAgent?: string | null;
  result?: "success" | "denied" | "error";
}

export async function writeAudit(client: PoolClient, input: AuditInput) {
  await client.query(
    `INSERT INTO audit_events
      (community_id, actor_user_id, action, resource_type, resource_id, result, reason, before_state, after_state, user_agent)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8::jsonb, $9::jsonb, $10)`,
    [
      input.communityId,
      input.userId,
      input.action,
      input.resourceType,
      input.resourceId ?? null,
      input.result ?? "success",
      input.reason ?? null,
      input.before === undefined ? null : JSON.stringify(input.before),
      input.after === undefined ? null : JSON.stringify(input.after),
      safeUserAgent(input.userAgent ?? null)
    ]
  );
}
