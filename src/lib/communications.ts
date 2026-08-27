import "server-only";

import { timingSafeEqual } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { query, withTenant } from "./db";
import type { Role } from "./permissions";
import { isResidentRole } from "./permissions";
import {
  communicationTimelineLabel,
  isCommunicationChannel,
  isCommunicationDirection,
  isCommunicationPriority,
  isCommunicationStatus,
  parseOccurredAt,
  type CommunicationChannel,
  type CommunicationDirection,
  type CommunicationPriority,
  type CommunicationStatus
} from "./communications-domain";

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const systemContextUserId = "00000000-0000-0000-0000-000000000000";
const staffRoles = new Set<Role>(["administrator", "president", "vice_president", "secretary", "platform_admin"]);

function isUuid(value: unknown): value is string { return typeof value === "string" && uuidPattern.test(value); }
function cleanText(value: unknown, max: number) { return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max); }

function assertCommunicationAccess(context: AuthContext) {
  if (!isResidentRole(context.current.role) && !staffRoles.has(context.current.role)) throw new ApiError(403, "Tu función no permite consultar conversaciones privadas.", "forbidden");
}
function assertCommunicationManagement(context: AuthContext) {
  if (!staffRoles.has(context.current.role)) throw new ApiError(403, "Tu función no permite gestionar conversaciones privadas.", "forbidden");
}

async function findParticipantByEmail(client: PoolClient, communityId: string, email: string) {
  if (!email) return null;
  const result = await client.query<{ id: string; full_name: string; email: string }>(`SELECT u.id::text,u.full_name,u.email::text FROM memberships m JOIN app_users u ON u.id=m.user_id WHERE m.community_id=$1 AND lower(u.email::text)=lower($2) AND m.status='active' AND m.valid_from<=now() AND (m.valid_to IS NULL OR m.valid_to>now()) AND u.status='active' ORDER BY CASE m.role WHEN 'owner' THEN 1 WHEN 'resident' THEN 2 ELSE 3 END LIMIT 1`, [communityId, email]);
  return result.rows[0] ?? null;
}
async function findPrimaryUnit(client: PoolClient, communityId: string, userId: string) {
  const result = await client.query<{ id: string; code: string }>(`SELECT pu.id::text,pu.code FROM unit_relations ur JOIN private_units pu ON pu.id=ur.unit_id AND pu.community_id=ur.community_id WHERE ur.community_id=$1 AND ur.user_id=$2 AND ur.status='active' AND (ur.valid_to IS NULL OR ur.valid_to>now()) AND pu.status='active' ORDER BY CASE ur.relation_type WHEN 'owner' THEN 1 WHEN 'co_owner' THEN 2 ELSE 3 END,pu.code LIMIT 1`, [communityId, userId]);
  return result.rows[0] ?? null;
}

async function mirrorMessageToTicket(client: PoolClient, input: { communityId: string; ticketId: string | null; channel: CommunicationChannel; direction: CommunicationDirection; body: string; visibleToResident: boolean; createdBy: string | null }) {
  if (!input.ticketId) return;
  await client.query(`INSERT INTO ticket_updates(community_id,ticket_id,kind,message,visible_to_resident,created_by) SELECT $1,$2,'comment',$3,$4,$5 WHERE EXISTS(SELECT 1 FROM tickets WHERE id=$2 AND community_id=$1 AND archived_at IS NULL)`, [input.communityId, input.ticketId, `[${communicationTimelineLabel(input.channel, input.direction)}] ${input.body}`.slice(0, 2000), input.visibleToResident, input.createdBy]);
}

async function notifyResidentOfReply(client: PoolClient, input: { communityId: string; participantUserId: string | null; threadId: string; subject: string; messageId: string; body: string }) {
  if (!input.participantUserId) return;
  const settings = await client.query<{ notifications_email: boolean; notifications_push: boolean }>(`SELECT notifications_email,notifications_push FROM community_app_settings WHERE community_id=$1`, [input.communityId]);
  const channels = [...(settings.rows[0]?.notifications_email ? ["email"] : []), ...(settings.rows[0]?.notifications_push ? ["push"] : [])];
  const notification = await client.query<{ id: string }>(`INSERT INTO user_notifications(community_id,user_id,type,title,body,href,source_type,source_id,idempotency_key) VALUES($1,$2,'communication',$3,$4,'/avisos','communication',$5,$6) ON CONFLICT(community_id,user_id,idempotency_key) DO NOTHING RETURNING id::text`, [input.communityId, input.participantUserId, `Nueva respuesta · ${input.subject}`.slice(0, 200), input.body.slice(0, 500), input.threadId, `communication:${input.messageId}:${input.participantUserId}`]);
  if (notification.rowCount && channels.length) await client.query(`INSERT INTO notification_outbox(community_id,notification_id,channel) SELECT $1,$2,channel FROM unnest($3::text[]) channel ON CONFLICT DO NOTHING`, [input.communityId, notification.rows[0].id, channels]);
}

export async function getCommunicationInbox(context: AuthContext) {
  assertCommunicationAccess(context);
  const resident = isResidentRole(context.current.role);
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const threads = await client.query<{ id: string; subject: string; status: CommunicationStatus; priority: CommunicationPriority; source_channel: CommunicationChannel; last_channel: CommunicationChannel; participant_user_id: string | null; participant_name: string | null; participant_email: string | null; private_unit_id: string | null; unit_code: string | null; contact_name: string | null; contact_address: string | null; assigned_user_id: string | null; assigned_name: string | null; related_ticket_id: string | null; related_ticket_code: string | null; related_ticket_title: string | null; related_ticket_status: string | null; last_activity_at: Date; last_message: string | null }>(`SELECT th.id::text,th.subject,th.status,th.priority,th.source_channel,th.last_channel,th.participant_user_id::text,participant.full_name participant_name,participant.email::text participant_email,th.private_unit_id::text,pu.code unit_code,th.contact_name,th.contact_address,th.assigned_user_id::text,assigned.full_name assigned_name,th.related_ticket_id::text,t.code related_ticket_code,t.title related_ticket_title,t.status related_ticket_status,th.last_activity_at,last_message.body last_message FROM communication_threads th LEFT JOIN app_users participant ON participant.id=th.participant_user_id LEFT JOIN app_users assigned ON assigned.id=th.assigned_user_id LEFT JOIN private_units pu ON pu.id=th.private_unit_id AND pu.community_id=th.community_id LEFT JOIN tickets t ON t.id=th.related_ticket_id AND t.community_id=th.community_id LEFT JOIN LATERAL (SELECT m.body FROM communication_messages m WHERE m.community_id=th.community_id AND m.thread_id=th.id AND ($2::boolean=false OR m.visible_to_resident=true) ORDER BY m.occurred_at DESC,m.created_at DESC LIMIT 1) last_message ON true WHERE th.community_id=$1 AND ($2::boolean=false OR th.participant_user_id=$3) ORDER BY th.last_activity_at DESC LIMIT 100`, [context.current.communityId, resident, context.user.id]);
    const threadIds = threads.rows.map((thread) => thread.id);
    const messages = threadIds.length ? await client.query<{ id: string; thread_id: string; direction: CommunicationDirection; channel: CommunicationChannel; body: string; sender_name: string | null; sender_address: string | null; visible_to_resident: boolean; delivery_status: string; occurred_at: Date; author_name: string | null }>(`SELECT m.id::text,m.thread_id::text,m.direction,m.channel,m.body,m.sender_name,m.sender_address,m.visible_to_resident,m.delivery_status,m.occurred_at,author.full_name author_name FROM communication_messages m LEFT JOIN app_users author ON author.id=m.created_by WHERE m.community_id=$1 AND m.thread_id=ANY($2::uuid[]) AND ($3::boolean=false OR m.visible_to_resident=true) ORDER BY m.occurred_at,m.created_at`, [context.current.communityId, threadIds, resident]) : { rows: [] };
    const tickets = resident ? { rows: [] } : await client.query<{ id: string; code: string | null; title: string; status: string; location: string | null }>(`SELECT id::text,code,title,status,location FROM tickets WHERE community_id=$1 AND archived_at IS NULL ORDER BY updated_at DESC LIMIT 100`, [context.current.communityId]);
    return { threads: threads.rows, messages: messages.rows, tickets: tickets.rows, capabilities: { resident, canManage: !resident && staffRoles.has(context.current.role) } };
  });
}

export async function createCommunicationThread(context: AuthContext, input: { subject?: unknown; body?: unknown; priority?: unknown; channel?: unknown; direction?: unknown; contactName?: unknown; contactAddress?: unknown; participantEmail?: unknown }, userAgent?: string | null) {
  assertCommunicationAccess(context);
  const resident = isResidentRole(context.current.role);
  const subject = cleanText(input.subject, 300); const body = cleanText(input.body, 10000);
  if (subject.length < 3 || !body) throw new ApiError(400, "Indica un asunto y un mensaje.", "validation_error");
  const priority: CommunicationPriority = isCommunicationPriority(input.priority) ? input.priority : "normal";
  const channel: CommunicationChannel = resident ? "app" : (isCommunicationChannel(input.channel) ? input.channel : "app");
  const direction: CommunicationDirection = resident ? "inbound" : (isCommunicationDirection(input.direction) && input.direction !== "system" ? input.direction : "inbound");
  const contactName = cleanText(input.contactName, 200), contactAddress = cleanText(input.contactAddress, 300), participantEmail = cleanText(input.participantEmail, 320);
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    let participantUserId: string | null = resident ? context.user.id : null;
    let participantName = resident ? context.user.fullName : contactName;
    let participantAddress = resident ? context.user.email : contactAddress;
    if (!resident && participantEmail) { const participant = await findParticipantByEmail(client, context.current.communityId, participantEmail); if (participant) { participantUserId = participant.id; participantName ||= participant.full_name; participantAddress ||= participant.email; } }
    const unit = participantUserId ? await findPrimaryUnit(client, context.current.communityId, participantUserId) : null;
    const privateUnitId = resident && context.primaryHome?.id && isUuid(context.primaryHome.id) ? context.primaryHome.id : unit?.id ?? null;
    const thread = await client.query<{ id: string }>(`INSERT INTO communication_threads(community_id,participant_user_id,private_unit_id,subject,status,priority,source_channel,last_channel,contact_name,contact_address,last_activity_at,created_by,updated_by) VALUES($1,$2,$3,$4,'open',$5,$6,$6,$7,$8,now(),$9,$9) RETURNING id::text`, [context.current.communityId, participantUserId, privateUnitId, subject, priority, channel, participantName || null, participantAddress || null, context.user.id]);
    const visibleToResident = direction !== "internal";
    const message = await client.query<{ id: string }>(`INSERT INTO communication_messages(community_id,thread_id,direction,channel,body,sender_name,sender_address,visible_to_resident,delivery_status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'recorded',$9) RETURNING id::text`, [context.current.communityId, thread.rows[0].id, direction, channel, body, direction === "outbound" ? context.user.fullName : participantName || context.user.fullName, direction === "outbound" ? context.user.email : participantAddress || context.user.email, visibleToResident, context.user.id]);
    if (!resident && direction === "outbound" && visibleToResident) await notifyResidentOfReply(client, { communityId: context.current.communityId, participantUserId, threadId: thread.rows[0].id, subject, messageId: message.rows[0].id, body });
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "communications.thread_created", resourceType: "communication_thread", resourceId: thread.rows[0].id, after: { channel, direction, priority, participantUserId, privateUnitId }, userAgent });
    return { id: thread.rows[0].id };
  });
}

export async function addCommunicationMessage(context: AuthContext, threadId: string, input: { body?: unknown; channel?: unknown; direction?: unknown }, userAgent?: string | null) {
  assertCommunicationAccess(context); if (!isUuid(threadId)) throw new ApiError(400, "Conversación no válida.", "validation_error");
  const resident = isResidentRole(context.current.role); const body = cleanText(input.body, 10000); if (!body) throw new ApiError(400, "Escribe un mensaje.", "validation_error");
  const channel: CommunicationChannel = resident ? "app" : (isCommunicationChannel(input.channel) ? input.channel : "app");
  const direction: CommunicationDirection = resident ? "inbound" : (isCommunicationDirection(input.direction) && input.direction !== "system" ? input.direction : "outbound");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const thread = await client.query<{ subject: string; status: CommunicationStatus; participant_user_id: string | null; contact_name: string | null; contact_address: string | null; related_ticket_id: string | null }>(`SELECT subject,status,participant_user_id::text,contact_name,contact_address,related_ticket_id::text FROM communication_threads WHERE id=$1 AND community_id=$2 AND ($3::boolean=false OR participant_user_id=$4) FOR UPDATE`, [threadId, context.current.communityId, resident, context.user.id]);
    if (!thread.rowCount) throw new ApiError(404, "La conversación no existe o no puedes acceder a ella.", "not_found");
    const current = thread.rows[0], visibleToResident = direction !== "internal";
    const senderName = resident ? context.user.fullName : direction === "inbound" ? current.contact_name : context.user.fullName;
    const senderAddress = resident ? context.user.email : direction === "inbound" ? current.contact_address : context.user.email;
    const message = await client.query<{ id: string }>(`INSERT INTO communication_messages(community_id,thread_id,direction,channel,body,sender_name,sender_address,visible_to_resident,delivery_status,created_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8,'recorded',$9) RETURNING id::text`, [context.current.communityId, threadId, direction, channel, body, senderName, senderAddress, visibleToResident, context.user.id]);
    const reopen = direction === "inbound" && (current.status === "resolved" || current.status === "closed");
    await client.query(`UPDATE communication_threads SET last_channel=$3,last_activity_at=now(),status=CASE WHEN $4 THEN 'open' ELSE status END,updated_by=$5 WHERE id=$1 AND community_id=$2`, [threadId, context.current.communityId, channel, reopen, context.user.id]);
    await mirrorMessageToTicket(client, { communityId: context.current.communityId, ticketId: current.related_ticket_id, channel, direction, body, visibleToResident, createdBy: context.user.id });
    if (!resident && direction === "outbound" && visibleToResident) await notifyResidentOfReply(client, { communityId: context.current.communityId, participantUserId: current.participant_user_id, threadId, subject: current.subject, messageId: message.rows[0].id, body });
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "communications.message_added", resourceType: "communication_message", resourceId: message.rows[0].id, after: { threadId, channel, direction, visibleToResident, relatedTicketId: current.related_ticket_id }, userAgent });
    return { id: message.rows[0].id, reopened: reopen };
  });
}

export async function updateCommunicationStatus(context: AuthContext, threadId: string, input: { status?: unknown }, userAgent?: string | null) {
  assertCommunicationManagement(context); if (!isUuid(threadId) || !isCommunicationStatus(input.status)) throw new ApiError(400, "Estado no válido.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const before = await client.query<{ status: CommunicationStatus }>(`SELECT status FROM communication_threads WHERE id=$1 AND community_id=$2 FOR UPDATE`, [threadId, context.current.communityId]); if (!before.rowCount) throw new ApiError(404, "La conversación no existe.", "not_found");
    await client.query(`UPDATE communication_threads SET status=$3,updated_by=$4,last_activity_at=now() WHERE id=$1 AND community_id=$2`, [threadId, context.current.communityId, input.status, context.user.id]);
    await client.query(`INSERT INTO communication_messages(community_id,thread_id,direction,channel,body,sender_name,visible_to_resident,delivery_status,created_by) VALUES($1,$2,'system','app',$3,$4,true,'recorded',$5)`, [context.current.communityId, threadId, `Estado cambiado a ${input.status}.`, context.user.fullName, context.user.id]);
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "communications.status_changed", resourceType: "communication_thread", resourceId: threadId, before: { status: before.rows[0].status }, after: { status: input.status }, userAgent });
    return { status: input.status };
  });
}

export async function linkCommunicationToTicket(context: AuthContext, threadId: string, input: { ticketId?: unknown }, userAgent?: string | null) {
  assertCommunicationManagement(context); if (!isUuid(threadId)) throw new ApiError(400, "Conversación no válida.", "validation_error");
  const ticketId = input.ticketId === null || input.ticketId === "" || input.ticketId === undefined ? null : String(input.ticketId); if (ticketId !== null && !isUuid(ticketId)) throw new ApiError(400, "Incidencia no válida.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const thread = await client.query<{ related_ticket_id: string | null }>(`SELECT related_ticket_id::text FROM communication_threads WHERE id=$1 AND community_id=$2 FOR UPDATE`, [threadId, context.current.communityId]); if (!thread.rowCount) throw new ApiError(404, "La conversación no existe.", "not_found");
    let ticket: { id: string; code: string | null; title: string } | null = null;
    if (ticketId) { const result = await client.query<{ id: string; code: string | null; title: string }>(`SELECT id::text,code,title FROM tickets WHERE id=$1 AND community_id=$2 AND archived_at IS NULL`, [ticketId, context.current.communityId]); if (!result.rowCount) throw new ApiError(404, "La incidencia no pertenece a esta comunidad.", "ticket_not_found"); ticket = result.rows[0]; }
    await client.query(`UPDATE communication_threads SET related_ticket_id=$3,updated_by=$4,last_activity_at=now() WHERE id=$1 AND community_id=$2`, [threadId, context.current.communityId, ticketId, context.user.id]);
    const note = ticket ? `Conversación vinculada a ${ticket.code || "incidencia"}: ${ticket.title}.` : "Conversación desvinculada de la incidencia.";
    await client.query(`INSERT INTO communication_messages(community_id,thread_id,direction,channel,body,sender_name,visible_to_resident,delivery_status,created_by) VALUES($1,$2,'system','app',$3,$4,true,'recorded',$5)`, [context.current.communityId, threadId, note, context.user.fullName, context.user.id]);
    if (ticket) await client.query(`INSERT INTO ticket_updates(community_id,ticket_id,kind,message,visible_to_resident,created_by) VALUES($1,$2,'comment',$3,true,$4)`, [context.current.communityId, ticket.id, "Se ha vinculado una conversación omnicanal a esta incidencia.", context.user.id]);
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "communications.ticket_linked", resourceType: "communication_thread", resourceId: threadId, before: { ticketId: thread.rows[0].related_ticket_id }, after: { ticketId }, userAgent });
    return { ticketId };
  });
}

function secureSecretMatches(provided: string, expected: string) { const left = Buffer.from(provided), right = Buffer.from(expected); return left.length === right.length && left.length > 0 && timingSafeEqual(left, right); }

export async function ingestInboundEmail(input: { communitySlug?: unknown; senderEmail?: unknown; senderName?: unknown; subject?: unknown; text?: unknown; messageId?: unknown; threadKey?: unknown; receivedAt?: unknown }, providedSecret: string) {
  const expectedSecret = process.env.COMMUNICATION_INGEST_SECRET ?? "";
  if (expectedSecret.length < 32) throw new ApiError(503, "La recepción externa de correo no está configurada.", "integration_not_configured");
  if (!secureSecretMatches(providedSecret, expectedSecret)) throw new ApiError(401, "Credencial de integración no válida.", "unauthorized");
  const communitySlug = cleanText(input.communitySlug, 120), senderEmail = cleanText(input.senderEmail, 320), senderName = cleanText(input.senderName, 200), subject = cleanText(input.subject, 300), body = cleanText(input.text, 10000), messageId = cleanText(input.messageId, 500), threadKey = cleanText(input.threadKey, 500);
  if (!communitySlug || !senderEmail || !subject || !body || !messageId) throw new ApiError(400, "Faltan datos obligatorios del correo recibido.", "validation_error");
  const community = await query<{ id: string }>(`SELECT id::text FROM communities WHERE slug=$1 AND status IN('onboarding','active','transition') LIMIT 1`, [communitySlug]); if (!community.rowCount) throw new ApiError(404, "Comunidad no encontrada.", "community_not_found");
  const communityId = community.rows[0].id;
  return withTenant(communityId, systemContextUserId, async (client) => {
    const duplicate = await client.query<{ id: string; thread_id: string }>(`SELECT id::text,thread_id::text FROM communication_messages WHERE community_id=$1 AND channel='email' AND external_message_id=$2 LIMIT 1`, [communityId, messageId]); if (duplicate.rowCount) return { threadId: duplicate.rows[0].thread_id, messageId: duplicate.rows[0].id, deduplicated: true };
    const participant = await findParticipantByEmail(client, communityId, senderEmail), unit = participant ? await findPrimaryUnit(client, communityId, participant.id) : null;
    let thread: { id: string; related_ticket_id: string | null } | null = null;
    if (threadKey) { const result = await client.query<{ id: string; related_ticket_id: string | null }>(`SELECT id::text,related_ticket_id::text FROM communication_threads WHERE community_id=$1 AND source_channel='email' AND external_thread_key=$2 LIMIT 1`, [communityId, threadKey]); thread = result.rows[0] ?? null; }
    if (!thread) { const result = await client.query<{ id: string; related_ticket_id: string | null }>(`SELECT id::text,related_ticket_id::text FROM communication_threads WHERE community_id=$1 AND status IN('open','pending') AND lower(subject)=lower($2) AND ((participant_user_id IS NOT NULL AND participant_user_id=$3) OR (participant_user_id IS NULL AND lower(contact_address)=lower($4))) AND last_activity_at>now()-interval '30 days' ORDER BY last_activity_at DESC LIMIT 1`, [communityId, subject, participant?.id ?? null, senderEmail]); thread = result.rows[0] ?? null; }
    const occurredAt = parseOccurredAt(input.receivedAt);
    if (!thread) { const inserted = await client.query<{ id: string }>(`INSERT INTO communication_threads(community_id,participant_user_id,private_unit_id,subject,status,priority,source_channel,last_channel,external_thread_key,contact_name,contact_address,last_activity_at) VALUES($1,$2,$3,$4,'open','normal','email','email',$5,$6,$7,$8) RETURNING id::text`, [communityId, participant?.id ?? null, unit?.id ?? null, subject, threadKey || null, senderName || participant?.full_name || null, senderEmail, occurredAt]); thread = { id: inserted.rows[0].id, related_ticket_id: null }; }
    const message = await client.query<{ id: string }>(`INSERT INTO communication_messages(community_id,thread_id,direction,channel,body,sender_name,sender_address,external_message_id,visible_to_resident,delivery_status,metadata,occurred_at) VALUES($1,$2,'inbound','email',$3,$4,$5,$6,true,'delivered',$7::jsonb,$8) RETURNING id::text`, [communityId, thread.id, body, senderName || participant?.full_name || null, senderEmail, messageId, JSON.stringify({ ingest: "email" }), occurredAt]);
    await client.query(`UPDATE communication_threads SET participant_user_id=COALESCE(participant_user_id,$3),private_unit_id=COALESCE(private_unit_id,$4),contact_name=COALESCE(contact_name,$5),contact_address=COALESCE(contact_address,$6),last_channel='email',last_activity_at=$7,status=CASE WHEN status IN('resolved','closed') THEN 'open' ELSE status END WHERE id=$1 AND community_id=$2`, [thread.id, communityId, participant?.id ?? null, unit?.id ?? null, senderName || participant?.full_name || null, senderEmail, occurredAt]);
    await mirrorMessageToTicket(client, { communityId, ticketId: thread.related_ticket_id, channel: "email", direction: "inbound", body, visibleToResident: true, createdBy: null });
    return { threadId: thread.id, messageId: message.rows[0].id, deduplicated: false };
  });
}
