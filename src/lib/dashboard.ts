import "server-only";

import type { AuthContext } from "./auth";
import { withTenant } from "./db";
import { isResidentRole, roleLabels } from "./permissions";
import { formatCalendarDate } from "./temporal";

export interface DashboardMetric {
  label: string;
  value: string;
  detail: string;
  href: string;
  tone: "purple" | "orange" | "blue" | "green";
  icon: string;
}

export interface DashboardData {
  profile: { eyebrow: string; title: string; description: string };
  metrics: DashboardMetric[];
  pendingBalanceCents: number;
  nextMeeting: { title: string; eventDate: string; eventTimePrecision: "day" | "minute" | "second"; location: string | null } | null;
  importantNotice: { title: string; description: string | null; priority: string | null; eventDate: string | null; eventTimePrecision: "day" | "minute" | "second" | null } | null;
  recent: Array<{ id: string; module: string; title: string; status: string; updatedAt: string }>;
  home: { id: string; code: string; relation: string; occupancyStatus: string; people: number } | null;
  attention: Array<{ label: string; detail: string; href: string; icon: string; tone: string }>;
}

const euros = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

function profileFor(context: AuthContext) {
  const name = context.current.communityName;
  switch (context.current.role) {
    case "president": return { eyebrow: "PRESIDENCIA", title: "Panel de gobierno", description: `Decisiones, supervisión y asuntos que necesitan tu criterio en ${name}.` };
    case "vice_president": return { eyebrow: "VICEPRESIDENCIA", title: "Seguimiento de la comunidad", description: "Visión ejecutiva para apoyar a Presidencia sin invadir funciones reservadas." };
    case "secretary": return { eyebrow: "SECRETARÍA", title: "Agenda y documentación", description: "Juntas, comunicaciones y documentos institucionales bajo control." };
    case "treasurer": return { eyebrow: "TESORERÍA", title: "Control económico", description: "Cobros, conciliación y expedientes económicos que requieren seguimiento." };
    case "administrator": return { eyebrow: "ADMINISTRACIÓN PROFESIONAL", title: "Mesa de trabajo", description: "Toda la operativa diaria de la comunidad, con permisos acotados y trazabilidad." };
    case "owner": return { eyebrow: "TU COMUNIDAD", title: "Todo lo importante, de un vistazo", description: "Tu vivienda, tus recibos y lo que está ocurriendo en la finca." };
    case "resident": return { eyebrow: "TU COMUNIDAD", title: "Tu día a día, más sencillo", description: "Avisos, incidencias y servicios de la vivienda en la que resides." };
    default: return { eyebrow: roleLabels[context.current.role].toUpperCase(), title: "Resumen de actividad", description: `Información disponible para tu perfil en ${name}.` };
  }
}

export async function getDashboardData(context: AuthContext): Promise<DashboardData> {
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const resident = isResidentRole(context.current.role);
    const ownUnits = resident ? await client.query<{
      id: string; code: string; relation_type: string; status: string; people: number;
    }>(
      `SELECT pu.id::text, pu.code, mine.relation_type, mine.status,
              (SELECT count(*)::int FROM unit_relations all_people
                WHERE all_people.unit_id = pu.id AND all_people.community_id = pu.community_id
                  AND all_people.status = 'active' AND (all_people.valid_to IS NULL OR all_people.valid_to >= current_date)) AS people
         FROM unit_relations mine JOIN private_units pu ON pu.id = mine.unit_id
        WHERE mine.community_id = $1 AND mine.user_id = $2 AND mine.status = 'active'
          AND mine.valid_from <= current_date AND (mine.valid_to IS NULL OR mine.valid_to >= current_date)
        ORDER BY mine.is_primary DESC, pu.code LIMIT 1`,
      [context.current.communityId, context.user.id]
    ) : null;
    const unitId = ownUnits?.rows[0]?.id ?? null;

    const stats = await client.query<{
      pending_balance: string; open_tickets: number; pending_approvals: number;
      current_documents: number; unmatched_bank: number; pending_occupants: number;
      upcoming_reservations: number; published_notices: number;
    }>(
      `SELECT
        COALESCE((SELECT sum(amount_cents) FROM financial_records WHERE community_id = $1
          AND status IN ('pending','issued','returned') AND archived_at IS NULL
          AND ($3::boolean = false OR private_unit_id = $2::uuid)), 0)::text AS pending_balance,
        (SELECT count(*)::int FROM tickets WHERE community_id = $1 AND status NOT IN ('closed','validated')
          AND archived_at IS NULL AND ($3::boolean = false OR created_by = $4 OR private_unit_id = $2::uuid)) AS open_tickets,
        (SELECT count(*)::int FROM approvals WHERE community_id = $1 AND status = 'pending' AND archived_at IS NULL) AS pending_approvals,
        (SELECT count(*)::int FROM documents WHERE community_id = $1 AND status = 'current' AND archived_at IS NULL
          AND ($3::boolean = false OR private_unit_id = $2::uuid OR COALESCE(data->>'audience','community') IN ('community','owners','residents'))) AS current_documents,
        (SELECT count(*)::int FROM bank_transactions WHERE community_id = $1 AND status = 'unmatched' AND archived_at IS NULL) AS unmatched_bank,
        (SELECT count(*)::int FROM unit_relations WHERE community_id = $1 AND status = 'pending') AS pending_occupants,
        (SELECT count(*)::int FROM reservations WHERE community_id = $1 AND status IN ('requested','confirmed')
          AND event_at >= now() AND archived_at IS NULL AND ($3::boolean = false OR created_by = $4 OR private_unit_id = $2::uuid)) AS upcoming_reservations,
        (SELECT count(*)::int FROM communications WHERE community_id = $1 AND status IN ('published','scheduled') AND archived_at IS NULL) AS published_notices`,
      [context.current.communityId, unitId, resident, context.user.id]
    );
    const s = stats.rows[0];

    const meeting = await client.query<{ title: string; event_at: Date; event_time_precision: "day" | "minute" | "second"; location: string | null }>(
      `SELECT title, event_at, event_time_precision, location FROM meetings WHERE community_id = $1 AND event_at >= now()
        AND status IN ('draft','called','in_progress') AND archived_at IS NULL ORDER BY event_at LIMIT 1`,
      [context.current.communityId]
    );
    const notice = await client.query<{ title: string; description: string | null; priority: string | null; event_at: Date | null; event_time_precision: "day" | "minute" | "second" | null }>(
      `SELECT title, description, priority, event_at, event_time_precision FROM communications WHERE community_id = $1
        AND status IN ('published','scheduled') AND archived_at IS NULL AND (due_at IS NULL OR due_at >= now())
        ORDER BY CASE priority WHEN 'urgent' THEN 1 WHEN 'high' THEN 2 ELSE 3 END, event_at DESC NULLS LAST LIMIT 1`,
      [context.current.communityId]
    );

    const recent = resident
      ? await client.query<{ id: string; module: string; title: string; status: string; updated_at: Date }>(
        `SELECT * FROM (
           SELECT id::text, 'incidencias'::text AS module, title, status, updated_at
             FROM tickets
            WHERE community_id=$1 AND archived_at IS NULL AND (created_by=$2 OR private_unit_id=$3::uuid)
           UNION ALL
           SELECT id::text, 'avisos', title, status, updated_at
             FROM communications
            WHERE community_id=$1 AND archived_at IS NULL AND status IN ('published','scheduled')
           UNION ALL
           SELECT id::text, 'documentos', title, status, updated_at
             FROM documents
            WHERE community_id=$1 AND archived_at IS NULL AND status='current'
              AND (private_unit_id=$3::uuid OR (private_unit_id IS NULL AND (
                COALESCE(data->>'audience','community') IN ('community','residents')
                OR ($4::boolean=true AND COALESCE(data->>'audience','community')='owners')
              )))
         ) activity ORDER BY updated_at DESC LIMIT 6`,
        [context.current.communityId, context.user.id, unitId, context.current.role === "owner"]
      )
      : await client.query<{ id: string; module: string; title: string; status: string; updated_at: Date }>(
        `SELECT * FROM (
           SELECT id::text, 'incidencias'::text AS module, title, status, updated_at FROM tickets WHERE community_id=$1 AND archived_at IS NULL
           UNION ALL SELECT id::text, 'avisos', title, status, updated_at FROM communications WHERE community_id=$1 AND archived_at IS NULL
           UNION ALL SELECT id::text, 'juntas', title, status, updated_at FROM meetings WHERE community_id=$1 AND archived_at IS NULL
           UNION ALL SELECT id::text, 'economia', title, status, updated_at FROM financial_records WHERE community_id=$1 AND archived_at IS NULL
         ) activity ORDER BY updated_at DESC LIMIT 6`,
        [context.current.communityId]
      );

    let metrics: DashboardMetric[];
    if (context.current.role === "treasurer") {
      metrics = [
        { label: "Saldo pendiente", value: euros.format(Number(s.pending_balance) / 100), detail: "Cuotas por cobrar", href: "/economia", tone: "purple", icon: "wallet" },
        { label: "Sin conciliar", value: String(s.unmatched_bank), detail: "Movimientos bancarios", href: "/bancos", tone: "orange", icon: "landmark" },
        { label: "Por revisar", value: String(s.pending_approvals), detail: "Expedientes económicos", href: "/aprobaciones", tone: "blue", icon: "badge-check" },
        { label: "Archivo vigente", value: String(s.current_documents), detail: "Documentos económicos", href: "/documentos", tone: "green", icon: "files" }
      ];
    } else if (context.current.role === "secretary") {
      metrics = [
        { label: "Próxima Junta", value: meeting.rowCount ? formatCalendarDate(meeting.rows[0].event_at,{locale:context.current.locale,timeZone:context.current.timeZone,dateFormat:context.current.dateFormat,timeFormat:context.current.timeFormat}) : "—", detail: meeting.rows[0]?.title ?? "Sin convocatoria", href: "/juntas", tone: "purple", icon: "vote" },
        { label: "Avisos activos", value: String(s.published_notices), detail: "Comunicaciones visibles", href: "/avisos", tone: "blue", icon: "megaphone" },
        { label: "Ocupaciones", value: String(s.pending_occupants), detail: "Pendientes de comprobar", href: "/viviendas", tone: "orange", icon: "users" },
        { label: "Documentos", value: String(s.current_documents), detail: "Archivo institucional", href: "/documentos", tone: "green", icon: "files" }
      ];
    } else if (resident) {
      metrics = [
        ...(context.current.role === "owner" ? [{ label: "Tus recibos", value: euros.format(Number(s.pending_balance) / 100), detail: "Pendiente de tu vivienda", href: "/economia", tone: "purple" as const, icon: "wallet" }] : []),
        { label: "Incidencias", value: String(s.open_tickets), detail: "Abiertas o en seguimiento", href: "/incidencias", tone: "orange", icon: "wrench" },
        { label: "Próxima reserva", value: String(s.upcoming_reservations), detail: "Servicios reservados", href: "/reservas", tone: "blue", icon: "calendar-check" },
        { label: "Documentos", value: String(s.current_documents), detail: "Disponibles para ti", href: "/documentos", tone: "green", icon: "files" }
      ];
    } else {
      metrics = [
        { label: "Saldo pendiente", value: euros.format(Number(s.pending_balance) / 100), detail: "Cuotas emitidas o devueltas", href: "/economia", tone: "purple", icon: "wallet" },
        { label: "Incidencias abiertas", value: String(s.open_tickets), detail: "Operativa en seguimiento", href: "/incidencias", tone: "orange", icon: "wrench" },
        { label: "Por decidir", value: String(s.pending_approvals), detail: "Expedientes pendientes", href: "/aprobaciones", tone: "blue", icon: "badge-check" },
        { label: "Ocupaciones pendientes", value: String(s.pending_occupants), detail: "Declaraciones por validar", href: "/viviendas", tone: "green", icon: "users" }
      ];
    }

    const homeRow = ownUnits?.rows[0];
    return {
      profile: profileFor(context),
      metrics,
      pendingBalanceCents: Number(s.pending_balance),
      nextMeeting: meeting.rowCount ? { title: meeting.rows[0].title, eventDate: meeting.rows[0].event_at.toISOString(), eventTimePrecision: meeting.rows[0].event_time_precision, location: meeting.rows[0].location } : null,
      importantNotice: notice.rowCount ? { title: notice.rows[0].title, description: notice.rows[0].description, priority: notice.rows[0].priority, eventDate: notice.rows[0].event_at?.toISOString() ?? null, eventTimePrecision: notice.rows[0].event_time_precision } : null,
      recent: recent.rows.map((item) => ({ id: item.id, module: item.module, title: item.title, status: item.status, updatedAt: item.updated_at.toISOString() })),
      home: homeRow ? { id: homeRow.id, code: homeRow.code, relation: homeRow.relation_type, occupancyStatus: homeRow.status, people: homeRow.people } : null,
      attention: [
        ...(s.pending_occupants > 0 && !resident ? [{ label: `${s.pending_occupants} ocupaciones por validar`, detail: "Comprueba quién reside en cada vivienda", href: "/viviendas", icon: "users", tone: "orange" }] : []),
        ...(s.unmatched_bank > 0 && ["treasurer", "administrator"].includes(context.current.role) ? [{ label: `${s.unmatched_bank} movimientos sin conciliar`, detail: "Necesitan vinculación contable", href: "/bancos", icon: "landmark", tone: "purple" }] : [])
      ]
    };
  });
}
