import "server-only";

import { createHash } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { withTenant } from "./db";
import { assertTicketTransition, notificationKey } from "./operations-domain";
import { can, isResidentRole } from "./permissions";
import { MAX_DOCUMENT_BYTES, UnsupportedDocumentFileError, validateDocumentFile } from "./file-validation";
import { precisionForLocalDateTime, zonedLocalDateTimeToIso } from "./temporal";

const uuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);

async function notifyTicket(client: PoolClient, context: AuthContext, ticketId: string, event: string, title: string, body: string) {
  const delivery = await client.query<{ notifications_email: boolean; notifications_push: boolean }>(
    `SELECT notifications_email,notifications_push
       FROM community_app_settings
      WHERE community_id=$1`,
    [context.current.communityId]
  );
  const channels = [
    ...(delivery.rows[0]?.notifications_email ? ["email"] : []),
    ...(delivery.rows[0]?.notifications_push ? ["push"] : [])
  ];
  const users = await client.query<{ user_id: string }>(`SELECT DISTINCT user_id::text FROM unit_relations
    WHERE community_id=$1 AND unit_id=(SELECT private_unit_id FROM tickets WHERE id=$2 AND community_id=$1)
      AND user_id IS NOT NULL AND status='active'`, [context.current.communityId, ticketId]);
  for (const row of users.rows) {
    const key = notificationKey("ticket", ticketId, event, row.user_id);
    const notification = await client.query<{ id: string }>(`INSERT INTO user_notifications(community_id,user_id,type,title,body,href,source_type,source_id,idempotency_key)
      VALUES($1,$2,'ticket',$3,$4,$5,'ticket',$6,$7)
      ON CONFLICT(community_id,user_id,idempotency_key) DO NOTHING RETURNING id::text`,
    [context.current.communityId, row.user_id, title, body, "/incidencias", ticketId, key]);
    if (notification.rowCount && channels.length) await client.query(`INSERT INTO notification_outbox(community_id,notification_id,channel)
      SELECT $1,$2,channel FROM unnest($3::text[]) channel ON CONFLICT DO NOTHING`, [context.current.communityId, notification.rows[0].id, channels]);
  }
}

export async function getOperations(context: AuthContext) {
  if (!can(context.current.role, "incidencias", "read")) throw new ApiError(403, "No puedes consultar incidencias.", "forbidden");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const resident = isResidentRole(context.current.role);
    const tickets = await client.query<{ id: string; code: string | null; title: string; description: string; status: string; priority: string; location: string | null; contact: string | null; assigned_to: string | null; event_at: Date | null; due_at: Date | null; event_time_precision: string | null; due_time_precision: string | null; due_inclusive: boolean; version: number }>(`SELECT t.id::text,t.code,t.title,t.description,t.status,t.priority,t.location,t.contact,t.assigned_to,t.event_at,t.due_at,t.event_time_precision,t.due_time_precision,t.due_inclusive,t.version
      FROM tickets t WHERE t.community_id=$1 AND t.archived_at IS NULL
      AND($2::boolean=false OR t.created_by=$3 OR EXISTS(SELECT 1 FROM unit_relations ur WHERE ur.community_id=t.community_id AND ur.user_id=$3 AND ur.unit_id=t.private_unit_id AND ur.status='active'))
      ORDER BY CASE t.priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END,t.created_at DESC LIMIT 100`, [context.current.communityId, resident, context.user.id]);
    const ids = tickets.rows.map((row) => row.id);
    const orders = ids.length ? await client.query(`SELECT w.id::text,w.ticket_id::text,w.asset_id::text,w.supplier_id::text,w.title,w.description,w.status,w.scheduled_at,w.scheduled_time_precision,w.estimated_cost_cents,w.actual_cost_cents,s.title supplier_name,a.title asset_name
      FROM ticket_work_orders w
      LEFT JOIN suppliers s ON s.id=w.supplier_id AND s.community_id=w.community_id
      LEFT JOIN assets a ON a.id=w.asset_id AND a.community_id=w.community_id
      WHERE w.community_id=$1 AND w.ticket_id=ANY($2::uuid[]) ORDER BY w.created_at DESC`, [context.current.communityId, ids]) : { rows: [] };
    const updates = ids.length ? await client.query(`SELECT u.id::text,u.ticket_id::text,u.kind,u.message,u.visible_to_resident,u.created_at,au.full_name author
      FROM ticket_updates u LEFT JOIN app_users au ON au.id=u.created_by
      WHERE u.community_id=$1 AND u.ticket_id=ANY($2::uuid[]) AND($3::boolean=false OR u.visible_to_resident=true)
      ORDER BY u.created_at DESC`, [context.current.communityId, ids, resident]) : { rows: [] };
    const attachments = ids.length ? await client.query(`SELECT a.id::text,a.ticket_id::text,d.id::text document_id,
      v.original_name,v.mime_type,v.size_bytes,a.caption,a.visible_to_resident,a.created_at,au.full_name author
      FROM ticket_attachments a
      JOIN document_versions v ON v.id=a.document_version_id AND v.community_id=a.community_id
      JOIN documents d ON d.id=v.document_id AND d.community_id=v.community_id
      LEFT JOIN app_users au ON au.id=a.created_by
      WHERE a.community_id=$1 AND a.ticket_id=ANY($2::uuid[]) AND($3::boolean=false OR a.visible_to_resident=true)
      ORDER BY a.created_at DESC`, [context.current.communityId, ids, resident]) : { rows: [] };
    return { tickets: tickets.rows, orders: orders.rows, updates: updates.rows, attachments: attachments.rows };
  });
}

export async function createTicketAttachment(
  context: AuthContext,
  ticketId: string,
  input: { fileName: string; bytes: Uint8Array; caption?: string },
  userAgent?: string | null
) {
  if (!can(context.current.role, "incidencias", "write")) throw new ApiError(403, "No puedes añadir evidencias.", "forbidden");
  if (!uuid(ticketId)) throw new ApiError(400, "Incidencia no válida.", "validation_error");
  if (!input.bytes.length) throw new ApiError(400, "El archivo está vacío.", "validation_error");
  if (input.bytes.length > MAX_DOCUMENT_BYTES) throw new ApiError(413, "El archivo supera el límite de 10 MB.", "file_too_large");
  let validated: ReturnType<typeof validateDocumentFile>;
  try { validated = validateDocumentFile(input.fileName, input.bytes); }
  catch (error) {
    if (error instanceof UnsupportedDocumentFileError) throw new ApiError(415, error.message, "unsupported_file");
    throw error;
  }
  const originalName = input.fileName.replace(/[\r\n"\\/]/g, "_").trim().slice(0, 240) || `evidencia.${validated.extension}`;
  const caption = String(input.caption ?? "").trim().slice(0, 300);
  const sha256 = createHash("sha256").update(input.bytes).digest("hex");
  const resident = isResidentRole(context.current.role);

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const ticket = await client.query<{ title: string; private_unit_id: string | null }>(`SELECT t.title,t.private_unit_id::text
      FROM tickets t WHERE t.id=$1 AND t.community_id=$2 AND t.archived_at IS NULL
      AND($3::boolean=false OR t.created_by=$4 OR EXISTS(SELECT 1 FROM unit_relations ur
        WHERE ur.community_id=t.community_id AND ur.user_id=$4 AND ur.unit_id=t.private_unit_id AND ur.status='active'))
      FOR UPDATE`, [ticketId, context.current.communityId, resident, context.user.id]);
    if (!ticket.rowCount) throw new ApiError(404, "La incidencia no existe o no puedes acceder a ella.", "not_found");
    const document = await client.query<{ id: string }>(`INSERT INTO documents
      (community_id,private_unit_id,title,description,status,kind,event_at,event_time_precision,data,created_by,updated_by)
      VALUES($1,$2,$3,$4,'current','other',now(),'second',$5::jsonb,$6,$6) RETURNING id::text`,
    [context.current.communityId, ticket.rows[0].private_unit_id, `Evidencia · ${ticket.rows[0].title}`.slice(0, 200),
      caption || originalName, JSON.stringify({ audience: "private", ticketId, evidence: true }), context.user.id]);
    const version = await client.query<{ id: string }>(`INSERT INTO document_versions
      (community_id,document_id,version_number,original_name,mime_type,size_bytes,sha256,content,created_by)
      VALUES($1,$2,1,$3,$4,$5,$6,$7,$8) RETURNING id::text`, [context.current.communityId, document.rows[0].id,
      originalName, validated.mimeType, input.bytes.length, sha256, Buffer.from(input.bytes), context.user.id]);
    const attachment = await client.query<{ id: string }>(`INSERT INTO ticket_attachments
      (community_id,ticket_id,document_version_id,kind,caption,visible_to_resident,created_by)
      VALUES($1,$2,$3,$4,$5,true,$6) RETURNING id::text`, [context.current.communityId, ticketId, version.rows[0].id,
      validated.mimeType.startsWith("image/") ? "photo" : "evidence", caption || null, context.user.id]);
    await client.query(`INSERT INTO ticket_updates(community_id,ticket_id,kind,message,visible_to_resident,created_by)
      VALUES($1,$2,'evidence',$3,true,$4)`, [context.current.communityId, ticketId, `Evidencia añadida: ${caption || originalName}`, context.user.id]);
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id,
      action: "incidencias.evidence_added", resourceType: "ticket_attachment", resourceId: attachment.rows[0].id,
      after: { ticketId, documentId: document.rows[0].id, originalName, mimeType: validated.mimeType, size: input.bytes.length, sha256 }, userAgent });
    return { id: attachment.rows[0].id, documentId: document.rows[0].id, originalName, mimeType: validated.mimeType, size: input.bytes.length, caption };
  });
}

export async function transitionTicket(context: AuthContext, id: string, input: { status?: string; message?: string }, userAgent?: string | null) {
  if (!can(context.current.role, "incidencias", "write") || isResidentRole(context.current.role)) throw new ApiError(403, "No puedes cambiar el estado.", "forbidden");
  if (!uuid(id)) throw new ApiError(400, "Incidencia no válida.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const before = await client.query<{ status: string; title: string }>("SELECT status,title FROM tickets WHERE id=$1 AND community_id=$2 FOR UPDATE", [id, context.current.communityId]);
    if (!before.rowCount) throw new ApiError(404, "La incidencia no existe.", "not_found");
    try { assertTicketTransition(before.rows[0].status, String(input.status)); }
    catch (cause) { throw new ApiError(409, cause instanceof Error ? cause.message : "Cambio no válido.", "invalid_state"); }
    await client.query("UPDATE tickets SET status=$3,version=version+1,updated_by=$4 WHERE id=$1 AND community_id=$2", [id, context.current.communityId, input.status, context.user.id]);
    await client.query(`INSERT INTO ticket_updates(community_id,ticket_id,kind,message,visible_to_resident,created_by)
      VALUES($1,$2,'status',$3,true,$4)`, [context.current.communityId, id, String(input.message ?? "Estado actualizado a " + input.status).trim().slice(0, 2000), context.user.id]);
    await notifyTicket(client, context, id, "status:" + input.status, "Tu incidencia ha cambiado", before.rows[0].title + ": " + input.status);
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "incidencias.status_changed", resourceType: "ticket", resourceId: id, before: { status: before.rows[0].status }, after: { status: input.status }, userAgent });
    return { status: input.status };
  });
}

export async function createWorkOrder(context: AuthContext, ticketId: string, input: { title?: string; description?: string; assetId?: string; supplierId?: string; scheduledDate?: string; estimatedCost?: number }, userAgent?: string | null) {
  if (!can(context.current.role, "incidencias", "write") || isResidentRole(context.current.role)) throw new ApiError(403, "No puedes crear órdenes.", "forbidden");
  const title = String(input.title ?? "").trim();
  const description = String(input.description ?? "").trim();
  const assetId = String(input.assetId ?? "").trim();
  const supplierId = String(input.supplierId ?? "").trim();
  const scheduledInput = String(input.scheduledDate ?? "").trim();
  const scheduledAt = scheduledInput ? zonedLocalDateTimeToIso(scheduledInput, context.current.timeZone) : null;
  const scheduledPrecision = scheduledInput ? precisionForLocalDateTime(scheduledInput) : null;
  const hasEstimatedCost = input.estimatedCost !== undefined;
  const cents = hasEstimatedCost ? Math.round(Number(input.estimatedCost) * 100) : null;
  if (!uuid(ticketId) || title.length < 3 || description.length < 3 || (assetId && !uuid(assetId)) || (supplierId && !uuid(supplierId)) ||
    (scheduledInput && !scheduledAt) || (scheduledAt && new Date(scheduledAt).getTime() <= Date.now()) || (cents !== null && (!Number.isSafeInteger(cents) || cents < 0))) {
    throw new ApiError(400, "Datos de la orden no válidos.", "validation_error");
  }
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const ticket = await client.query<{ status: string }>("SELECT status FROM tickets WHERE id=$1 AND community_id=$2 AND archived_at IS NULL FOR UPDATE", [ticketId, context.current.communityId]);
    if (!ticket.rowCount) throw new ApiError(404, "La incidencia no existe.", "not_found");
    if (ticket.rows[0].status !== "scheduled") {
      try { assertTicketTransition(ticket.rows[0].status, "scheduled"); }
      catch (cause) { throw new ApiError(409, cause instanceof Error ? cause.message : "La incidencia no se puede programar.", "invalid_state"); }
    }
    const [asset, supplier] = await Promise.all([
      assetId ? client.query("SELECT 1 FROM assets WHERE id=$1 AND community_id=$2 AND archived_at IS NULL", [assetId, context.current.communityId]) : Promise.resolve({ rowCount: 1 }),
      supplierId ? client.query("SELECT 1 FROM suppliers WHERE id=$1 AND community_id=$2 AND archived_at IS NULL", [supplierId, context.current.communityId]) : Promise.resolve({ rowCount: 1 }),
    ]);
    if (!asset.rowCount) throw new ApiError(404, "El activo no pertenece a esta comunidad.", "asset_not_found");
    if (!supplier.rowCount) throw new ApiError(404, "El proveedor no pertenece a esta comunidad.", "supplier_not_found");
    const result = await client.query<{ id: string }>(`INSERT INTO ticket_work_orders(community_id,ticket_id,asset_id,supplier_id,title,description,status,scheduled_at,scheduled_time_precision,estimated_cost_cents,created_by,updated_by)
      VALUES($1,$2,$3,$4,$5,$6,'scheduled',$7,$8,$9,$10,$10) RETURNING id::text`, [context.current.communityId, ticketId, assetId || null, supplierId || null, title, description, scheduledAt, scheduledPrecision, cents, context.user.id]);
    await client.query("UPDATE tickets SET status='scheduled',version=version+1,updated_by=$3 WHERE id=$1 AND community_id=$2", [ticketId, context.current.communityId, context.user.id]);
    await client.query(`INSERT INTO ticket_updates(community_id,ticket_id,work_order_id,kind,message,visible_to_resident,created_by)
      VALUES($1,$2,$3,'visit',$4,true,$5)`, [context.current.communityId, ticketId, result.rows[0].id, "Intervención programada: " + title, context.user.id]);
    await notifyTicket(client, context, ticketId, "work-order:" + result.rows[0].id, "Intervención programada", title);
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "incidencias.work_order_created", resourceType: "ticket_work_order", resourceId: result.rows[0].id, after: { ticketId, title, scheduledAt, scheduledPrecision, timeZone: context.current.timeZone, estimatedCostCents: cents }, userAgent });
    return result.rows[0];
  });
}

export async function listNotifications(context: AuthContext) {
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const result = await client.query<{ id: string; type: string; title: string; body: string; href: string | null; read_at: Date | null; created_at: Date }>(`SELECT id::text,type,title,body,href,read_at,created_at FROM user_notifications
      WHERE community_id=$1 AND user_id=$2 ORDER BY created_at DESC LIMIT 100`, [context.current.communityId, context.user.id]);
    return { rows: result.rows, unread: result.rows.filter((row) => !row.read_at).length };
  });
}

export async function markNotificationRead(context: AuthContext, id: string) {
  if (!uuid(id)) throw new ApiError(400, "Aviso no válido.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const result = await client.query("UPDATE user_notifications SET read_at=COALESCE(read_at,now()) WHERE id=$1 AND community_id=$2 AND user_id=$3", [id, context.current.communityId, context.user.id]);
    if (!result.rowCount) throw new ApiError(404, "El aviso no existe.", "not_found");
    return { ok: true };
  });
}

export async function markAllNotificationsRead(context: AuthContext) {
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const result = await client.query(
      `UPDATE user_notifications
          SET read_at=COALESCE(read_at,now())
        WHERE community_id=$1 AND user_id=$2 AND read_at IS NULL`,
      [context.current.communityId, context.user.id]
    );
    return { ok: true, updated: result.rowCount ?? 0 };
  });
}
