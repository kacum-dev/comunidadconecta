"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import styles from "./GuidedFlows.module.css";
import { formatBusinessMoment, formatDateTime, temporalZoneNote } from "@/lib/temporal";
import { useTemporalPreferences } from "./TemporalContext";

interface Ticket { id: string; code: string|null; title: string; description: string; status: string; priority: string; location: string|null; contact: string|null; assigned_to: string|null; event_at: string|null; event_time_precision: "day"|"minute"|"second"|null; due_at: string|null; due_time_precision: "day"|"minute"|"second"|null; due_inclusive: boolean }
interface WorkOrder { id: string; ticket_id: string; title: string; status: string; supplier_name: string|null; scheduled_at: string|null; scheduled_time_precision: "day"|"minute"|"second"|null }
interface TicketUpdate { id: string; ticket_id: string; kind: string; message: string; author: string|null; created_at: string }
interface TicketAttachment { id: string; ticket_id: string; document_id: string; original_name: string; mime_type: string; size_bytes: number; caption: string|null; author: string|null; created_at: string }
interface OperationsData { tickets: Ticket[]; orders: WorkOrder[]; updates: TicketUpdate[]; attachments: TicketAttachment[] }
type DetailTab = "summary"|"evidence"|"orders"|"timeline";

const status: Record<string, string> = { received: "Recibida", triage: "En clasificación", assigned: "Asignada", scheduled: "Programada", in_progress: "En curso", blocked: "Bloqueada", resolved: "Resuelta", validated: "Validada", closed: "Cerrada" };
const priority: Record<string, string> = { urgent: "Urgente", high: "Alta", normal: "Normal", low: "Baja" };
const next: Record<string, string[]> = { received: ["triage"], triage: ["assigned", "blocked"], assigned: ["scheduled", "in_progress", "blocked"], scheduled: ["in_progress", "blocked"], in_progress: ["resolved", "blocked"], blocked: ["assigned", "scheduled", "in_progress"], resolved: ["validated", "in_progress"], validated: ["closed", "in_progress"], closed: [] };

export function OperationsWorkspace({ canWrite, canAddEvidence }: { canWrite: boolean; canAddEvidence: boolean }) {
  const preferences = useTemporalPreferences();
  const [data, setData] = useState<OperationsData|null>(null);
  const [selected, setSelected] = useState("");
  const [tab, setTab] = useState<DetailTab>("summary");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [priorityFilter, setPriorityFilter] = useState("");
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [workOpen, setWorkOpen] = useState(false);
  const [evidenceOpen, setEvidenceOpen] = useState(false);
  const [evidenceFile, setEvidenceFile] = useState<File|null>(null);
  const [evidenceCaption, setEvidenceCaption] = useState("");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [scheduledDate, setScheduledDate] = useState("");
  const [cost, setCost] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/operations/dashboard", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "No se pudo cargar."); }
  }, []);
  useEffect(() => { const timeout = setTimeout(() => void load(), 0); return () => clearTimeout(timeout); }, [load]);
  useEffect(() => { if (!message) return; const timeout = setTimeout(() => setMessage(""), 4500); return () => clearTimeout(timeout); }, [message]);

  const ticket = useMemo(() => data?.tickets.find((item) => item.id === selected), [data, selected]);
  const orders = data?.orders.filter((item) => item.ticket_id === selected) ?? [];
  const updates = data?.updates.filter((item) => item.ticket_id === selected) ?? [];
  const attachments = data?.attachments.filter((item) => item.ticket_id === selected) ?? [];
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return (data?.tickets ?? []).filter((item) =>
      (!term || [item.code, item.title, item.description, item.location, item.contact, item.assigned_to].some((value) => value?.toLocaleLowerCase("es").includes(term))) &&
      (!statusFilter || item.status === statusFilter) && (!priorityFilter || item.priority === priorityFilter)
    );
  }, [data, priorityFilter, search, statusFilter]);

  function openTicket(id: string) { setSelected(id); setTab("summary"); setError(""); }
  function closeTicket() { if (!busy) { setSelected(""); setTab("summary"); } }

  async function act(url: string, body: unknown, success: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(success); await load();
    } catch (actionError) { setError(actionError instanceof Error ? actionError.message : "No se pudo completar."); }
    finally { setBusy(false); }
  }

  async function uploadEvidence(event: FormEvent) {
    event.preventDefault();
    if (!ticket || !evidenceFile) return;
    setBusy(true); setError("");
    try {
      const payload = new FormData(); payload.set("file", evidenceFile); payload.set("caption", evidenceCaption);
      const response = await fetch(`/api/operations/tickets/${ticket.id}/attachments`, { method: "POST", body: payload });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setEvidenceOpen(false); setEvidenceFile(null); setEvidenceCaption(""); setTab("evidence");
      setMessage("La evidencia se ha añadido a la incidencia."); await load();
    } catch (uploadError) { setError(uploadError instanceof Error ? uploadError.message : "No se pudo subir el archivo."); }
    finally { setBusy(false); }
  }

  if (!data) return <div className="page"><div className="finance-loading"><span className="spinner" /> Cargando incidencias…</div></div>;
  return <div className="page operations-workspace">
    <div className="module-breadcrumb"><Link href="/inicio">← Inicio</Link><span>/</span><span>Operaciones</span></div>
    <header className="page-heading operations-heading"><div><span className="eyebrow">MANTENIMIENTO CONECTADO</span><h1>Incidencias</h1><p>Consulta el estado, las evidencias y cada actuación sin perder el contexto.</p></div><div className="heading-actions"><Link className="button button-primary" href="/incidencias?view=records&new=1"><Icon name="plus" size={18} /> Nueva incidencia</Link></div></header>
    {error && !selected && <div className="form-alert" role="alert">{error}</div>}

    <section className="operations-table-card">
      <header className="operations-toolbar"><div><strong>Registro de incidencias</strong><small>{filtered.length} de {data.tickets.length} incidencias</small></div><div className="operations-filters"><label><Icon name="search" size={17} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar referencia, asunto o ubicación…" aria-label="Buscar incidencias" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por estado"><option value="">Todos los estados</option>{Object.entries(status).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select><select value={priorityFilter} onChange={(event) => setPriorityFilter(event.target.value)} aria-label="Filtrar por prioridad"><option value="">Todas las prioridades</option>{Object.entries(priority).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div></header>
      <div className="operations-table-wrap"><table className="operations-table"><caption className="sr-only">Listado de incidencias de la comunidad</caption><thead><tr><th>Incidencia</th><th>Ubicación</th><th>Comunicada</th><th>Prioridad</th><th>Estado</th><th>Responsable</th><th>Actividad</th><th><span className="sr-only">Abrir</span></th></tr></thead><tbody>{filtered.map((item) => { const itemOrders = data.orders.filter((order) => order.ticket_id === item.id).length; const itemFiles = data.attachments.filter((file) => file.ticket_id === item.id).length; return <tr key={item.id} onClick={() => openTicket(item.id)}><td><span className={`operations-ticket-mark ${item.priority}`}><Icon name="wrench" size={18} /></span><span><strong>{item.title}</strong><small>{item.code || "Sin referencia"}</small></span></td><td>{item.location || "Sin ubicación"}</td><td>{item.event_at ? formatBusinessMoment(item.event_at, item.event_time_precision, preferences) : "No registrada"}</td><td><span className={`operations-priority ${item.priority}`}>{priority[item.priority] || item.priority}</span></td><td><span className={`finance-status status-${item.status}`}>{status[item.status] || item.status}</span></td><td>{item.assigned_to || "Sin asignar"}</td><td><span className="operations-activity"><span><Icon name="files" size={14} /> {itemFiles}</span><span><Icon name="wrench" size={14} /> {itemOrders}</span></span></td><td><button className="icon-button" type="button" aria-label={`Abrir ${item.title}`}><Icon name="more" size={18} /></button></td></tr>; })}</tbody></table></div>
      <div className="operations-mobile-list">{filtered.map((item) => <button type="button" key={item.id} onClick={() => openTicket(item.id)}><header><span className={`operations-ticket-mark ${item.priority}`}><Icon name="wrench" size={18} /></span><span className={`finance-status status-${item.status}`}>{status[item.status] || item.status}</span></header><strong>{item.title}</strong><small>{item.code || "Sin referencia"} · {item.location || "Sin ubicación"}</small><footer><span>{item.event_at ? formatBusinessMoment(item.event_at, item.event_time_precision, preferences) : "Fecha no registrada"}</span><b>Ver detalle →</b></footer></button>)}</div>
      {!filtered.length && <div className="operations-empty"><Icon name="search" size={24} /><strong>No hay incidencias con estos filtros</strong><button type="button" onClick={() => { setSearch(""); setStatusFilter(""); setPriorityFilter(""); }}>Limpiar filtros</button></div>}
    </section>

    {ticket && <div className="modal-backdrop operations-detail-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) closeTicket(); }}><section className="record-dialog operations-detail-dialog" role="dialog" aria-modal="true" aria-labelledby="operations-detail-title"><header className="dialog-header operations-detail-header"><div><span className="eyebrow">{ticket.code || "INCIDENCIA"}</span><h2 id="operations-detail-title">{ticket.title}</h2><p>{ticket.location || "Sin ubicación"} · {status[ticket.status] || ticket.status}</p></div><div>{canWrite && <button className="button button-primary" onClick={() => { setTitle(`Intervención · ${ticket.title}`); setDescription(ticket.description); setWorkOpen(true); }}><Icon name="wrench" size={16} /> Crear orden</button>}<button className="icon-button" type="button" onClick={closeTicket} disabled={busy} aria-label="Cerrar"><Icon name="close" /></button></div></header>
      <nav className="operations-detail-tabs" aria-label="Secciones de la incidencia">{([{ id: "summary", label: "Resumen", icon: "info", count: null }, { id: "evidence", label: "Evidencias", icon: "files", count: attachments.length }, { id: "orders", label: "Órdenes de trabajo", icon: "wrench", count: orders.length }, { id: "timeline", label: "Seguimiento", icon: "activity", count: updates.length }] as const).map((item) => <button type="button" className={tab === item.id ? "active" : ""} onClick={() => setTab(item.id)} key={item.id}><Icon name={item.icon} size={17} /><span>{item.label}</span>{item.count !== null && <b>{item.count}</b>}</button>)}</nav>
      <div className="dialog-scroll operations-detail-content">
        {error && <div className="form-alert" role="alert">{error}</div>}
        {tab === "summary" && <section className="operations-summary-tab"><div className="operations-case-hero"><div><span className={`operations-priority ${ticket.priority}`}>{priority[ticket.priority] || ticket.priority}</span><span className={`finance-status status-${ticket.status}`}>{status[ticket.status] || ticket.status}</span></div><h3>{ticket.description}</h3><p>{ticket.event_at ? `Comunicada el ${formatBusinessMoment(ticket.event_at, ticket.event_time_precision, preferences)}` : "Fecha de comunicación no registrada"} · {temporalZoneNote(preferences)}</p></div><div className="operations-facts"><div><small>Ubicación</small><strong>{ticket.location || "No indicada"}</strong></div><div><small>Comunicada por</small><strong>{ticket.contact || "No registrado"}</strong></div><div><small>Responsable</small><strong>{ticket.assigned_to || "Sin asignar"}</strong></div><div><small>Vencimiento objetivo</small><strong>{ticket.due_at ? formatBusinessMoment(ticket.due_at, ticket.due_time_precision, preferences, { deadline: true, inclusive: ticket.due_inclusive }) : "Sin fecha objetivo"}</strong></div></div><section className="ticket-actions"><strong>Siguiente paso</strong>{canWrite ? (next[ticket.status] || []).map((value) => <button disabled={busy} onClick={() => void act(`/api/operations/tickets/${ticket.id}/transition`, { status: value }, "Estado actualizado y residente avisado.")} key={value}>{status[value]}</button>) : <span>Consulta el seguimiento de tu solicitud.</span>}</section></section>}
        {tab === "evidence" && <section className={styles.evidenceBlock} aria-labelledby="evidence-title"><div className={styles.evidenceHeader}><div><strong id="evidence-title">Fotos y archivos</strong><small>{attachments.length ? `${attachments.length} evidencias adjuntas` : "Añade fotos, presupuestos o partes"}</small></div>{canAddEvidence && <button className="button button-secondary" onClick={() => setEvidenceOpen(true)}><Icon name="upload" size={17} /> Añadir evidencia</button>}</div>{attachments.length > 0 ? <div className={styles.evidenceList}>{attachments.map((attachment) => <a className={styles.evidenceItem} href={`/api/documents/${attachment.document_id}/download`} key={attachment.id}><Icon name={attachment.mime_type.startsWith("image/") ? "files" : "download"} size={19} /><span><strong>{attachment.caption || attachment.original_name}</strong><small>{attachment.original_name} · {Math.max(1, Math.round(attachment.size_bytes / 1024))} KB · Añadida el {formatDateTime(attachment.created_at, preferences)}</small></span><Icon name="download" size={17} /></a>)}</div> : <p className={styles.emptyEvidence}>Todavía no hay evidencias. Una foto suele ayudar a resolver la incidencia antes.</p>}</section>}
        {tab === "orders" && <section className="work-orders operations-tab-section"><header><div><h3>Órdenes de trabajo</h3><p>Intervenciones, proveedor y fecha prevista.</p></div>{canWrite && <button className="button button-secondary" onClick={() => { setTitle(`Intervención · ${ticket.title}`); setDescription(ticket.description); setWorkOpen(true); }}><Icon name="plus" size={16} /> Nueva orden</button>}</header>{orders.length ? orders.map((order) => <article key={order.id}><Icon name="wrench" size={18} /><span><strong>{order.title}</strong><small>{order.supplier_name || "Proveedor pendiente"}{order.scheduled_at ? ` · Intervención: ${formatBusinessMoment(order.scheduled_at, order.scheduled_time_precision, preferences)}` : " · Sin fecha programada"}</small></span><b>{order.status}</b></article>) : <p className="operations-tab-empty">Aún no hay intervenciones programadas.</p>}</section>}
        {tab === "timeline" && <section className="ticket-timeline operations-tab-section"><header><div><h3>Seguimiento</h3><p>Cambios registrados con fecha, hora y autor.</p></div></header>{updates.length ? updates.map((update) => <article key={update.id}><span /><div><strong>{update.author || "Sistema"} · {update.kind}</strong><p>{update.message}</p><small>Registrado el {formatDateTime(update.created_at, preferences)} · {preferences.timeZone}</small></div></article>) : <p className="operations-tab-empty">Aún no hay movimientos registrados.</p>}</section>}
      </div><footer className="dialog-footer"><span><Icon name="shield-check" size={15} /> Toda actuación queda trazada en la incidencia.</span><div className="dialog-footer-actions"><button className="button button-secondary" onClick={closeTicket}>Cerrar</button></div></footer></section></div>}

    {evidenceOpen && ticket && <div className="modal-backdrop operations-subdialog"><section className="record-dialog" role="dialog" aria-modal="true" aria-labelledby="evidence-dialog-title"><header className="dialog-header"><div><span className="eyebrow">EVIDENCIA</span><h2 id="evidence-dialog-title">Añadir foto o archivo</h2><p>Quedará vinculado a la incidencia y protegido por los permisos de la comunidad.</p></div><button className="icon-button" onClick={() => setEvidenceOpen(false)} disabled={busy} aria-label="Cerrar"><Icon name="close" /></button></header><form className="dialog-form" onSubmit={uploadEvidence}><div className={`dialog-scroll ${styles.evidenceUpload}`}><label className={styles.dropzone}><Icon name="upload" size={32} /><strong>{evidenceFile?.name || "Pulsa para elegir una foto o archivo"}</strong><small>JPG, PNG, PDF, Word, Excel o texto · máximo 10 MB</small><input type="file" required accept=".jpg,.jpeg,.png,.pdf,.docx,.xlsx,.csv,.txt,image/jpeg,image/png,application/pdf" onChange={(event) => setEvidenceFile(event.target.files?.[0] ?? null)} /></label><label className="field-group">¿Qué muestra?<input value={evidenceCaption} onChange={(event) => setEvidenceCaption(event.target.value)} maxLength={300} placeholder="Ej. Humedad junto a la ventana" /></label></div><footer className="dialog-footer"><span>El archivo conserva su huella SHA-256.</span><div className="dialog-footer-actions"><button type="button" className="button button-secondary" onClick={() => setEvidenceOpen(false)} disabled={busy}>Cancelar</button><button className="button button-primary" disabled={busy || !evidenceFile}>{busy ? "Subiendo…" : "Añadir a la incidencia"}</button></div></footer></form></section></div>}

    {workOpen && ticket && <div className="modal-backdrop operations-subdialog"><section className="record-dialog"><header className="dialog-header"><div><span className="eyebrow">ORDEN DE TRABAJO</span><h2>Programar intervención</h2></div><button className="icon-button" onClick={() => setWorkOpen(false)}><Icon name="close" /></button></header><div className="dialog-scroll form-grid"><label className="field-group field-wide">Título<input value={title} onChange={(event) => setTitle(event.target.value)} /></label><label className="field-group field-wide">Trabajo a realizar<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} /></label><label className="field-group">Fecha y hora prevista<input type="datetime-local" step="1" value={scheduledDate} onChange={(event) => setScheduledDate(event.target.value)} /><small className="field-hint">{temporalZoneNote(preferences)}.</small></label><label className="field-group">Coste estimado<input type="number" step=".01" min="0" value={cost} onChange={(event) => setCost(event.target.value)} /></label></div><footer className="dialog-footer"><span /><div className="dialog-footer-actions"><button className="button button-secondary" onClick={() => setWorkOpen(false)}>Cancelar</button><button className="button button-primary" disabled={busy} onClick={async () => { await act(`/api/operations/tickets/${ticket.id}/work-orders`, { title, description, scheduledDate, estimatedCost: Number(cost) || undefined }, "Orden programada y residente avisado."); setWorkOpen(false); setTab("orders"); }}>Crear orden</button></div></footer></section></div>}
    {message && <div className="toast" role="status"><Icon name="badge-check" size={18} />{message}</div>}
  </div>;
}
