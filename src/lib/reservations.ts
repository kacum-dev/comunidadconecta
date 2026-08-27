import "server-only";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { withTenant } from "./db";
import { can } from "./permissions";
import { validateReservationRules } from "./reservation-domain";

const uuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
const timeMinutes = (value: string) => { const [hours, minutes] = value.split(":").map(Number); return hours * 60 + minutes; };
const validTime = (value: string) => /^(?:[01]\d|2[0-3]):[0-5]\d$/.test(value);
const zonedMinutes = (date: Date, timeZone: string) => {
  const parts = new Intl.DateTimeFormat("en-GB", { timeZone, hour: "2-digit", minute: "2-digit", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((part) => part.type === "hour")?.value || 0);
  const minute = Number(parts.find((part) => part.type === "minute")?.value || 0);
  return hour * 60 + minute;
};

function read(context: AuthContext) {
  if (!can(context.current.role, "reservas", "read")) throw new ApiError(403, "No puedes consultar las reservas.", "forbidden");
}
function write(context: AuthContext) {
  if (!can(context.current.role, "reservas", "write")) throw new ApiError(403, "No puedes gestionar reservas.", "forbidden");
}
const manager = (context: AuthContext) => ["administrator", "president", "vice_president", "platform_admin"].includes(context.current.role);

export async function getReservationDashboard(context: AuthContext, from?: string, to?: string) {
  read(context);
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const start = /^\d{4}-\d{2}-\d{2}$/.test(from || "") ? from : new Date().toISOString().slice(0, 10);
    const end = /^\d{4}-\d{2}-\d{2}$/.test(to || "") ? to : new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10);
    const resources = await db.query(`SELECT id::text,name,kind,location,capacity,opening_time::text,closing_time::text,slot_minutes,min_notice_hours,advance_days,cancellation_hours,max_active_per_user,requires_approval,deposit_cents::text,rules,status
      FROM reservation_resources WHERE community_id=$1 AND status<>'inactive' ORDER BY name`, [context.current.communityId]);
    const bookings = await db.query(`SELECT b.id::text,b.resource_id::text,r.name AS resource_name,r.cancellation_hours,b.user_id::text,b.title,b.attendees,b.starts_at,b.ends_at,b.status,b.deposit_status,b.notes,b.decision_note,
      (b.user_id=$2) AS own FROM reservation_bookings b JOIN reservation_resources r ON r.id=b.resource_id AND r.community_id=b.community_id
      WHERE b.community_id=$1 AND b.starts_at < ($4::date + interval '1 day') AND b.ends_at >= $3::date
      AND ($5::boolean OR b.user_id=$2) ORDER BY b.starts_at`, [context.current.communityId, context.user.id, start, end, manager(context)]);
    const blackouts = await db.query(`SELECT id::text,resource_id::text,starts_at,ends_at,reason FROM reservation_blackouts
      WHERE community_id=$1 AND starts_at < ($3::date + interval '1 day') AND ends_at >= $2::date ORDER BY starts_at`, [context.current.communityId, start, end]);
    return { resources: resources.rows, bookings: bookings.rows, blackouts: blackouts.rows, range: { from: start, to: end }, canManage: manager(context) };
  });
}

export async function createResource(context: AuthContext, input: Record<string, unknown>, userAgent?: string | null) {
  write(context);
  if (!manager(context)) throw new ApiError(403, "Solo gobierno o administración pueden configurar recursos.", "forbidden");
  const name = String(input.name || "").trim();
  const kind = String(input.kind || "other");
  const capacity = Number(input.capacity || 1);
  const openingTime = String(input.openingTime || "08:00");
  const closingTime = String(input.closingTime || "22:00");
  const slotMinutes = Number(input.slotMinutes || 60);
  const minNoticeHours = Number(input.minNoticeHours ?? 2);
  const advanceDays = Number(input.advanceDays ?? 30);
  const cancellationHours = Number(input.cancellationHours ?? 12);
  const maxActivePerUser = Number(input.maxActivePerUser ?? 3);
  const depositCents = Math.round(Number(input.depositEuros ?? 0) * 100);
  if (name.length < 2 || !["community_room","pool","sports","moving","barbecue","parking","other"].includes(kind) || !Number.isInteger(capacity) || capacity < 1 || !validTime(openingTime) || !validTime(closingTime) || timeMinutes(closingTime) <= timeMinutes(openingTime) ||
    !Number.isInteger(slotMinutes) || slotMinutes < 15 || slotMinutes > 1440 || !Number.isInteger(minNoticeHours) || minNoticeHours < 0 || !Number.isInteger(advanceDays) || advanceDays < 1 || advanceDays > 365 ||
    !Number.isInteger(cancellationHours) || cancellationHours < 0 || !Number.isInteger(maxActivePerUser) || maxActivePerUser < 1 || !Number.isSafeInteger(depositCents) || depositCents < 0) {
    throw new ApiError(400, "Configuración de recurso no válida.", "validation_error");
  }
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const result = await db.query<{ id: string }>(`INSERT INTO reservation_resources(community_id,name,kind,location,capacity,opening_time,closing_time,slot_minutes,min_notice_hours,advance_days,cancellation_hours,max_active_per_user,requires_approval,deposit_cents,rules,created_by)
      VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id::text`, [
      context.current.communityId, name, kind, String(input.location || "").trim() || null, capacity, openingTime, closingTime, slotMinutes,
      minNoticeHours, advanceDays, cancellationHours, maxActivePerUser,
      input.requiresApproval === true, depositCents, String(input.rules || "").trim().slice(0, 5000) || null, context.user.id,
    ]);
    await writeAudit(db, { communityId: context.current.communityId, userId: context.user.id, action: "reservas.resource_created", resourceType: "reservation_resource", resourceId: result.rows[0].id, after: { name, kind }, userAgent });
    return result.rows[0];
  });
}

export async function createBooking(context: AuthContext, input: Record<string, unknown>, userAgent?: string | null) {
  write(context);
  const resourceId = String(input.resourceId || "");
  const title = String(input.title || "").trim();
  const attendees = Number(input.attendees || 1);
  const startsAt = new Date(String(input.startsAt || ""));
  const endsAt = new Date(String(input.endsAt || ""));
  if (!uuid(resourceId) || title.length < 2 || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime())) throw new ApiError(400, "Datos de reserva no válidos.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const resource = await db.query<{ name: string; capacity: number; opening_time: string; closing_time: string; slot_minutes: number; min_notice_hours: number; advance_days: number; max_active_per_user: number; requires_approval: boolean; deposit_cents: string; status: string; timezone: string }>(`SELECT r.name,r.capacity,r.opening_time::text,r.closing_time::text,r.slot_minutes,r.min_notice_hours,r.advance_days,r.max_active_per_user,r.requires_approval,r.deposit_cents::text,r.status,c.timezone
      FROM reservation_resources r JOIN communities c ON c.id=r.community_id WHERE r.id=$1 AND r.community_id=$2 FOR SHARE`, [resourceId, context.current.communityId]);
    if (!resource.rowCount || resource.rows[0].status !== "active") throw new ApiError(409, "El recurso no está disponible.", "resource_unavailable");
    const r = resource.rows[0];
    const ruleError = validateReservationRules({ now: new Date(), startsAt, endsAt, openingMinutes: timeMinutes(r.opening_time), closingMinutes: timeMinutes(r.closing_time), startMinutes: zonedMinutes(startsAt, r.timezone), endMinutes: zonedMinutes(endsAt, r.timezone), slotMinutes: r.slot_minutes, minNoticeHours: r.min_notice_hours, advanceDays: r.advance_days, capacity: r.capacity, attendees });
    if (ruleError) throw new ApiError(409, ruleError, "reservation_rule");
    const count = await db.query<{ count: string }>(`SELECT count(*)::text FROM reservation_bookings WHERE community_id=$1 AND user_id=$2 AND status IN('requested','confirmed') AND ends_at>now()`, [context.current.communityId, context.user.id]);
    if (Number(count.rows[0].count) >= r.max_active_per_user) throw new ApiError(409, "Has alcanzado el máximo de reservas activas.", "booking_limit");
    const blocked = await db.query(`SELECT 1 FROM reservation_blackouts WHERE community_id=$1 AND resource_id=$2 AND tstzrange(starts_at,ends_at,'[)') && tstzrange($3,$4,'[)') LIMIT 1`, [context.current.communityId, resourceId, startsAt.toISOString(), endsAt.toISOString()]);
    if (blocked.rowCount) throw new ApiError(409, "La franja está bloqueada por mantenimiento u otro motivo.", "resource_blackout");
    const status = r.requires_approval ? "requested" : "confirmed";
    const depositStatus = Number(r.deposit_cents) > 0 ? "pending" : "not_required";
    try {
      const result = await db.query<{ id: string }>(`INSERT INTO reservation_bookings(community_id,resource_id,user_id,title,attendees,starts_at,ends_at,status,deposit_status,notes)
        VALUES($1,$2,$3,$4,$5,$6,$7,$8,$9,$10) RETURNING id::text`, [context.current.communityId, resourceId, context.user.id, title, attendees, startsAt.toISOString(), endsAt.toISOString(), status, depositStatus, String(input.notes || "").trim().slice(0, 2000) || null]);
      await writeAudit(db, { communityId: context.current.communityId, userId: context.user.id, action: "reservas.booking_created", resourceType: "reservation_booking", resourceId: result.rows[0].id, after: { resourceId, startsAt, endsAt, status }, userAgent });
      return { ...result.rows[0], status };
    } catch (cause) {
      if (cause && typeof cause === "object" && "code" in cause && cause.code === "23P01") throw new ApiError(409, "La franja acaba de ser reservada por otra persona.", "booking_conflict");
      throw cause;
    }
  });
}

export async function decideBooking(context: AuthContext, bookingId: string, input: { decision?: string; note?: string }, userAgent?: string | null) {
  write(context);
  if (!manager(context)) throw new ApiError(403, "Decisión no autorizada.", "forbidden");
  if (!uuid(bookingId) || !["confirmed","rejected"].includes(String(input.decision))) throw new ApiError(400, "Decisión no válida.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const before = await db.query<{ status: string }>("SELECT status FROM reservation_bookings WHERE id=$1 AND community_id=$2 FOR UPDATE", [bookingId, context.current.communityId]);
    if (!before.rowCount) throw new ApiError(404, "Reserva no encontrada.", "not_found");
    if (before.rows[0].status !== "requested") throw new ApiError(409, "La reserva ya fue decidida.", "invalid_state");
    const decision = String(input.decision);
    await db.query("UPDATE reservation_bookings SET status=$3,decision_note=$4,decided_by=$5,decided_at=now(),updated_at=now() WHERE id=$1 AND community_id=$2", [bookingId, context.current.communityId, decision, String(input.note || "").trim() || null, context.user.id]);
    await writeAudit(db, { communityId: context.current.communityId, userId: context.user.id, action: "reservas.booking_decided", resourceType: "reservation_booking", resourceId: bookingId, before: { status: before.rows[0].status }, after: { status: decision }, userAgent });
    return { status: decision };
  });
}

export async function cancelBooking(context: AuthContext, bookingId: string, userAgent?: string | null) {
  write(context);
  if (!uuid(bookingId)) throw new ApiError(400, "Reserva no válida.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const booking = await db.query<{ status: string; user_id: string; starts_at: Date; cancellation_hours: number }>(`SELECT b.status,b.user_id::text,b.starts_at,r.cancellation_hours FROM reservation_bookings b JOIN reservation_resources r ON r.id=b.resource_id AND r.community_id=b.community_id
      WHERE b.id=$1 AND b.community_id=$2 FOR UPDATE`, [bookingId, context.current.communityId]);
    if (!booking.rowCount) throw new ApiError(404, "Reserva no encontrada.", "not_found");
    const b = booking.rows[0];
    if (b.user_id !== context.user.id && !manager(context)) throw new ApiError(403, "No puedes cancelar esta reserva.", "forbidden");
    if (!["requested","confirmed"].includes(b.status)) throw new ApiError(409, "La reserva no puede cancelarse.", "invalid_state");
    if (!manager(context) && b.starts_at.getTime() - Date.now() < b.cancellation_hours * 3_600_000) throw new ApiError(409, "Ha vencido el plazo de cancelación.", "cancellation_deadline");
    await db.query("UPDATE reservation_bookings SET status='cancelled',cancelled_by=$3,cancelled_at=now(),updated_at=now() WHERE id=$1 AND community_id=$2", [bookingId, context.current.communityId, context.user.id]);
    await writeAudit(db, { communityId: context.current.communityId, userId: context.user.id, action: "reservas.booking_cancelled", resourceType: "reservation_booking", resourceId: bookingId, before: { status: b.status }, after: { status: "cancelled" }, userAgent });
    return { status: "cancelled" };
  });
}

export async function createBlackout(context: AuthContext, input: Record<string, unknown>, userAgent?: string | null) {
  write(context);
  if (!manager(context)) throw new ApiError(403, "No puedes bloquear recursos.", "forbidden");
  const resourceId = String(input.resourceId || "");
  const startsAt = new Date(String(input.startsAt || ""));
  const endsAt = new Date(String(input.endsAt || ""));
  const reason = String(input.reason || "").trim();
  if (!uuid(resourceId) || Number.isNaN(startsAt.getTime()) || Number.isNaN(endsAt.getTime()) || endsAt <= startsAt || reason.length < 3) {
    throw new ApiError(400, "Datos del bloqueo no válidos.", "validation_error");
  }
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const resource = await db.query("SELECT 1 FROM reservation_resources WHERE id=$1 AND community_id=$2", [resourceId, context.current.communityId]);
    if (!resource.rowCount) throw new ApiError(404, "Recurso no encontrado.", "not_found");
    const conflicts = await db.query(`SELECT count(*)::text AS count FROM reservation_bookings
      WHERE community_id=$1 AND resource_id=$2 AND status IN('requested','confirmed')
      AND tstzrange(starts_at,ends_at,'[)') && tstzrange($3,$4,'[)')`, [context.current.communityId, resourceId, startsAt.toISOString(), endsAt.toISOString()]);
    if (Number(conflicts.rows[0].count) > 0) throw new ApiError(409, "Hay reservas activas en esa franja. Cancélalas o elige otro horario.", "booking_conflict");
    const result = await db.query<{ id: string }>(`INSERT INTO reservation_blackouts(community_id,resource_id,starts_at,ends_at,reason,created_by)
      VALUES($1,$2,$3,$4,$5,$6) RETURNING id::text`, [context.current.communityId, resourceId, startsAt.toISOString(), endsAt.toISOString(), reason, context.user.id]);
    await writeAudit(db, { communityId: context.current.communityId, userId: context.user.id, action: "reservas.blackout_created", resourceType: "reservation_blackout", resourceId: result.rows[0].id, after: { resourceId, startsAt, endsAt, reason }, userAgent });
    return result.rows[0];
  });
}
