"use client";

import { useCallback, useEffect, useState } from "react";
import type { MeetingLifecycleDTO, MeetingLifecycleMilestoneDTO } from "@/lib/governance-types";
import { formatBusinessMoment } from "@/lib/temporal";
import { Icon } from "./Icon";
import { useTemporalPreferences } from "./TemporalContext";

const statusCopy = {
  complete: { label: "Cumplido", icon: "badge-check" },
  pending: { label: "Pendiente", icon: "more" },
  attention: { label: "Requiere revisión", icon: "alert-triangle" },
  blocked: { label: "Esperando hito anterior", icon: "archive" },
  not_applicable: { label: "No aplica", icon: "info" }
} as const;

export function MeetingLifecyclePanel({
  lifecycle,
  canWrite = false,
  onEditProfile,
  onEditMilestone,
  compact = false
}: {
  lifecycle: MeetingLifecycleDTO;
  canWrite?: boolean;
  onEditProfile?: () => void;
  onEditMilestone?: (milestone: MeetingLifecycleMilestoneDTO) => void;
  compact?: boolean;
}) {
  const preferences = useTemporalPreferences();
  return <section className={`meeting-lifecycle ${compact ? "compact" : ""}`} aria-labelledby="meeting-lifecycle-title">
    <header className="meeting-lifecycle-header">
      <div className="meeting-lifecycle-progress" style={{ "--meeting-progress": `${lifecycle.progress}%` } as React.CSSProperties}>
        <strong>{lifecycle.progress}%</strong><small>{lifecycle.completed}/{lifecycle.total}</small>
      </div>
      <span className="meeting-lifecycle-heading">
        <small>EXPEDIENTE DE LA JUNTA</small>
        <h2 id="meeting-lifecycle-title">Ciclo y cumplimiento</h2>
        <p><b>{lifecycle.phaseLabel}</b>{lifecycle.nextTitle ? ` · Siguiente: ${lifecycle.nextTitle}` : " · Todos los hitos registrados"}</p>
      </span>
      {canWrite && <button className="button button-secondary" type="button" onClick={onEditProfile}><Icon name="settings" size={17}/> Datos legales</button>}
    </header>
    <div className="meeting-lifecycle-bar" aria-label={`${lifecycle.progress}% completado`}><span style={{ width: `${lifecycle.progress}%` }}/></div>
    <div className="meeting-milestone-list">
      {lifecycle.milestones.map((milestone, index) => {
        const copy = statusCopy[milestone.status];
        return <article className={`meeting-milestone milestone-${milestone.status}`} key={milestone.key}>
          <span className="meeting-milestone-index"><Icon name={copy.icon} size={18}/><i>{index + 1}</i></span>
          <div className="meeting-milestone-copy">
            <span className="meeting-milestone-title"><strong>{milestone.title}</strong><em>{copy.label}</em>{milestone.automatic && <small>Automático</small>}</span>
            <p>{milestone.description}</p>
            <span className="meeting-milestone-meta">
              <b>{milestone.legalSource}</b>
              {milestone.dueAt && <span>Fecha límite: {formatBusinessMoment(milestone.dueAt, milestone.dueTimePrecision, preferences, { deadline: true, inclusive: true })}</span>}
              {milestone.completedAt && <span>Registrado: {formatBusinessMoment(milestone.completedAt, milestone.completedTimePrecision, preferences)}</span>}
              {milestone.evidenceReference && <span>Evidencia: {milestone.evidenceReference}</span>}
            </span>
            {milestone.note && <small className="meeting-milestone-note">{milestone.note}</small>}
          </div>
          {canWrite && milestone.actionKey && <button className="button button-secondary meeting-milestone-action" type="button" onClick={() => onEditMilestone?.(milestone)} disabled={milestone.status === "blocked"}>
            {milestone.version ? "Corregir" : "Registrar"}
          </button>}
        </article>;
      })}
    </div>
    <footer className="meeting-lifecycle-legal"><Icon name="shield-check" size={18}/><span><strong>Control documental basado en LPH estatal</strong><small>Las comprobaciones automáticas ayudan a detectar ausencias y plazos, pero no sustituyen la revisión profesional del caso, los estatutos ni normas territoriales aplicables.</small></span></footer>
  </section>;
}

export function ResidentMeetingLifecycle({ meetingId }: { meetingId: string }) {
  const [lifecycle, setLifecycle] = useState<MeetingLifecycleDTO | null>(null);
  const [error, setError] = useState("");
  const load = useCallback(async () => {
    setError("");
    try {
      const response = await fetch(`/api/governance/meetings/${meetingId}/lifecycle`, { cache: "no-store" });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se pudo cargar el ciclo de la junta.");
      setLifecycle(result);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "No se pudo cargar el ciclo de la junta.");
    }
  }, [meetingId]);
  useEffect(() => { const timer = window.setTimeout(() => void load(), 0); return () => window.clearTimeout(timer); }, [load]);
  if (error) return <div className="form-alert">{error} <button className="text-button" type="button" onClick={() => void load()}>Reintentar</button></div>;
  if (!lifecycle) return <div className="meeting-lifecycle-loading"><span className="spinner"/> Comprobando hitos de la junta…</div>;
  return <MeetingLifecyclePanel lifecycle={lifecycle} compact/>;
}
