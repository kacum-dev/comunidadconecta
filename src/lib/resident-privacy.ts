import "server-only";

import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { getPool, withTenant } from "./db";
import { isResidentRole } from "./permissions";
import { rightsDeadline } from "./privacy-domain";

const requestKinds = ["access", "rectification", "erasure", "opposition", "restriction", "portability"] as const;

export type ResidentPrivacyRequestKind = typeof requestKinds[number];

export interface ResidentPrivacyData {
  community: { name: string; contactEmail: string | null; phone: string | null };
  identity: { fullName: string; email: string; role: string; homeCode: string | null };
  activities: Array<{
    id: string;
    name: string;
    purpose: string;
    legalBasis: string;
    dataCategories: string;
    recipients: string;
    retentionPeriod: string;
  }>;
  requests: Array<{
    id: string;
    kind: string;
    status: string;
    identityStatus: string;
    receivedAt: string;
    legalDueAt: string;
  }>;
}

function requireResident(context: AuthContext) {
  if (!isResidentRole(context.current.role)) {
    throw new ApiError(403, "Este espacio está reservado a propietarios y residentes.", "forbidden");
  }
}

export async function getResidentPrivacy(context: AuthContext): Promise<ResidentPrivacyData> {
  requireResident(context);
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const [community, activities, requests] = await Promise.all([
      client.query<{ name: string; contact_email: string | null; phone: string | null }>(
        "SELECT name,contact_email::text,phone FROM communities WHERE id=$1",
        [context.current.communityId]
      ),
      client.query<{
        id: string;
        name: string;
        purpose: string;
        legal_basis: string;
        data_categories: string;
        recipients: string;
        retention_period: string;
      }>(
        `SELECT id::text,name,purpose,legal_basis,data_categories,recipients,retention_period
           FROM processing_activities
          WHERE community_id=$1 AND status='active'
          ORDER BY name`,
        [context.current.communityId]
      ),
      client.query<{
        id: string;
        kind: string;
        status: string;
        identity_status: string;
        received_at: Date;
        legal_due_at: Date;
      }>(
        `SELECT p.id::text,p.kind,p.status,d.identity_status,d.received_at,d.legal_due_at
           FROM privacy_cases p
           JOIN privacy_request_details d ON d.privacy_case_id=p.id AND d.community_id=p.community_id
          WHERE p.community_id=$1 AND p.archived_at IS NULL
            AND (p.created_by=$2 OR d.requester_email=$3)
          ORDER BY d.received_at DESC`,
        [context.current.communityId, context.user.id, context.user.email]
      )
    ]);

    const communityRow = community.rows[0];
    return {
      community: {
        name: communityRow?.name ?? context.current.communityName,
        contactEmail: communityRow?.contact_email ?? null,
        phone: communityRow?.phone ?? null
      },
      identity: {
        fullName: context.user.fullName,
        email: context.user.email,
        role: context.current.role,
        homeCode: context.primaryHome?.code ?? null
      },
      activities: activities.rows.map((row) => ({
        id: row.id,
        name: row.name,
        purpose: row.purpose,
        legalBasis: row.legal_basis,
        dataCategories: row.data_categories,
        recipients: row.recipients,
        retentionPeriod: row.retention_period
      })),
      requests: requests.rows.map((row) => ({
        id: row.id,
        kind: row.kind,
        status: row.status,
        identityStatus: row.identity_status,
        receivedAt: row.received_at.toISOString(),
        legalDueAt: row.legal_due_at.toISOString()
      }))
    };
  });
}

export async function createResidentPrivacyRequest(
  context: AuthContext,
  input: Record<string, unknown>,
  userAgent?: string | null
) {
  requireResident(context);
  if (context.isDemo) throw new ApiError(403, "La demo no admite solicitudes con datos reales.", "demo_read_only");

  const kind = String(input.kind ?? "") as ResidentPrivacyRequestKind;
  const description = String(input.description ?? "").trim();
  if (!requestKinds.includes(kind) || description.length < 10 || description.length > 2_000) {
    throw new ApiError(400, "Elige el derecho e indica en al menos 10 caracteres qué necesitas.", "validation_error");
  }

  const receivedAt = new Date();
  const dueAt = rightsDeadline(receivedAt);
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const duplicate = await client.query(
      `SELECT 1
         FROM privacy_cases p
         JOIN privacy_request_details d ON d.privacy_case_id=p.id AND d.community_id=p.community_id
        WHERE p.community_id=$1 AND d.requester_email=$2 AND p.kind=$3
          AND p.status NOT IN ('completed','closed','rejected') AND p.archived_at IS NULL
        LIMIT 1`,
      [context.current.communityId, context.user.email, kind]
    );
    if (duplicate.rowCount) {
      throw new ApiError(409, "Ya tienes una solicitud de este tipo en curso.", "duplicate_active_request");
    }

    const title = `Solicitud de ${kind} · ${context.user.fullName}`.slice(0, 200);
    const request = await client.query<{ id: string }>(
      `INSERT INTO privacy_cases
        (community_id,title,status,kind,event_at,due_at,event_time_precision,due_time_precision,due_inclusive,contact,description,created_by,updated_by)
       VALUES($1,$2,'identity_check',$3,$4,$5,'second','second',true,$6,$7,$8,$8)
       RETURNING id::text`,
      [context.current.communityId, title, kind, receivedAt.toISOString(), dueAt.toISOString(), context.user.email, description, context.user.id]
    );
    await client.query(
      `INSERT INTO privacy_request_details
        (privacy_case_id,community_id,requester_email,received_at,legal_due_at)
       VALUES($1,$2,$3,$4,$5)`,
      [request.rows[0].id, context.current.communityId, context.user.email, receivedAt.toISOString(), dueAt.toISOString()]
    );
    await writeAudit(client, {
      communityId: context.current.communityId,
      userId: context.user.id,
      action: "privacidad.self_service_request_created",
      resourceType: "privacy_case",
      resourceId: request.rows[0].id,
      after: { kind, receivedAt: receivedAt.toISOString(), legalDueAt: dueAt.toISOString() },
      userAgent
    });
    return { id: request.rows[0].id, kind, status: "identity_check", receivedAt: receivedAt.toISOString(), legalDueAt: dueAt.toISOString() };
  });
}

export async function updateSimpleMode(context: AuthContext, enabled: boolean, userAgent?: string | null) {
  if (context.isDemo) throw new ApiError(403, "Esta preferencia no se guarda en la demo.", "demo_read_only");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const before = await client.query<{ simple_mode: boolean }>("SELECT simple_mode FROM app_users WHERE id=$1 FOR UPDATE", [context.user.id]);
    if (!before.rowCount) throw new ApiError(404, "El usuario no existe.", "not_found");
    await client.query("UPDATE app_users SET simple_mode=$2,updated_at=now() WHERE id=$1", [context.user.id, enabled]);
    await client.query("SET LOCAL ROLE comunidad_conecta_app");
    await client.query("SELECT set_config('app.community_id',$1,true)", [context.current.communityId]);
    await client.query("SELECT set_config('app.user_id',$1,true)", [context.user.id]);
    await writeAudit(client, {
      communityId: context.current.communityId,
      userId: context.user.id,
      action: "perfil.reading_mode_changed",
      resourceType: "app_user",
      resourceId: context.user.id,
      before: { simpleMode: before.rows[0].simple_mode },
      after: { simpleMode: enabled },
      userAgent
    });
    await client.query("COMMIT");
    return { simpleMode: enabled };
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
}
