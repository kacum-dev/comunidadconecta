import "server-only";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { withTenant } from "./db";
import { canCloseTransition, canTransitionItem, nextTransitionStatus } from "./transition-domain";
import { can } from "./permissions";

const uuid = (value: string) => /^[0-9a-f-]{36}$/i.test(value);
const partyTypes = ["outgoing", "incoming", "community"] as const;

function requireRead(context: AuthContext) {
  if (!can(context.current.role, "transicion", "read")) throw new ApiError(403, "No puedes consultar la transición.", "forbidden");
}
function requireWrite(context: AuthContext) {
  if (!can(context.current.role, "transicion", "write")) throw new ApiError(403, "No puedes gestionar la transición.", "forbidden");
}

export async function getTransition(context: AuthContext, id?: string) {
  requireRead(context);
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const transitions = await db.query(`SELECT id::text,title,status,event_date,due_date,contact,assigned_to,description
      FROM transitions WHERE community_id=$1 AND archived_at IS NULL ORDER BY created_at DESC`, [context.current.communityId]);
    const selected = transitions.rows.find((row: { id: string }) => row.id === id) || transitions.rows[0] || null;
    if (!selected) return { transitions: transitions.rows, selected: null, parties: [], items: [], events: [] };
    const [parties, items, events] = await Promise.all([
      db.query(`SELECT id::text,party_type,name,email::text,status,accepted_at,user_id::text
        FROM transition_parties WHERE community_id=$1 AND transition_id=$2 ORDER BY party_type`, [context.current.communityId, selected.id]),
      db.query(`SELECT id::text,category,title,description,status,checksum,delivered_at,accepted_at,reservation_note
        FROM transition_items WHERE community_id=$1 AND transition_id=$2 ORDER BY category,title`, [context.current.communityId, selected.id]),
      db.query(`SELECT id::text,event_type,description,created_at FROM transition_events
        WHERE community_id=$1 AND transition_id=$2 ORDER BY created_at DESC`, [context.current.communityId, selected.id]),
    ]);
    return { transitions: transitions.rows, selected, parties: parties.rows, items: items.rows, events: events.rows };
  });
}

export async function upsertTransitionParty(
  context: AuthContext,
  transitionId: string,
  input: { partyType?: string; name?: string; email?: string },
  userAgent?: string | null,
) {
  requireWrite(context);
  const partyType = String(input.partyType || "");
  const name = String(input.name || "").trim();
  const email = String(input.email || "").trim().toLowerCase();
  if (!uuid(transitionId) || !partyTypes.includes(partyType as typeof partyTypes[number]) || name.length < 2 || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new ApiError(400, "Nombre, correo o tipo de parte no válidos.", "validation_error");
  }
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const transition = await db.query<{ id: string }>("SELECT id::text FROM transitions WHERE id=$1 AND community_id=$2 AND archived_at IS NULL AND status<>'closed'", [transitionId, context.current.communityId]);
    if (!transition.rowCount) throw new ApiError(404, "Transición no encontrada.", "not_found");
    const user = await db.query<{ id: string }>("SELECT id::text FROM app_users WHERE lower(email::text)=lower($1) LIMIT 1", [email]);
    const result = await db.query<{ id: string; linked: boolean }>(`INSERT INTO transition_parties(community_id,transition_id,party_type,name,email,user_id,status,accepted_at)
      VALUES($1,$2,$3,$4,$5,$6,'invited',NULL)
      ON CONFLICT(transition_id,party_type) DO UPDATE SET name=EXCLUDED.name,email=EXCLUDED.email,user_id=EXCLUDED.user_id,status='invited',accepted_at=NULL
      RETURNING id::text,(user_id IS NOT NULL) AS linked`, [context.current.communityId, transitionId, partyType, name, email, user.rows[0]?.id || null]);
    await db.query(`INSERT INTO transition_events(community_id,transition_id,event_type,description,actor_user_id)
      VALUES($1,$2,'party_configured',$3,$4)`, [context.current.communityId, transitionId, `${partyType}: ${name}`, context.user.id]);
    await writeAudit(db, { communityId: context.current.communityId, userId: context.user.id, action: "transicion.party_configured", resourceType: "transition", resourceId: transitionId, after: { partyType, name, email, linked: result.rows[0].linked }, userAgent });
    return result.rows[0];
  });
}

export async function acceptTransitionParty(context: AuthContext, partyId: string, userAgent?: string | null) {
  requireWrite(context);
  if (!uuid(partyId)) throw new ApiError(400, "Parte no válida.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const party = await db.query<{ transition_id: string; party_type: string; name: string; status: string; transition_status: string }>(`SELECT p.transition_id::text,p.party_type,p.name,p.status,t.status AS transition_status FROM transition_parties p
      JOIN transitions t ON t.id=p.transition_id AND t.community_id=p.community_id
      WHERE p.id=$1 AND p.community_id=$2 FOR UPDATE OF p,t`, [partyId, context.current.communityId]);
    if (!party.rowCount) throw new ApiError(404, "Parte no encontrada.", "not_found");
    if (party.rows[0].transition_status === "closed") throw new ApiError(409, "La transición ya está cerrada.", "invalid_state");
    if (party.rows[0].status === "accepted") throw new ApiError(409, "La aceptación ya estaba registrada.", "invalid_state");
    await db.query("UPDATE transition_parties SET status='accepted',accepted_at=now() WHERE id=$1 AND community_id=$2", [partyId, context.current.communityId]);
    await db.query(`INSERT INTO transition_events(community_id,transition_id,event_type,description,actor_user_id)
      VALUES($1,$2,'party_accepted',$3,$4)`, [context.current.communityId, party.rows[0].transition_id, `Aceptación registrada: ${party.rows[0].name}`, context.user.id]);
    await writeAudit(db, { communityId: context.current.communityId, userId: context.user.id, action: "transicion.party_accepted", resourceType: "transition_party", resourceId: partyId, before: { status: party.rows[0].status }, after: { status: "accepted" }, userAgent });
    return { status: "accepted" };
  });
}

export async function addTransitionItem(
  context: AuthContext,
  transitionId: string,
  input: { category?: string; title?: string; description?: string },
  userAgent?: string | null,
) {
  requireWrite(context);
  const category = String(input.category || "");
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  if (!uuid(transitionId) || !["documents", "banking", "contracts", "keys", "credentials", "pending_cases", "accounting", "other"].includes(category) || title.length < 2) {
    throw new ApiError(400, "Elemento no válido.", "validation_error");
  }
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const transition = await db.query("SELECT 1 FROM transitions WHERE id=$1 AND community_id=$2 AND archived_at IS NULL AND status<>'closed' FOR UPDATE", [transitionId, context.current.communityId]);
    if (!transition.rowCount) throw new ApiError(404, "Transición no encontrada o cerrada.", "not_found");
    const result = await db.query<{ id: string }>(`INSERT INTO transition_items(community_id,transition_id,category,title,description)
      VALUES($1,$2,$3,$4,$5) RETURNING id::text`, [context.current.communityId, transitionId, category, title, description || null]);
    await db.query(`INSERT INTO transition_events(community_id,transition_id,event_type,description,actor_user_id)
      VALUES($1,$2,'item_added',$3,$4)`, [context.current.communityId, transitionId, `Añadido al inventario: ${title}`, context.user.id]);
    await writeAudit(db, { communityId: context.current.communityId, userId: context.user.id, action: "transicion.item_added", resourceType: "transition", resourceId: transitionId, after: { itemId: result.rows[0].id, category, title }, userAgent });
    return result.rows[0];
  });
}

export async function updateTransitionItem(
  context: AuthContext,
  itemId: string,
  input: { status?: string; reservationNote?: string },
  userAgent?: string | null,
) {
  requireWrite(context);
  const status = String(input.status || "");
  if (!uuid(itemId) || !["delivered", "accepted", "reserved"].includes(status)) throw new ApiError(400, "Estado no válido.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const before = await db.query<{ transition_id: string; status: string; title: string; transition_status: string }>(`SELECT i.transition_id::text,i.status,i.title,t.status AS transition_status FROM transition_items i
      JOIN transitions t ON t.id=i.transition_id AND t.community_id=i.community_id
      WHERE i.id=$1 AND i.community_id=$2 FOR UPDATE OF i,t`, [itemId, context.current.communityId]);
    if (!before.rowCount) throw new ApiError(404, "Elemento no encontrado.", "not_found");
    if (before.rows[0].transition_status === "closed") throw new ApiError(409, "La transición ya está cerrada.", "invalid_state");
    if (!canTransitionItem(before.rows[0].status, status)) throw new ApiError(409, "Ese cambio de estado no está permitido.", "invalid_state");
    const reservationNote = String(input.reservationNote || "").trim().slice(0, 1000);
    if (status === "reserved" && !reservationNote) throw new ApiError(400, "Explica la reserva antes de continuar.", "validation_error");
    await db.query(`UPDATE transition_items SET status=$3,
      delivered_by=CASE WHEN $3='delivered' THEN $4 ELSE delivered_by END,
      delivered_at=CASE WHEN $3='delivered' THEN now() ELSE delivered_at END,
      accepted_by=CASE WHEN $3='accepted' THEN $4 ELSE accepted_by END,
      accepted_at=CASE WHEN $3='accepted' THEN now() ELSE accepted_at END,
      reservation_note=CASE WHEN $3='reserved' THEN $5 ELSE reservation_note END
      WHERE id=$1 AND community_id=$2`, [itemId, context.current.communityId, status, context.user.id, reservationNote || null]);
    await db.query(`INSERT INTO transition_events(community_id,transition_id,event_type,description,actor_user_id)
      VALUES($1,$2,$3,$4,$5)`, [context.current.communityId, before.rows[0].transition_id, `item_${status}`, `${before.rows[0].title}: ${status}`, context.user.id]);
    await writeAudit(db, { communityId: context.current.communityId, userId: context.user.id, action: "transicion.item_updated", resourceType: "transition_item", resourceId: itemId, before: { status: before.rows[0].status }, after: { status }, userAgent });
    return { status };
  });
}

export async function advanceTransition(context: AuthContext, transitionId: string, userAgent?: string | null) {
  requireWrite(context);
  if (!uuid(transitionId)) throw new ApiError(400, "Transición no válida.", "validation_error");
  return withTenant(context.current.communityId, context.user.id, async (db) => {
    const transition = await db.query<{ status: string }>("SELECT status FROM transitions WHERE id=$1 AND community_id=$2 FOR UPDATE", [transitionId, context.current.communityId]);
    if (!transition.rowCount) throw new ApiError(404, "Transición no encontrada.", "not_found");
    const next = nextTransitionStatus(transition.rows[0].status);
    if (!next) throw new ApiError(409, "La transición ya está cerrada.", "invalid_state");

    const items = await db.query<{ status: string }>("SELECT status FROM transition_items WHERE community_id=$1 AND transition_id=$2", [context.current.communityId, transitionId]);
    const parties = await db.query<{ partyType: string; status: string; userId: string | null }>(`SELECT party_type AS "partyType",status,user_id::text AS "userId"
      FROM transition_parties WHERE community_id=$1 AND transition_id=$2`, [context.current.communityId, transitionId]);

    if (next === "delivery" && items.rowCount === 0) throw new ApiError(409, "Añade el inventario antes de iniciar la entrega.", "incomplete_handover");
    if (next === "revocation" && items.rows.some((item) => item.status === "pending")) throw new ApiError(409, "Todos los elementos deben estar entregados, aceptados o reservados.", "incomplete_handover");
    if (next === "revocation") {
      const outgoing = parties.rows.find((party) => party.partyType === "outgoing");
      if (!outgoing?.userId) throw new ApiError(409, "La administración saliente debe corresponder a un usuario de la plataforma.", "identity_not_linked");
      await db.query(`UPDATE memberships SET status='revoked',valid_to=now(),updated_at=now()
        WHERE community_id=$1 AND role='administrator' AND status='active' AND user_id=$2`, [context.current.communityId, outgoing.userId]);
    }
    if (next === "onboarding") {
      const incoming = parties.rows.find((party) => party.partyType === "incoming");
      if (!incoming || incoming.status !== "accepted" || !incoming.userId) throw new ApiError(409, "La administración entrante debe aceptar y tener una cuenta registrada.", "identity_not_linked");
      await db.query(`INSERT INTO memberships(community_id,user_id,role,status,valid_from)
        VALUES($1,$2,'administrator','active',now())
        ON CONFLICT(community_id,user_id,role) DO UPDATE SET status='active',valid_from=now(),valid_to=NULL,updated_at=now()`, [context.current.communityId, incoming.userId]);
    }
    if (next === "closed" && !canCloseTransition(items.rows, parties.rows)) {
      throw new ApiError(409, "Faltan elementos aceptados o la conformidad de las partes para cerrar.", "incomplete_handover");
    }

    await db.query("UPDATE transitions SET status=$3,version=version+1,updated_by=$4 WHERE id=$1 AND community_id=$2", [transitionId, context.current.communityId, next, context.user.id]);
    await db.query(`INSERT INTO transition_events(community_id,transition_id,event_type,description,actor_user_id)
      VALUES($1,$2,'stage_changed',$3,$4)`, [context.current.communityId, transitionId, `Fase: ${next}`, context.user.id]);
    await writeAudit(db, { communityId: context.current.communityId, userId: context.user.id, action: "transicion.advanced", resourceType: "transition", resourceId: transitionId, before: { status: transition.rows[0].status }, after: { status: next }, userAgent });
    return { status: next };
  });
}
