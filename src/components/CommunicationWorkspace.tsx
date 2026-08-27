"use client";

import { useCallback, useEffect, useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import styles from "./CommunicationWorkspace.module.css";

type Channel = "app" | "email" | "phone" | "whatsapp" | "in_person" | "other";
type Direction = "inbound" | "outbound" | "internal" | "system";
type ThreadStatus = "open" | "pending" | "resolved" | "closed";
type Priority = "low" | "normal" | "high" | "urgent";

interface Thread {
  id: string;
  subject: string;
  status: ThreadStatus;
  priority: Priority;
  source_channel: Channel;
  last_channel: Channel;
  participant_user_id: string | null;
  participant_name: string | null;
  participant_email: string | null;
  unit_code: string | null;
  contact_name: string | null;
  contact_address: string | null;
  assigned_name: string | null;
  related_ticket_id: string | null;
  related_ticket_code: string | null;
  related_ticket_title: string | null;
  related_ticket_status: string | null;
  last_activity_at: string;
  last_message: string | null;
}
interface Message {
  id: string;
  thread_id: string;
  direction: Direction;
  channel: Channel;
  body: string;
  sender_name: string | null;
  sender_address: string | null;
  visible_to_resident: boolean;
  delivery_status: string;
  occurred_at: string;
  author_name: string | null;
}
interface Ticket { id: string; code: string | null; title: string; status: string; location: string | null }
interface InboxData { threads: Thread[]; messages: Message[]; tickets: Ticket[]; capabilities: { resident: boolean; canManage: boolean } }

const channelLabels: Record<Channel, string> = { app: "App", email: "Correo", phone: "Teléfono", whatsapp: "WhatsApp", in_person: "Presencial", other: "Otro" };
const directionLabels: Record<Direction, string> = { inbound: "Entrante", outbound: "Saliente", internal: "Nota interna", system: "Sistema" };
const statusLabels: Record<ThreadStatus, string> = { open: "Abierta", pending: "Pendiente", resolved: "Resuelta", closed: "Cerrada" };
const priorityLabels: Record<Priority, string> = { low: "Baja", normal: "Normal", high: "Alta", urgent: "Urgente" };
const channelIcon: Record<Channel, string> = { app: "bell", email: "megaphone", phone: "activity", whatsapp: "activity", in_person: "users", other: "info" };

function formatMoment(value: string) {
  try { return new Intl.DateTimeFormat("es-ES", { day: "2-digit", month: "short", hour: "2-digit", minute: "2-digit" }).format(new Date(value)); }
  catch { return value; }
}

export function CommunicationWorkspace({ residentMode, canManage }: { residentMode: boolean; canManage: boolean }) {
  const [data, setData] = useState<InboxData | null>(null);
  const [selected, setSelected] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("");
  const [createOpen, setCreateOpen] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busy, setBusy] = useState(false);
  const [reply, setReply] = useState("");
  const [replyChannel, setReplyChannel] = useState<Channel>("app");
  const [replyDirection, setReplyDirection] = useState<Direction>(residentMode ? "inbound" : "outbound");
  const [subject, setSubject] = useState("");
  const [body, setBody] = useState("");
  const [priority, setPriority] = useState<Priority>("normal");
  const [channel, setChannel] = useState<Channel>("app");
  const [direction, setDirection] = useState<Direction>(residentMode ? "inbound" : "inbound");
  const [contactName, setContactName] = useState("");
  const [contactAddress, setContactAddress] = useState("");
  const [participantEmail, setParticipantEmail] = useState("");

  const load = useCallback(async (preferredId?: string) => {
    try {
      const response = await fetch("/api/communications/dashboard", { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo cargar la bandeja.");
      setData(result);
      setSelected((current) => preferredId || (current && result.threads.some((item: Thread) => item.id === current) ? current : result.threads[0]?.id || ""));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la bandeja.");
    }
  }, []);

  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  useEffect(() => { if (!notice) return; const timer = window.setTimeout(() => setNotice(""), 4500); return () => window.clearTimeout(timer); }, [notice]);

  const thread = data?.threads.find((item) => item.id === selected) ?? null;
  const messages = useMemo(() => (data?.messages ?? []).filter((item) => item.thread_id === selected), [data, selected]);
  const filtered = useMemo(() => {
    const term = search.trim().toLocaleLowerCase("es");
    return (data?.threads ?? []).filter((item) => {
      const haystack = [item.subject, item.participant_name, item.participant_email, item.contact_name, item.contact_address, item.unit_code, item.last_message].filter(Boolean).join(" ").toLocaleLowerCase("es");
      return (!term || haystack.includes(term)) && (!statusFilter || item.status === statusFilter);
    });
  }, [data, search, statusFilter]);

  async function post(url: string, payload: unknown, success: string, preferredId?: string) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo completar la operación.");
      setNotice(success);
      await load(preferredId || result.id || selected);
      return result;
    } catch (actionError) {
      setError(actionError instanceof Error ? actionError.message : "No se pudo completar la operación.");
      return null;
    } finally { setBusy(false); }
  }

  async function createThread(event: FormEvent) {
    event.preventDefault();
    const result = await post("/api/communications/threads", { subject, body, priority, channel: residentMode ? "app" : channel, direction: residentMode ? "inbound" : direction, contactName, contactAddress, participantEmail }, "Conversación registrada.");
    if (!result) return;
    setCreateOpen(false); setSubject(""); setBody(""); setPriority("normal"); setChannel("app"); setDirection(residentMode ? "inbound" : "inbound"); setContactName(""); setContactAddress(""); setParticipantEmail("");
  }

  async function sendReply(event: FormEvent) {
    event.preventDefault();
    if (!thread || !reply.trim()) return;
    const result = await post(`/api/communications/threads/${thread.id}/messages`, { body: reply, channel: residentMode ? "app" : replyChannel, direction: residentMode ? "inbound" : replyDirection }, residentMode ? "Mensaje enviado a la comunidad." : "Interacción añadida al historial.", thread.id);
    if (result) setReply("");
  }

  if (!data) return <div className="page"><div className="finance-loading"><span className="spinner" /> Cargando comunicaciones…</div></div>;
  const openCount = data.threads.filter((item) => item.status === "open").length;
  const pendingCount = data.threads.filter((item) => item.status === "pending").length;
  const linkedCount = data.threads.filter((item) => item.related_ticket_id).length;

  return <div className={`page ${styles.workspace}`}>
    <div className="module-breadcrumb"><Link href="/inicio">← Inicio</Link><span>/</span><span>Comunicaciones</span></div>
    <header className={`page-heading ${styles.heading}`}>
      <div><span className="eyebrow">UNA SOLA HISTORIA, MUCHOS CANALES</span><h1>Centro de comunicaciones</h1><p>La persona elige el canal. La comunidad conserva el contexto, la trazabilidad y el historial.</p></div>
      <div className="heading-actions"><Link className="button button-secondary" href="/avisos?view=records"><Icon name="megaphone" size={17} /> Avisos publicados</Link><button className="button button-primary" type="button" onClick={() => setCreateOpen(true)}><Icon name="plus" size={17} /> {residentMode ? "Nueva conversación" : "Registrar interacción"}</button></div>
    </header>

    {error && <div className="form-alert" role="alert">{error}</div>}
    {notice && <div className={styles.success} role="status">{notice}</div>}

    {!residentMode && <section className={styles.metrics} aria-label="Resumen de comunicaciones"><div><small>Abiertas</small><strong>{openCount}</strong></div><div><small>Pendientes</small><strong>{pendingCount}</strong></div><div><small>Vinculadas a incidencias</small><strong>{linkedCount}</strong></div><div><small>Total</small><strong>{data.threads.length}</strong></div></section>}

    <section className={styles.inbox}>
      <aside className={styles.sidebar}>
        <header className={styles.toolbar}><label><Icon name="search" size={16} /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar persona, asunto o vivienda…" aria-label="Buscar conversaciones" /></label><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} aria-label="Filtrar por estado"><option value="">Todos</option>{Object.entries(statusLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></header>
        <div className={styles.threadList}>{filtered.map((item) => <button type="button" className={`${styles.threadButton} ${selected === item.id ? styles.active : ""}`} key={item.id} onClick={() => setSelected(item.id)}><span className={styles.threadTop}><span className={styles.channel}><Icon name={channelIcon[item.last_channel]} size={15} /> {channelLabels[item.last_channel]}</span><time>{formatMoment(item.last_activity_at)}</time></span><strong>{item.subject}</strong><small>{item.participant_name || item.contact_name || item.participant_email || item.contact_address || "Contacto sin identificar"}{item.unit_code ? ` · ${item.unit_code}` : ""}</small><p>{item.last_message || "Sin mensajes"}</p><footer><span className={`${styles.status} ${styles[item.status]}`}>{statusLabels[item.status]}</span><span className={`${styles.priority} ${styles[item.priority]}`}>{priorityLabels[item.priority]}</span></footer></button>)}</div>
        {!filtered.length && <div className={styles.empty}><Icon name="search" size={22} /><strong>No hay conversaciones con estos filtros</strong></div>}
      </aside>

      <article className={styles.detail}>
        {!thread ? <div className={styles.emptyDetail}><Icon name="megaphone" size={30} /><h2>Todo el contexto en un solo sitio</h2><p>Selecciona una conversación o registra una nueva interacción.</p></div> : <>
          <header className={styles.detailHeader}><div><span className="eyebrow">{channelLabels[thread.source_channel]} · {statusLabels[thread.status]}</span><h2>{thread.subject}</h2><p>{thread.participant_name || thread.contact_name || "Contacto"}{thread.unit_code ? ` · ${thread.unit_code}` : ""}{thread.contact_address || thread.participant_email ? ` · ${thread.contact_address || thread.participant_email}` : ""}</p></div>{canManage && <div className={styles.statusActions}>{(["open", "pending", "resolved", "closed"] as ThreadStatus[]).map((value) => <button className={thread.status === value ? styles.selectedStatus : ""} disabled={busy || thread.status === value} key={value} onClick={() => void post(`/api/communications/threads/${thread.id}/status`, { status: value }, `Conversación marcada como ${statusLabels[value].toLowerCase()}.`, thread.id)}>{statusLabels[value]}</button>)}</div>}</header>

          {canManage && <section className={styles.linkPanel}><div><strong>Expediente relacionado</strong><small>{thread.related_ticket_id ? `${thread.related_ticket_code || "Incidencia"} · ${thread.related_ticket_title}` : "Todavía no está vinculada a una incidencia."}</small></div><select value={thread.related_ticket_id || ""} disabled={busy} onChange={(event) => void post(`/api/communications/threads/${thread.id}/link-ticket`, { ticketId: event.target.value || null }, event.target.value ? "Conversación vinculada a la incidencia." : "Conversación desvinculada.", thread.id)}><option value="">Sin incidencia vinculada</option>{data.tickets.map((ticket) => <option value={ticket.id} key={ticket.id}>{ticket.code || "Sin referencia"} · {ticket.title}</option>)}</select></section>}

          <section className={styles.timeline} aria-label="Historial de la conversación">{messages.map((message) => <div className={`${styles.message} ${styles[message.direction]}`} key={message.id}><header><span><Icon name={channelIcon[message.channel]} size={14} /> {channelLabels[message.channel]} · {directionLabels[message.direction]}</span><time>{formatMoment(message.occurred_at)}</time></header><p>{message.body}</p><footer>{message.sender_name || message.author_name || "Sistema"}{message.sender_address ? ` · ${message.sender_address}` : ""}{message.delivery_status !== "recorded" ? ` · ${message.delivery_status}` : ""}</footer></div>)}</section>

          <form className={styles.composer} onSubmit={sendReply}><textarea value={reply} onChange={(event) => setReply(event.target.value)} placeholder={residentMode ? "Escribe a la comunidad…" : "Añade una respuesta, llamada, correo o nota al historial…"} rows={3} maxLength={10000} required />{!residentMode && <div className={styles.composerOptions}><select value={replyChannel} onChange={(event) => setReplyChannel(event.target.value as Channel)}><option value="app">Aplicación</option><option value="email">Correo</option><option value="phone">Teléfono</option><option value="whatsapp">WhatsApp</option><option value="in_person">Presencial</option><option value="other">Otro</option></select><select value={replyDirection} onChange={(event) => setReplyDirection(event.target.value as Direction)}><option value="outbound">Saliente</option><option value="inbound">Entrante</option><option value="internal">Nota interna</option></select></div>}<div className={styles.composerFooter}><small>{residentMode ? "Tu mensaje quedará unido a esta conversación." : replyDirection === "internal" ? "La nota interna no será visible para el propietario." : "Registrar no significa que un canal externo haya confirmado la entrega."}</small><button className="button button-primary" type="submit" disabled={busy || !reply.trim()}>{residentMode || replyChannel === "app" ? "Enviar" : "Registrar"}</button></div></form>
        </>}
      </article>
    </section>

    {createOpen && <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) setCreateOpen(false); }}><form className={`record-dialog ${styles.createDialog}`} role="dialog" aria-modal="true" aria-labelledby="new-communication-title" onSubmit={createThread}><header className="dialog-header"><div><span className="eyebrow">{residentMode ? "HABLAR CON LA COMUNIDAD" : "REGISTRO OMNICANAL"}</span><h2 id="new-communication-title">{residentMode ? "Nueva conversación" : "Registrar una interacción"}</h2><p>{residentMode ? "Escribe con tus palabras. No necesitas conocer ningún procedimiento interno." : "Incorpora al historial lo que haya llegado por correo, teléfono, WhatsApp, presencialmente o desde la propia app."}</p></div><button className="icon-button" type="button" onClick={() => setCreateOpen(false)} disabled={busy} aria-label="Cerrar"><Icon name="close" /></button></header><div className={`dialog-scroll ${styles.formGrid}`}>
      <label>Asunto<input value={subject} onChange={(event) => setSubject(event.target.value)} minLength={3} maxLength={300} required placeholder="¿De qué trata?" /></label>
      <label>Prioridad<select value={priority} onChange={(event) => setPriority(event.target.value as Priority)}><option value="low">Baja</option><option value="normal">Normal</option><option value="high">Alta</option><option value="urgent">Urgente</option></select></label>
      {!residentMode && <><label>Canal<select value={channel} onChange={(event) => setChannel(event.target.value as Channel)}><option value="app">Aplicación</option><option value="email">Correo</option><option value="phone">Teléfono</option><option value="whatsapp">WhatsApp</option><option value="in_person">Presencial</option><option value="other">Otro</option></select></label><label>Sentido<select value={direction} onChange={(event) => setDirection(event.target.value as Direction)}><option value="inbound">Entrante</option><option value="outbound">Saliente</option><option value="internal">Nota interna</option></select></label><label>Propietario registrado (email)<input value={participantEmail} onChange={(event) => setParticipantEmail(event.target.value)} type="email" placeholder="Si tiene cuenta, lo relacionamos automáticamente" /></label><label>Nombre del contacto<input value={contactName} onChange={(event) => setContactName(event.target.value)} placeholder="Nombre si no está registrado" /></label><label className={styles.full}>Email / teléfono del contacto<input value={contactAddress} onChange={(event) => setContactAddress(event.target.value)} placeholder="Dato de contacto usado en ese canal" /></label></>}
      <label className={styles.full}>Mensaje<textarea value={body} onChange={(event) => setBody(event.target.value)} rows={6} maxLength={10000} required placeholder={residentMode ? "Cuéntanos qué necesitas…" : "Resume o copia el contenido de la interacción…"} /></label>
    </div><footer className={`dialog-actions ${styles.dialogActions}`}><button className="button button-secondary" type="button" onClick={() => setCreateOpen(false)} disabled={busy}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Guardando…" : residentMode ? "Enviar a la comunidad" : "Añadir al historial"}</button></footer></form></div>}
  </div>;
}
