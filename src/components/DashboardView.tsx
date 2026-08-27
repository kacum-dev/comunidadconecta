import Link from "next/link";
import type { AuthContext } from "@/lib/auth";
import type { DashboardData } from "@/lib/dashboard";
import { isResidentRole } from "@/lib/permissions";
import { formatBusinessMoment, formatDateTime, temporalZoneNote, type TemporalPreferences } from "@/lib/temporal";
import { Icon } from "./Icon";

const relationLabels: Record<string, string> = {
  owner: "Propietario/a",
  co_owner: "Copropietario/a",
  tenant: "Inquilino/a",
  authorized_resident: "Residente autorizado/a"
};

function firstName(name: string) {
  return name.split(" ")[0];
}

function activityIcon(module: string) {
  if (module === "incidencias") return "wrench";
  if (module === "juntas") return "vote";
  if (module === "avisos") return "megaphone";
  if (module === "economia") return "wallet";
  if (module === "documentos") return "files";
  return "bell";
}

function ResidentDashboard({ context, data }: { context: AuthContext; data: DashboardData }) {
  const preferences: TemporalPreferences = { locale: context.current.locale, timeZone: context.current.timeZone, dateFormat: context.current.dateFormat, timeFormat: context.current.timeFormat };
  const owner = context.current.role === "owner";
  const balance = data.metrics.find((metric) => metric.href === "/economia");
  const hasPendingBalance = owner && data.pendingBalanceCents > 0;
  const urgentNotice = data.importantNotice?.priority === "urgent";
  const needsAttention = hasPendingBalance || urgentNotice;
  const statusHref = hasPendingBalance ? "/economia" : urgentNotice ? "/avisos" : "/mi-vivienda";
  const statusLabel = hasPendingBalance ? `${balance?.value ?? "Saldo"} pendiente` : urgentNotice ? "Aviso urgente" : "Todo al día";
  const quickActions = owner
    ? [
        { href: "/economia", label: "Recibos", icon: "wallet" },
        { href: "/incidencias?new=1", label: "Incidencia", icon: "wrench", primary: true },
        { href: "/reservas?new=1", label: "Reservar", icon: "calendar-check" },
        { href: "/documentos", label: "Documentos", icon: "files" }
      ]
    : [
        { href: "/incidencias?new=1", label: "Incidencia", icon: "wrench", primary: true },
        { href: "/avisos", label: "Avisos", icon: "megaphone" },
        { href: "/reservas?new=1", label: "Reservar", icon: "calendar-check" },
        { href: "/documentos", label: "Documentos", icon: "files" }
      ];

  return (
    <div className="page resident-bank-page">
      <header className="resident-bank-welcome">
        <div>
          <span className="eyebrow">{context.current.communityName}</span>
          <h1>Hola, {firstName(context.user.fullName)}</h1>
          <p>{owner ? "Tu vivienda y tu comunidad, de un vistazo." : "Lo importante de tu comunidad, sin complicaciones."}</p>
        </div>
        <Link className="resident-profile-link" href="/mi-vivienda" aria-label="Abrir mi vivienda">
          <span><Icon name="home" size={20} /></span>
          <strong>{data.home?.code ?? "Mi vivienda"}</strong>
          <small>{data.home ? relationLabels[data.home.relation] ?? data.home.relation : "Sin vincular"}</small>
        </Link>
      </header>

      <section className={`resident-home-status-card ${needsAttention ? "needs-attention" : ""}`} aria-label="Resumen de mi vivienda">
        <Link className="resident-home-status-main" href="/mi-vivienda" aria-label={`Abrir la ficha de ${data.home?.code ?? "mi vivienda"}`}>
          <span className="resident-home-status-home-icon"><Icon name="home" size={24} /></span>
          <span>
            <small>TU VIVIENDA</small>
            <strong>{data.home?.code ?? "Pendiente de vincular"}</strong>
            <em>{data.home ? `${data.home.people} persona${data.home.people === 1 ? "" : "s"} vinculada${data.home.people === 1 ? "" : "s"} · ${statusLabel}` : "Contacta con la administración"}</em>
          </span>
        </Link>
        <Link className={`resident-home-status-indicator ${needsAttention ? "warning" : "clear"}`} href={statusHref} aria-label={needsAttention ? statusLabel : "Todo al día"} title={statusLabel}>
          <Icon name={needsAttention ? "alert-triangle" : "badge-check"} size={23} />
        </Link>
      </section>

      <section className="resident-quick-section" aria-labelledby="resident-quick-title">
        <div className="resident-section-heading">
          <div>
            <span className="eyebrow">GESTIONES</span>
            <h2 id="resident-quick-title">¿Qué necesitas?</h2>
          </div>
          <span>Elige una opción</span>
        </div>
        <div className="resident-quick-actions">
          {quickActions.map((action) => (
            <Link className={action.primary ? "primary" : ""} href={action.href} key={action.href}>
              <span><Icon name={action.icon} size={23} /></span>
              <strong>{action.label}</strong>
            </Link>
          ))}
        </div>
      </section>

      <div className="resident-bank-grid">
        <section className="resident-feed-card" aria-labelledby="resident-feed-title">
          <div className="resident-section-heading resident-feed-heading">
            <div>
              <span className="eyebrow">PARA TI</span>
              <h2 id="resident-feed-title">Comunicaciones</h2>
            </div>
            <Link href="/notificaciones">Ver todo</Link>
          </div>
          <div className="resident-feed">
            {data.importantNotice && (
              <Link className="resident-feed-row important" href="/avisos">
                <span className="resident-feed-icon"><Icon name="megaphone" size={19} /></span>
                <span>
                  <strong>{data.importantNotice.title}</strong>
                  <small>{data.importantNotice.eventDate ? `Fecha y hora del aviso: ${formatBusinessMoment(data.importantNotice.eventDate, data.importantNotice.eventTimePrecision, preferences)}` : "Aviso de la comunidad"}</small>
                </span>
                <span aria-hidden>→</span>
              </Link>
            )}
            {data.recent.slice(0, 4).map((item) => (
              <Link className="resident-feed-row" href={`/${item.module}`} key={`${item.module}-${item.id}`}>
                <span className="resident-feed-icon"><Icon name={activityIcon(item.module)} size={19} /></span>
                <span>
                  <strong>{item.title}</strong>
                  <small>Actualizado el {formatDateTime(item.updatedAt, preferences)} · {item.status.replaceAll("_", " ")}</small>
                </span>
                <span aria-hidden>→</span>
              </Link>
            ))}
            {!data.importantNotice && data.recent.length === 0 && (
              <div className="resident-feed-empty">
                <span><Icon name="badge-check" size={24} /></span>
                <strong>Todo al día</strong>
                <small>Las novedades aparecerán aquí.</small>
              </div>
            )}
          </div>
        </section>

        <aside className="resident-bank-side">
          <section className="resident-side-card">
            <span className="resident-side-icon blue"><Icon name="calendar-check" size={21} /></span>
            <span className="eyebrow">PRÓXIMA JUNTA</span>
            {data.nextMeeting ? (
              <>
                <h2>{data.nextMeeting.title}</h2>
                <p>Celebración: {formatBusinessMoment(data.nextMeeting.eventDate, data.nextMeeting.eventTimePrecision, preferences)}</p>
                <small>{data.nextMeeting.location || "Lugar pendiente"}</small>
                <Link href="/juntas">Ver convocatoria →</Link>
              </>
            ) : (
              <>
                <h2>Sin convocatorias</h2>
                <p>No hay Juntas próximas.</p>
              </>
            )}
          </section>
          <Link className="resident-side-card privacy-card" href="/ayuda-y-privacidad">
            <span className="resident-side-icon green"><Icon name="shield-check" size={21} /></span>
            <span>
              <strong>Ayuda y privacidad</strong>
              <small>Consulta tus datos, activa la lectura cómoda o solicita una corrección.</small>
            </span>
            <span aria-hidden>→</span>
          </Link>
        </aside>
      </div>
    </div>
  );
}

export function DashboardView({ context, data }: { context: AuthContext; data: DashboardData }) {
  if (isResidentRole(context.current.role)) {
    return <ResidentDashboard context={context} data={data} />;
  }
  const preferences: TemporalPreferences = { locale: context.current.locale, timeZone: context.current.timeZone, dateFormat: context.current.dateFormat, timeFormat: context.current.timeFormat };

  return (
    <div className="page dashboard-page">
      <div className="page-heading dashboard-heading">
        <div>
          <span className="eyebrow">{data.profile.eyebrow}</span>
          <h1>Hola, {firstName(context.user.fullName)}. {data.profile.title}</h1>
          <p>{data.profile.description}</p>
        </div>
        <div className="heading-actions">
          <Link className="button button-secondary" href="/viviendas"><Icon name="building" size={17} /> Viviendas</Link>
          <Link className="button button-primary" href="/incidencias?new=1"><Icon name="plus" size={18} /> Comunicar incidencia</Link>
        </div>
      </div>

      {data.importantNotice && (
        <Link href="/avisos" className={`important-banner ${data.importantNotice.priority === "urgent" ? "urgent" : ""}`}>
          <span className="banner-icon"><Icon name="megaphone" size={19} /></span>
          <span><strong>{data.importantNotice.title}</strong><small>{data.importantNotice.description}{data.importantNotice.eventDate ? ` · Fecha y hora del aviso: ${formatBusinessMoment(data.importantNotice.eventDate, data.importantNotice.eventTimePrecision, preferences)}` : ""}</small></span>
          <span className="banner-link">Ver aviso →</span>
        </Link>
      )}

      {data.attention.length > 0 && (
        <section className="attention-strip" aria-label="Asuntos que requieren atención">
          {data.attention.map((item) => (
            <Link href={item.href} key={item.href}>
              <span className={`attention-icon ${item.tone}`}><Icon name={item.icon} /></span>
              <span><strong>{item.label}</strong><small>{item.detail}</small></span>
              <b>Resolver →</b>
            </Link>
          ))}
        </section>
      )}

      <section className={`stats-grid ${data.metrics.length === 3 ? "three-cards" : ""}`} aria-label="Indicadores de tu perfil">
        {data.metrics.map((metric) => (
          <Link href={metric.href} className={`stat-card ${metric.tone}`} key={metric.label}>
            <span className="stat-icon"><Icon name={metric.icon} /></span>
            <span className="stat-label">{metric.label}</span>
            <strong>{metric.value}</strong>
            <small>{metric.detail}</small>
          </Link>
        ))}
      </section>

      <div className="dashboard-grid">
        <section className="panel activity-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">ACTIVIDAD</span><h2>Últimos movimientos</h2></div>
            <Link href="/auditoria">Ver auditoría</Link>
          </div>
          <div className="activity-list">
            {data.recent.length ? data.recent.map((item) => (
              <Link href={`/${item.module}`} className="activity-row" key={`${item.module}-${item.id}`}>
                <span className={`activity-icon module-${item.module}`}><Icon name={activityIcon(item.module)} size={18} /></span>
                <span className="activity-copy">
                  <strong>{item.title}</strong>
                  <small>{item.module} · Actualizado el {formatDateTime(item.updatedAt, preferences)}</small>
                </span>
                <span className="status-pill neutral">{item.status.replaceAll("_", " ")}</span>
              </Link>
            )) : <p className="empty-copy">Todavía no hay actividad que mostrar.</p>}
          </div>
        </section>

        <aside className="dashboard-side">
          <section className="panel next-meeting-card">
            <div className="panel-heading">
              <div><span className="eyebrow">PRÓXIMA CITA</span><h2>Junta</h2></div>
              <span className="meeting-calendar"><Icon name="calendar-check" /></span>
            </div>
            {data.nextMeeting ? (
              <>
                <strong className="meeting-title">{data.nextMeeting.title}</strong>
                <p>Celebración: {formatBusinessMoment(data.nextMeeting.eventDate, data.nextMeeting.eventTimePrecision, preferences)}</p>
                <small>{data.nextMeeting.location || "Lugar pendiente de confirmar"} · {temporalZoneNote(preferences)}</small>
                <Link className="button button-secondary full-button" href="/juntas">Ver convocatoria</Link>
              </>
            ) : <p className="empty-copy">No hay Juntas próximas convocadas.</p>}
          </section>
          <section className="panel quick-panel">
            <span className="eyebrow">ACCESOS RÁPIDOS</span>
            <h2>¿Qué necesitas?</h2>
            <div className="quick-links">
              <Link href="/viviendas"><Icon name="building" /> Gestionar viviendas</Link>
              <Link href="/incidencias"><Icon name="wrench" /> Revisar incidencias</Link>
              <Link href="/documentos"><Icon name="files" /> Buscar un documento</Link>
              <Link href="/accesos"><Icon name="users" /> Gestionar accesos</Link>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}
