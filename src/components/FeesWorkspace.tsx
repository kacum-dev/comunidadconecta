"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { buildFeeOccurrencePlan, type FeeFrequency } from "@/lib/fees-domain";
import { formatBusinessMoment, formatDateTime, temporalZoneNote, toDateTimeLocal } from "@/lib/temporal";
import { Icon } from "./Icon";
import { useTemporalPreferences } from "./TemporalContext";

interface Dashboard {
  budgets: Array<{ id: string; name: string; fiscal_year: number; status: string; total_cents: string; line_count: number }>;
  issues: Array<{ id: string; name: string; kind: string; calculation_method: string; total_cents: string; due_at: string; due_time_precision: "day"|"minute"|"second"; due_inclusive: boolean; issued_at: string|null; status: string; unit_count: number; allocated_cents: string; frequency: FeeFrequency|null }>;
  schedules: Array<{ id: string; name: string; frequency: FeeFrequency; total_cents: string; status: string; issue_lead_days: number; ends_on: string|null; next_due_at: string|null; planned_count: number }>;
  annualForecast: { year: number; scope: "home"|"community"; generatedCents: number; paidCents: number; pendingCents: number; plannedCents: number; estimatedCents: number };
}
interface Preview { id: string; code: string; coefficient: number; amountCents: number; explanation: string; ownerName: string; ownerEmail: string|null }

const money = (cents: number|string) => new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" }).format(Number(cents) / 100);
const frequencyLabels: Record<FeeFrequency, string> = { monthly: "Mensual", quarterly: "Trimestral", yearly: "Anual" };

export function FeesWorkspace({ onBack, canWrite }: { onBack: () => void; canWrite: boolean }) {
  const preferences = useTemporalPreferences();
  const [data, setData] = useState<Dashboard|null>(null);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [preview, setPreview] = useState<Preview[]>([]);
  const [name, setName] = useState("Cuota ordinaria");
  const [kind, setKind] = useState<"ordinary"|"assessment">("ordinary");
  const [method, setMethod] = useState<"unit_settings"|"coefficient"|"equal">("coefficient");
  const [total, setTotal] = useState("");
  const [dueDate, setDueDate] = useState("");
  const [recurrence, setRecurrence] = useState<"once"|FeeFrequency>("once");
  const [issueLeadDays, setIssueLeadDays] = useState(10);
  const [endsOn, setEndsOn] = useState("");

  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/fees/dashboard", { cache: "no-store" });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error);
      setData(body);
    } catch (loadError) { setError(loadError instanceof Error ? loadError.message : "No se pudo cargar."); }
  }, []);
  useEffect(() => { const timeout = setTimeout(() => void load(), 0); return () => clearTimeout(timeout); }, [load]);

  async function post(url: string, body?: unknown) {
    setBusy(true); setError("");
    try {
      const response = await fetch(url, { method: "POST", headers: body ? { "Content-Type": "application/json" } : undefined, body: body ? JSON.stringify(body) : undefined });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error);
      return result;
    } catch (postError) { setError(postError instanceof Error ? postError.message : "No se pudo completar."); return null; }
    finally { setBusy(false); }
  }
  async function calculate() {
    const result = await post("/api/fees/preview", { total: Number(total), method });
    if (result) setPreview(result);
  }
  async function issue() {
    const result = await post("/api/fees/issues", { name, kind, method, total: Number(total), dueAt: dueDate, recurrence, issueLeadDays, endsOn: endsOn || null });
    if (!result) return;
    setMessage(result.scheduleId ? `Primera emisión creada y ${result.plannedOccurrences} próximas cuotas programadas.` : `Emisión creada para ${result.units} viviendas.`);
    setOpen(false); setPreview([]); await load();
  }

  const seriesEstimate = useMemo(() => {
    if (recurrence === "once" || !dueDate || !(Number(total) > 0)) return null;
    try {
      const year = Number(dueDate.slice(0, 4));
      const plan = buildFeeOccurrencePlan(dueDate, recurrence, issueLeadDays, endsOn || null, recurrence === "monthly" ? 24 : recurrence === "quarterly" ? 12 : 5);
      const inYear = plan.filter((item) => Number(item.dueLocal.slice(0, 4)) === year).length;
      return { year, count: inYear, cents: Math.round(Number(total) * 100) * inYear };
    } catch { return null; }
  }, [dueDate, endsOn, issueLeadDays, recurrence, total]);

  if (!data) return <div className="page"><div className="finance-loading"><span className="spinner" /> Cargando presupuestos…</div></div>;
  const forecast = data.annualForecast;
  return <div className="page fees-workspace">
    <div className="module-breadcrumb"><button onClick={onBack}>← Economía</button><span>/</span><span>Presupuestos y cuotas</span></div>
    <header className="page-heading"><div><span className="eyebrow">REPARTOS Y PREVISIÓN</span><h1>Presupuestos y cuotas</h1><p>Emisiones únicas o periódicas, con el cálculo de cada vivienda y una previsión anual comprensible.</p></div>{canWrite && <button className="button button-primary" onClick={() => setOpen(true)}><Icon name="plus" size={18} /> Emitir o programar cuota</button>}</header>
    {error && <div className="form-alert" role="alert">{error}</div>}

    <section className="fee-forecast" aria-label={`Previsión económica de ${forecast.year}`}>
      <header><span><Icon name="wallet" size={19} /></span><span><small>{forecast.scope === "home" ? "PREVISIÓN DE TU VIVIENDA" : "PREVISIÓN DE LA COMUNIDAD"}</small><strong>Estimación de cuotas {forecast.year}</strong></span><b>{money(forecast.estimatedCents)}</b></header>
      <div><article><small>Generado</small><strong>{money(forecast.generatedCents)}</strong><span>Recibos ya emitidos</span></article><article><small>Pagado</small><strong>{money(forecast.paidCents)}</strong><span>Parte ya cobrada</span></article><article><small>Pendiente emitido</small><strong>{money(forecast.pendingCents)}</strong><span>Generado aún sin pagar</span></article><article><small>Todavía previsto</small><strong>{money(forecast.plannedCents)}</strong><span>Cuotas periódicas futuras</span></article></div>
      <p><Icon name="info" size={15} /> Es una estimación: una modificación de la cuota, del coeficiente o de la programación actualizará el cálculo.</p>
    </section>

    {canWrite && data.schedules.length > 0 && <section className="finance-panel fee-schedules-panel"><header><div><span className="section-chip">AUTOMATIZACIÓN</span><h2>Series activas</h2><p>Las próximas emisiones se generan al llegar su fecha programada.</p></div></header><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Serie</th><th>Periodicidad</th><th>Próximo vencimiento</th><th>Previstas</th><th>Importe por emisión</th><th>Estado</th></tr></thead><tbody>{data.schedules.map((schedule) => <tr key={schedule.id}><td><strong>{schedule.name}</strong><small>Se emite {schedule.issue_lead_days} días antes</small></td><td>{frequencyLabels[schedule.frequency]}</td><td>{schedule.next_due_at ? formatDateTime(schedule.next_due_at, preferences) : "Sin próximas cuotas"}</td><td>{schedule.planned_count}</td><td><strong>{money(schedule.total_cents)}</strong></td><td><span className={`finance-status status-${schedule.status}`}>{schedule.status === "active" ? "Activa" : schedule.status}</span></td></tr>)}</tbody></table></div></section>}

    <div className="fee-grid">
      {data.budgets.length > 0 && <section className="finance-panel"><header><div><span className="section-chip">PLANIFICACIÓN</span><h2>Presupuestos</h2><p>Partidas por ejercicio con aprobación separada.</p></div></header><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Presupuesto</th><th>Ejercicio</th><th>Partidas</th><th>Estado</th><th>Total</th></tr></thead><tbody>{data.budgets.map((budget) => <tr key={budget.id}><td><strong>{budget.name}</strong></td><td>{budget.fiscal_year}</td><td>{budget.line_count}</td><td><span className={`finance-status status-${budget.status}`}>{budget.status}</span></td><td><strong>{money(budget.total_cents)}</strong></td></tr>)}</tbody></table></div></section>}
      <section className="finance-panel"><header><div><span className="section-chip">EMISIONES</span><h2>{forecast.scope === "home" ? "Tus cuotas y derramas" : "Cuotas y derramas"}</h2><p>Recibos generados con fecha y hora exactas. {temporalZoneNote(preferences)}.</p></div></header><div className="finance-table-wrap"><table className="finance-table"><thead><tr><th>Concepto</th><th>Fecha y hora de emisión</th><th>Vence el (incluido)</th><th>Serie</th><th>Viviendas</th><th>Total</th></tr></thead><tbody>{data.issues.map((issue) => <tr key={issue.id}><td><strong>{issue.name}</strong><small>{issue.kind === "assessment" ? "Derrama" : "Cuota"}</small></td><td>{issue.issued_at ? formatDateTime(issue.issued_at, preferences) : "Pendiente"}</td><td>{formatBusinessMoment(issue.due_at, issue.due_time_precision, preferences, { deadline: true, inclusive: issue.due_inclusive })}</td><td>{issue.frequency ? frequencyLabels[issue.frequency] : "Única"}</td><td>{issue.unit_count}</td><td><strong>{money(issue.total_cents)}</strong></td></tr>)}</tbody></table></div></section>
    </div>

    {open && <div className="modal-backdrop"><section className="record-dialog fees-dialog recurring-fees-dialog" role="dialog" aria-modal="true" aria-labelledby="fee-title"><header className="dialog-header"><div><span className="eyebrow">REPARTO Y PROGRAMACIÓN</span><h2 id="fee-title">Emitir cuotas</h2><p>Revisa el reparto y decide si debe repetirse automáticamente.</p></div><button className="icon-button" aria-label="Cerrar" onClick={() => setOpen(false)}><Icon name="close" /></button></header><div className="dialog-scroll">
      <div className="form-grid"><label className="field-group">Concepto<input value={name} onChange={(event) => setName(event.target.value)} /></label><label className="field-group">Tipo<select value={kind} onChange={(event) => { const value = event.target.value as typeof kind; setKind(value); if (value === "assessment") setRecurrence("once"); }}><option value="ordinary">Cuota ordinaria</option><option value="assessment">Derrama</option></select></label><label className="field-group">Importe total por emisión (€)<input type="number" min=".01" step=".01" value={total} onChange={(event) => { setTotal(event.target.value); setPreview([]); }} /></label><label className="field-group">Primer vencimiento (incluido)<input type="datetime-local" step="1" min={toDateTimeLocal(new Date(), preferences)} value={dueDate} onChange={(event) => setDueDate(event.target.value)} /><small className="field-hint">{temporalZoneNote(preferences)}. Se podrá pagar hasta este segundo, incluido.</small></label><label className="field-group field-wide">Criterio de reparto<select value={method} onChange={(event) => { setMethod(event.target.value as typeof method); setPreview([]); }}><option value="coefficient">Coeficiente de participación</option><option value="unit_settings">Configuración de cada vivienda</option><option value="equal">Partes iguales</option></select></label></div>
      {kind === "ordinary" && <section className="fee-recurrence-section"><header><span><Icon name="refresh-cw" size={19} /></span><span><strong>¿Quieres que esta cuota se repita?</strong><small>La primera se emite ahora; las siguientes se generarán automáticamente.</small></span></header><div className="fee-recurrence-options">{([{ value: "once", label: "Solo esta vez" }, { value: "monthly", label: "Todos los meses" }, { value: "quarterly", label: "Cada 3 meses" }, { value: "yearly", label: "Cada año" }] as const).map((option) => <label className={recurrence === option.value ? "selected" : ""} key={option.value}><input className="sr-only" type="radio" name="recurrence" checked={recurrence === option.value} onChange={() => setRecurrence(option.value)} /><span>{recurrence === option.value ? "✓" : ""}</span><strong>{option.label}</strong></label>)}</div>{recurrence !== "once" && <div className="form-grid fee-recurrence-fields"><label className="field-group">Generar cada recibo con antelación<input type="number" min={0} max={90} value={issueLeadDays} onChange={(event) => setIssueLeadDays(Number(event.target.value))} /><small className="field-hint">Días antes del vencimiento.</small></label><label className="field-group">Finalizar la serie el<input type="date" min={dueDate.slice(0, 10) || undefined} value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /><small className="field-hint">Opcional; sin fecha se preparan las próximas 24 cuotas mensuales.</small></label></div>}{seriesEstimate && <div className="fee-series-estimate"><Icon name="sparkles" size={18} /><span><strong>Estimación {seriesEstimate.year}: {money(seriesEstimate.cents)}</strong><small>{seriesEstimate.count} emisiones de {money(Math.round(Number(total) * 100))}; los pagos se contabilizarán aparte de lo previsto.</small></span></div>}</section>}
      {preview.length > 0 && <div className="fee-preview"><header><strong>Vista previa del primer reparto</strong><span>{preview.length} viviendas · {money(preview.reduce((sum, line) => sum + line.amountCents, 0))}</span></header>{preview.map((line) => <div key={line.id}><span><strong>{line.code} · {line.ownerName}</strong><small>{line.explanation}</small></span><b>{money(line.amountCents)}</b></div>)}</div>}
    </div><footer className="dialog-footer"><span>{preview.length ? "Revisa el primer reparto antes de confirmar." : "Primero calcula la vista previa."}</span><div className="dialog-footer-actions"><button className="button button-secondary" onClick={() => setOpen(false)}>Cancelar</button><button className="button button-secondary" disabled={busy || !total} onClick={() => void calculate()}>Calcular</button><button className="button button-primary" disabled={busy || !preview.length || !dueDate} onClick={() => void issue()}>{recurrence === "once" ? "Emitir y crear recibos" : "Emitir y programar serie"}</button></div></footer></section></div>}
    {message && <div className="toast" role="status"><Icon name="badge-check" size={18} />{message}</div>}
  </div>;
}
