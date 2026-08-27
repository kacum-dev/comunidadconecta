"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Icon } from "./Icon";
import { formatDateTime, temporalZoneNote } from "@/lib/temporal";
import { useTemporalPreferences } from "./TemporalContext";

interface Notification {
  id: string;
  type: string;
  title: string;
  body: string;
  href: string | null;
  read_at: string | null;
  created_at: string;
}

export function NotificationCenter() {
  const preferences = useTemporalPreferences();
  const [rows, setRows] = useState<Notification[]>([]);
  const [unread, setUnread] = useState(0);
  const [filter, setFilter] = useState<"all" | "unread">("all");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    try {
      setError("");
      const response = await fetch("/api/notifications", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setRows(body.rows);
      setUnread(body.unread);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudieron cargar las notificaciones.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  const visibleRows = useMemo(() => filter === "unread" ? rows.filter((row) => !row.read_at) : rows, [filter, rows]);

  async function read(id: string) {
    setBusy(true);
    const response = await fetch(`/api/notifications/${id}/read`, { method: "POST" });
    if (response.ok) await load();
    else setError("No se ha podido marcar la notificación como leída.");
    setBusy(false);
  }

  async function readAll() {
    setBusy(true);
    const response = await fetch("/api/notifications/read-all", { method: "POST" });
    if (response.ok) await load();
    else setError("No se han podido actualizar las notificaciones.");
    setBusy(false);
  }

  return <div className="page notifications-page">
    <div className="module-breadcrumb"><Link href="/inicio">← Inicio</Link><span>/</span><span>Notificaciones</span></div>
    <header className="page-heading"><div><span className="eyebrow">TU ACTIVIDAD</span><h1>Notificaciones</h1><p>Todo lo que requiere tu atención, ordenado en un único lugar. {temporalZoneNote(preferences)}.</p></div></header>

    <section className={`notification-overview ${unread === 0 ? "is-clear" : ""}`}>
      <span className="notification-overview-icon"><Icon name={unread ? "bell" : "badge-check"} size={25} /></span>
      <span><small>{unread ? "PENDIENTES" : "TODO AL DÍA"}</small><strong>{unread ? `${unread} sin leer` : "No tienes avisos pendientes"}</strong><p>{unread ? "Revísalas cuando puedas o márcalas todas como leídas." : "Te avisaremos aquí cuando haya alguna novedad importante."}</p></span>
      {unread > 0 && <button className="button button-secondary" disabled={busy} onClick={() => void readAll()}><Icon name="badge-check" size={17} /> Marcar todo leído</button>}
    </section>

    <div className="notification-toolbar" role="tablist" aria-label="Filtrar notificaciones">
      <button role="tab" aria-selected={filter === "all"} className={filter === "all" ? "active" : ""} onClick={() => setFilter("all")}>Todas <span>{rows.length}</span></button>
      <button role="tab" aria-selected={filter === "unread"} className={filter === "unread" ? "active" : ""} onClick={() => setFilter("unread")}>No leídas <span>{unread}</span></button>
    </div>

    {error && <div className="form-alert">{error}</div>}
    <section className={`notification-list ${loading ? "is-loading" : ""}`}>
      {visibleRows.length ? visibleRows.map((row) => <article className={row.read_at ? "read" : "unread"} key={row.id}>
        <span className="notification-icon"><Icon name={row.type === "ticket" ? "wrench" : "bell"} size={20} /></span>
        <div><span className="notification-title-line"><strong>{row.title}</strong>{!row.read_at && <i>Nuevo</i>}</span><p>{row.body}</p><small>Recibida el {formatDateTime(row.created_at, preferences)}</small></div>
        <div>{!row.read_at && <button className="button button-secondary" disabled={busy} onClick={() => void read(row.id)}>Marcar leída</button>}{row.href && <Link className="button button-primary" href={row.href} onClick={() => { if (!row.read_at) void read(row.id); }}>Abrir</Link>}</div>
      </article>) : <div className="empty-state"><span><Icon name={filter === "unread" ? "badge-check" : "bell"} /></span><h2>{filter === "unread" ? "Todo está leído" : "Sin notificaciones"}</h2><p>{filter === "unread" ? "No tienes ninguna notificación pendiente." : "Los cambios importantes aparecerán aquí."}</p></div>}
      {loading && <div className="notification-loading"><span className="spinner" /> Actualizando notificaciones</div>}
    </section>
  </div>;
}
