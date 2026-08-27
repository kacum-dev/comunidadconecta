"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { formatDateTime, temporalZoneNote, zonedLocalDateTimeToIso } from "@/lib/temporal";
import { useTemporalPreferences } from "./TemporalContext";

interface Resource { id: string; name: string; kind: string; location: string | null; capacity: number; opening_time: string; closing_time: string; slot_minutes: number; requires_approval: boolean; deposit_cents: string; rules: string | null; status: string }
interface Booking { id: string; resource_id: string; resource_name: string; cancellation_hours: number; title: string; attendees: number; starts_at: string; ends_at: string; status: string; deposit_status: string; own: boolean; decision_note: string | null }
interface Dashboard { resources: Resource[]; bookings: Booking[]; blackouts: Array<{ id: string; resource_id: string; starts_at: string; ends_at: string; reason: string }>; canManage: boolean }

const labels: Record<string, string> = { requested: "Pendiente", confirmed: "Confirmada", rejected: "Rechazada", cancelled: "Cancelada", completed: "Finalizada", maintenance: "Mantenimiento" };
const kinds: Record<string, string> = { community_room: "Sala comunitaria", pool: "Piscina", sports: "Pista deportiva", moving: "Mudanzas", barbecue: "Barbacoa", parking: "Aparcamiento", other: "Otro" };
const euros = (cents: string) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(cents) / 100);

export function ReservationWorkspace({ canWrite }: { canWrite: boolean }) {
  const preferences = useTemporalPreferences();
  const [data, setData] = useState<Dashboard | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [bookingOpen, setBookingOpen] = useState(false);
  const [resourceOpen, setResourceOpen] = useState(false);
  const [resourceId, setResourceId] = useState("");
  const [title, setTitle] = useState("");
  const [attendees, setAttendees] = useState("1");
  const [startsAt, setStartsAt] = useState("");
  const [endsAt, setEndsAt] = useState("");
  const [name, setName] = useState("");
  const [kind, setKind] = useState("community_room");
  const [location, setLocation] = useState("");
  const [capacity, setCapacity] = useState("10");
  const [openingTime, setOpeningTime] = useState("08:00");
  const [closingTime, setClosingTime] = useState("22:00");
  const [slotMinutes, setSlotMinutes] = useState("60");
  const [requiresApproval, setRequiresApproval] = useState(false);
  const [depositEuros, setDepositEuros] = useState("0");
  const [rules, setRules] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/reservations/dashboard", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result);
      if (!resourceId && result.resources[0]) setResourceId(result.resources[0].id);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudieron cargar las reservas.");
    }
  }, [resourceId]);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function act(url: string, body: unknown | undefined, success: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(success);
      window.setTimeout(() => setMessage(""), 3200);
      await load();
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la operación.");
      return false;
    } finally { setBusy(false); }
  }

  const activeResources = useMemo(() => data?.resources.filter((resource) => resource.status === "active") || [], [data]);
  const upcoming = useMemo(() => data?.bookings.filter((booking) => !["cancelled", "rejected"].includes(booking.status)) || [], [data]);
  if (!data) return <div className="page"><div className="finance-loading"><span className="spinner" /> Cargando disponibilidad…</div></div>;

  return <div className="page reservation-workspace">
    <div className="module-breadcrumb"><Link href="/inicio">← Inicio</Link><span>/</span><span>Servicios</span></div>
    <header className="page-heading">
      <div><span className="eyebrow">ESPACIOS COMUNES</span><h1>Reservas</h1><p>Espacios disponibles y próximas reservas. {temporalZoneNote(preferences)}.</p></div>
      <div className="heading-actions">
        <Link className="button button-secondary reservation-history-link" href="/reservas?view=records" title="Histórico"><Icon name="calendar-check" size={18} /><span>Histórico</span></Link>
        {data.canManage && <button className="button button-secondary" onClick={() => setResourceOpen(true)}><Icon name="settings" size={18} /> <span>Recursos</span></button>}
        {canWrite && activeResources.length > 0 && <button className="button button-primary" onClick={() => setBookingOpen(true)}><Icon name="plus" size={18} /> Reservar</button>}
      </div>
    </header>
    {error && <div className="form-alert" role="alert">{error}</div>}
    {!activeResources.length && <section className="reservation-empty-state">
      <span><Icon name="calendar-check" size={25} /></span>
      <div><h2>No hay espacios disponibles</h2><p>Cuando la comunidad active un espacio, podrás reservarlo aquí.</p></div>
      {data.canManage && <button className="button button-primary" onClick={() => setResourceOpen(true)}><Icon name="plus" size={18} /> Añadir recurso</button>}
    </section>}
    {activeResources.length > 0 && <section className="reservation-metrics">
      <article><Icon name="building" size={20} /><span>Espacios</span><strong>{activeResources.length}</strong></article>
      <article><Icon name="calendar-check" size={20} /><span>Próximas</span><strong>{upcoming.length}</strong></article>
      <article><Icon name="approval" size={20} /><span>Pendientes</span><strong>{data.bookings.filter((booking) => booking.status === "requested").length}</strong></article>
    </section>}
    {activeResources.length > 0 && <div className="reservation-layout">
      <section className="reservation-panel reservation-calendar">
        <header><div><span className="eyebrow">PRÓXIMOS 30 DÍAS</span><h2>Agenda</h2></div></header>
        {data.bookings.length === 0 && <div className="compact-empty"><strong>Aún no hay reservas</strong><p>La primera reserva aparecerá aquí con su estado y franja horaria.</p></div>}
        {data.bookings.map((booking) => <article key={booking.id}>
          <time dateTime={booking.starts_at}><strong>Inicio</strong><span>{formatDateTime(booking.starts_at,preferences)}</span></time>
          <div><strong>{booking.title}</strong><span>{booking.resource_name} · {booking.attendees} asistentes</span><small>Inicio incluido: {formatDateTime(booking.starts_at,preferences)} · Fin excluido: {formatDateTime(booking.ends_at,preferences)} · Cancelable hasta (incluido): {formatDateTime(new Date(new Date(booking.starts_at).getTime()-booking.cancellation_hours*3_600_000),preferences)}</small></div>
          <div className="reservation-actions"><b className={"finance-status status-" + booking.status}>{labels[booking.status]}</b>
            {data.canManage && booking.status === "requested" && <><button onClick={() => void act("/api/reservations/bookings/" + booking.id + "/decision", { decision: "confirmed" }, "Reserva aprobada.")}>Aprobar</button><button onClick={() => void act("/api/reservations/bookings/" + booking.id + "/decision", { decision: "rejected" }, "Reserva rechazada.")}>Rechazar</button></>}
            {(booking.own || data.canManage) && ["requested", "confirmed"].includes(booking.status) && <button onClick={() => void act("/api/reservations/bookings/" + booking.id + "/cancel", undefined, "Reserva cancelada.")}>Cancelar</button>}
          </div>
        </article>)}
      </section>
      <aside className="reservation-panel reservation-resources">
        <header><div><span className="eyebrow">REGLAS VISIBLES</span><h2>Recursos</h2></div></header>
        {data.resources.map((resource) => <article key={resource.id}>
          <div><Icon name="calendar-check" size={19} /><div><strong>{resource.name}</strong><span>{kinds[resource.kind]}{resource.location ? " · " + resource.location : ""}</span></div></div>
          <dl><div><dt>Horario</dt><dd>{resource.opening_time.slice(0, 5)}–{resource.closing_time.slice(0, 5)}</dd></div><div><dt>Aforo</dt><dd>{resource.capacity}</dd></div><div><dt>Bloques</dt><dd>{resource.slot_minutes} min</dd></div><div><dt>Depósito</dt><dd>{Number(resource.deposit_cents) ? euros(resource.deposit_cents) : "No"}</dd></div></dl>
          {resource.requires_approval && <span className="section-chip">Requiere aprobación</span>}{resource.rules && <p>{resource.rules}</p>}
        </article>)}
      </aside>
    </div>}

    {bookingOpen && <div className="modal-backdrop"><section className="record-dialog" role="dialog" aria-modal="true" aria-labelledby="booking-title">
      <header className="dialog-header"><div><span className="eyebrow">COMPROBACIÓN EN TIEMPO REAL</span><h2 id="booking-title">Nueva reserva</h2></div><button className="icon-button" aria-label="Cerrar" onClick={() => setBookingOpen(false)}><Icon name="close" /></button></header>
      <div className="dialog-scroll form-grid">
        <label className="field-group">Recurso<select value={resourceId} onChange={(event) => setResourceId(event.target.value)}>{data.resources.filter((resource) => resource.status === "active").map((resource) => <option value={resource.id} key={resource.id}>{resource.name}</option>)}</select></label>
        <label className="field-group">Motivo<input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Reunión, mudanza…" /></label>
        <label className="field-group">Inicio (incluido)<input type="datetime-local" step="1" value={startsAt} onChange={(event) => setStartsAt(event.target.value)} /><small className="field-hint">{temporalZoneNote(preferences)}.</small></label>
        <label className="field-group">Fin (excluido)<input type="datetime-local" step="1" value={endsAt} onChange={(event) => setEndsAt(event.target.value)} /><small className="field-hint">La reserva deja de ocupar el espacio exactamente en este instante.</small></label>
        <label className="field-group">Asistentes<input type="number" min="1" value={attendees} onChange={(event) => setAttendees(event.target.value)} /></label>
      </div>
      <footer className="dialog-footer"><span>{temporalZoneNote(preferences)}.</span><div className="dialog-footer-actions"><button className="button button-secondary" onClick={() => setBookingOpen(false)}>Cancelar</button><button className="button button-primary" disabled={busy || title.trim().length < 2 || !startsAt || !endsAt} onClick={async () => { if (await act("/api/reservations/bookings", { resourceId, title, attendees: Number(attendees), startsAt: zonedLocalDateTimeToIso(startsAt,preferences.timeZone), endsAt: zonedLocalDateTimeToIso(endsAt,preferences.timeZone) }, "Reserva registrada.")) { setBookingOpen(false); setTitle(""); setStartsAt(""); setEndsAt(""); } }}>Comprobar y reservar</button></div></footer>
    </section></div>}

    {resourceOpen && data.canManage && <div className="modal-backdrop"><section className="record-dialog" role="dialog" aria-modal="true" aria-labelledby="resource-title">
      <header className="dialog-header"><div><span className="eyebrow">REGLAS DEL RECURSO</span><h2 id="resource-title">Nuevo recurso</h2></div><button className="icon-button" aria-label="Cerrar" onClick={() => setResourceOpen(false)}><Icon name="close" /></button></header>
      <div className="dialog-scroll form-grid">
        <label className="field-group">Nombre<input value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field-group">Tipo<select value={kind} onChange={(event) => setKind(event.target.value)}>{Object.entries(kinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="field-group">Ubicación<input value={location} onChange={(event) => setLocation(event.target.value)} /></label>
        <label className="field-group">Aforo<input type="number" min="1" value={capacity} onChange={(event) => setCapacity(event.target.value)} /></label>
        <label className="field-group">Apertura<input type="time" value={openingTime} onChange={(event) => setOpeningTime(event.target.value)} /></label>
        <label className="field-group">Cierre<input type="time" value={closingTime} onChange={(event) => setClosingTime(event.target.value)} /></label>
        <label className="field-group">Bloque (min)<input type="number" min="15" step="15" value={slotMinutes} onChange={(event) => setSlotMinutes(event.target.value)} /></label>
        <label className="field-group">Depósito (€)<input type="number" min="0" step="0.01" value={depositEuros} onChange={(event) => setDepositEuros(event.target.value)} /></label>
        <label className="check-line field-wide"><input type="checkbox" checked={requiresApproval} onChange={(event) => setRequiresApproval(event.target.checked)} /><span>Exigir aprobación antes de confirmar</span></label>
        <label className="field-group field-wide">Reglas<textarea rows={4} value={rules} onChange={(event) => setRules(event.target.value)} /></label>
      </div>
      <footer className="dialog-footer"><span /><div className="dialog-footer-actions"><button className="button button-secondary" onClick={() => setResourceOpen(false)}>Cancelar</button><button className="button button-primary" disabled={busy || name.trim().length < 2} onClick={async () => { if (await act("/api/reservations/resources", { name, kind, location, capacity: Number(capacity), openingTime, closingTime, slotMinutes: Number(slotMinutes), requiresApproval, depositEuros: Number(depositEuros), rules }, "Recurso creado.")) { setResourceOpen(false); setName(""); } }}>Crear recurso</button></div></footer>
    </section></div>}
    {message && <div className="toast" role="status">{message}</div>}
  </div>;
}
