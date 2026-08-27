"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon";
import { formatDateTime, temporalZoneNote } from "@/lib/temporal";
import { useTemporalPreferences } from "./TemporalContext";

const stages = ["initiated", "inventory", "delivery", "revocation", "onboarding", "reconciliation", "closed"];
const labels: Record<string, string> = {
  initiated: "Iniciada", inventory: "Inventario", delivery: "Entrega", revocation: "Revocación",
  onboarding: "Incorporación", reconciliation: "Conciliación", closed: "Cerrada",
  pending: "Pendiente", delivered: "Entregado", accepted: "Aceptado", reserved: "Con reserva",
  outgoing: "Administración saliente", incoming: "Administración entrante", community: "Representante de la comunidad",
};
const categoryLabels: Record<string, string> = {
  documents: "Documentación", banking: "Bancos", contracts: "Contratos", keys: "Llaves",
  credentials: "Credenciales", pending_cases: "Pendientes", accounting: "Contabilidad", other: "Otro",
};

interface TransitionData {
  transitions: Array<{ id: string; title: string; status: string }>;
  selected: { id: string; title: string; status: string; description: string } | null;
  parties: Array<{ id: string; party_type: string; name: string; email: string; status: string; user_id: string | null }>;
  items: Array<{ id: string; category: string; title: string; description: string | null; status: string; reservation_note: string | null }>;
  events: Array<{ id: string; event_type: string; description: string; created_at: string }>;
}

export function TransitionWorkspace() {
  const preferences = useTemporalPreferences();
  const [data, setData] = useState<TransitionData | null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [itemOpen, setItemOpen] = useState(false);
  const [partyOpen, setPartyOpen] = useState(false);
  const [category, setCategory] = useState("documents");
  const [title, setTitle] = useState("");
  const [description, setDescription] = useState("");
  const [partyType, setPartyType] = useState("outgoing");
  const [partyName, setPartyName] = useState("");
  const [partyEmail, setPartyEmail] = useState("");

  const load = useCallback(async (id?: string) => {
    try {
      const response = await fetch("/api/transition/dashboard" + (id ? "?id=" + id : ""), { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setData(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar la transición.");
    }
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => void load(), 0);
    return () => clearTimeout(timer);
  }, [load]);

  async function act(url: string, body?: unknown, success = "Guardado") {
    setBusy(true);
    setError("");
    try {
      const response = await fetch(url, {
        method: "POST",
        headers: body ? { "Content-Type": "application/json" } : undefined,
        body: body ? JSON.stringify(body) : undefined,
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      setMessage(success);
      window.setTimeout(() => setMessage(""), 3200);
      await load(data?.selected?.id);
      return true;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo completar la operación.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  if (!data) return <div className="page"><div className="finance-loading"><span className="spinner" /> Cargando transición…</div></div>;
  const transition = data.selected;
  const currentStage = transition ? stages.indexOf(transition.status) : -1;

  return <div className="page transition-workspace">
    <div className="module-breadcrumb"><Link href="/inicio">← Inicio</Link><span>/</span><span>Continuidad</span></div>
    <header className="page-heading">
      <div><span className="eyebrow">LA COMUNIDAD CONSERVA EL CONTROL</span><h1>Cambio de administrador</h1><p>Entrega, aceptación y permisos en un expediente trazable, sin trasladar los datos a otra aplicación. {temporalZoneNote(preferences)}.</p></div>
      <div className="heading-actions">
        <Link className="button button-secondary" href="/transicion?view=records">Gestionar fichas</Link>
        {transition && <><button className="button button-secondary" onClick={() => setPartyOpen(true)}><Icon name="users" size={18} /> Partes</button><button className="button button-primary" onClick={() => setItemOpen(true)}><Icon name="plus" size={18} /> Inventario</button></>}
      </div>
    </header>
    {error && <div className="form-alert" role="alert">{error}</div>}
    {transition ? <>
      <section className="transition-steps" aria-label="Fases de la transición">
        {stages.map((stage, index) => <div className={currentStage >= index ? "done" : ""} aria-current={transition.status === stage ? "step" : undefined} key={stage}><span>{index + 1}</span><strong>{labels[stage]}</strong></div>)}
      </section>
      <div className="transition-grid">
        <section className="transition-panel">
          <header><h2>Inventario de entrega</h2><span>{data.items.filter((item) => item.status === "accepted").length}/{data.items.length} aceptados</span></header>
          <div className="transition-items">
            {data.items.length === 0 && <div className="compact-empty"><strong>Inventario pendiente</strong><p>Añade documentación, accesos, llaves, contratos y asuntos abiertos.</p></div>}
            {data.items.map((item) => <article key={item.id}>
              <div><span className="section-chip">{categoryLabels[item.category] || item.category}</span><strong>{item.title}</strong>{item.description && <p>{item.description}</p>}{item.reservation_note && <small>Reserva: {item.reservation_note}</small>}</div>
              <div><b className={"finance-status status-" + item.status}>{labels[item.status]}</b>
                {item.status === "pending" && <><button disabled={busy} onClick={() => void act("/api/transition/items/" + item.id + "/status", { status: "delivered" }, "Elemento entregado.")}>Entregar</button><button disabled={busy} onClick={() => { const note = window.prompt("Describe la reserva o incidencia"); if (note) void act("/api/transition/items/" + item.id + "/status", { status: "reserved", reservationNote: note }, "Reserva registrada."); }}>Reserva</button></>}
                {item.status === "delivered" && <button disabled={busy} onClick={() => void act("/api/transition/items/" + item.id + "/status", { status: "accepted" }, "Elemento aceptado.")}>Aceptar</button>}
              </div>
            </article>)}
          </div>
        </section>
        <aside>
          <section className="transition-panel">
            <header><h2>Partes</h2><button className="text-button" onClick={() => setPartyOpen(true)}>Configurar</button></header>
            {data.parties.length === 0 && <div className="compact-empty"><p>Configura las tres partes antes de cambiar permisos.</p></div>}
            {data.parties.map((party) => <div className="transition-party" key={party.party_type}>
              <span>{labels[party.party_type]}</span><strong>{party.name}</strong><small>{party.email}</small>
              <div><b className={"finance-status status-" + party.status}>{party.status === "accepted" ? "Aceptada" : "Invitada"}</b>{!party.user_id && party.party_type !== "community" && <em>Cuenta no vinculada</em>}{party.status !== "accepted" && <button disabled={busy} onClick={() => void act("/api/transition/parties/" + party.id + "/accept", undefined, "Conformidad registrada.")}>Registrar aceptación</button>}</div>
            </div>)}
          </section>
          <section className="transition-panel transition-events">
            <header><h2>Trazabilidad</h2></header>
            {data.events.map((event) => <article key={event.id}><span /><div><strong>{event.description}</strong><small>Registrado el {formatDateTime(event.created_at,preferences)}</small></div></article>)}
          </section>
        </aside>
      </div>
      <div className="governance-close">
        <div><strong>Siguiente fase: {labels[stages[currentStage + 1]] || "Finalizada"}</strong><small>El sistema bloquea el avance si faltan inventario, identidades o aceptaciones.</small></div>
        <button className="button button-primary" disabled={busy || transition.status === "closed"} onClick={() => void act("/api/transition/" + transition.id + "/advance", undefined, "Transición avanzada con permisos actualizados.")}>Avanzar fase</button>
      </div>
    </> : <div className="empty-state"><h2>No hay transición activa</h2><p>Inicia una ficha cuando la comunidad acuerde cambiar de administración.</p></div>}

    {itemOpen && transition && <div className="modal-backdrop"><section className="record-dialog" role="dialog" aria-modal="true" aria-labelledby="item-title">
      <header className="dialog-header"><div><span className="eyebrow">INVENTARIO</span><h2 id="item-title">Añadir elemento</h2></div><button className="icon-button" aria-label="Cerrar" onClick={() => setItemOpen(false)}><Icon name="close" /></button></header>
      <div className="dialog-scroll form-grid">
        <label className="field-group">Categoría<select value={category} onChange={(event) => setCategory(event.target.value)}>{Object.entries(categoryLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
        <label className="field-group">Título<input value={title} onChange={(event) => setTitle(event.target.value)} /></label>
        <label className="field-group field-wide">Descripción<textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={4} />
          {category === "credentials" && <small>No escribas contraseñas, claves API ni códigos. Indica únicamente dónde se custodian y cómo debe transferirse el acceso.</small>}
        </label>
      </div>
      <footer className="dialog-footer"><span /><div className="dialog-footer-actions"><button className="button button-secondary" onClick={() => setItemOpen(false)}>Cancelar</button><button className="button button-primary" disabled={busy || title.trim().length < 2} onClick={async () => { if (await act("/api/transition/" + transition.id + "/items", { category, title, description }, "Añadido al inventario.")) { setItemOpen(false); setTitle(""); setDescription(""); } }}>Añadir</button></div></footer>
    </section></div>}

    {partyOpen && transition && <div className="modal-backdrop"><section className="record-dialog" role="dialog" aria-modal="true" aria-labelledby="party-title">
      <header className="dialog-header"><div><span className="eyebrow">IDENTIDAD Y CONFORMIDAD</span><h2 id="party-title">Configurar parte</h2></div><button className="icon-button" aria-label="Cerrar" onClick={() => setPartyOpen(false)}><Icon name="close" /></button></header>
      <div className="dialog-scroll form-grid">
        <label className="field-group">Función<select value={partyType} onChange={(event) => setPartyType(event.target.value)}><option value="outgoing">Administración saliente</option><option value="incoming">Administración entrante</option><option value="community">Representante de la comunidad</option></select></label>
        <label className="field-group">Nombre<input value={partyName} onChange={(event) => setPartyName(event.target.value)} /></label>
        <label className="field-group field-wide">Correo electrónico<input type="email" value={partyEmail} onChange={(event) => setPartyEmail(event.target.value)} /><small>Para cambiar permisos, los administradores deben tener una cuenta con este correo.</small></label>
      </div>
      <footer className="dialog-footer"><span /><div className="dialog-footer-actions"><button className="button button-secondary" onClick={() => setPartyOpen(false)}>Cancelar</button><button className="button button-primary" disabled={busy || partyName.trim().length < 2 || !partyEmail.includes("@")} onClick={async () => { if (await act("/api/transition/" + transition.id + "/parties", { partyType, name: partyName, email: partyEmail }, "Parte configurada.")) { setPartyOpen(false); setPartyName(""); setPartyEmail(""); } }}>Guardar</button></div></footer>
    </section></div>}
    {message && <div className="toast" role="status">{message}</div>}
  </div>;
}
