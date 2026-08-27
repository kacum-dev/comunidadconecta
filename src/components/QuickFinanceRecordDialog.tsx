"use client";

import { useState, type FormEvent } from "react";
import { temporalZoneNote, toDateTimeLocal } from "@/lib/temporal";
import { Icon } from "./Icon";
import styles from "./GuidedFlows.module.css";
import { useTemporalPreferences } from "./TemporalContext";

const kinds = [
  { value: "charge", label: "Cuota", help: "Cuota ordinaria de un propietario", icon: "wallet" },
  { value: "assessment", label: "Derrama", help: "Aportación extraordinaria", icon: "arrow-up-down" },
  { value: "invoice", label: "Factura", help: "Gasto o factura de proveedor", icon: "files" },
  { value: "receipt", label: "Otro", help: "Otro cobro o pago", icon: "plus" }
] as const;

export function QuickFinanceRecordDialog({ onClose, onCreated }: { onClose: () => void; onCreated: () => Promise<void> | void }) {
  const preferences = useTemporalPreferences();
  const [kind, setKind] = useState<(typeof kinds)[number]["value"]>("charge");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const now = toDateTimeLocal(new Date(), preferences);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/modules/economia", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: form.get("title"),
        kind,
        status: "issued",
        amount: Number(form.get("amount")),
        eventDate: form.get("eventDate"),
        dueDate: form.get("dueDate"),
        contact: form.get("contact"),
        description: form.get("description")
      })
    });
    const body = await response.json();
    if (!response.ok) {
      setError(body.error || "No se ha podido crear el registro.");
      setBusy(false);
      return;
    }
    await onCreated();
    onClose();
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className={`record-dialog ${styles.quickDialog}`} role="dialog" aria-modal="true" aria-labelledby="quick-finance-title">
        <header className="dialog-header">
          <div><span className="eyebrow">NUEVO REGISTRO</span><h2 id="quick-finance-title">¿Qué quieres registrar?</h2><p>Solo pedimos los datos imprescindibles. Después podrás completar el resto.</p></div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Cerrar"><Icon name="close" /></button>
        </header>
        <form className="dialog-form" onSubmit={submit}>
          <div className={`dialog-scroll ${styles.quickBody}`}>
            <fieldset className={styles.choiceFieldset}>
              <legend className="sr-only">Tipo de registro</legend>
              <div className={styles.choiceGrid}>{kinds.map((item) => <label className={kind === item.value ? styles.choiceActive : styles.choice} key={item.value}>
                <input className="sr-only" type="radio" name="kind" value={item.value} checked={kind === item.value} onChange={() => setKind(item.value)} />
                <Icon name={item.icon} size={22} /><span><strong>{item.label}</strong><small>{item.help}</small></span>
              </label>)}</div>
            </fieldset>
            <div className="form-grid">
              <label className="field-group field-wide">Concepto *<input name="title" required maxLength={200} autoFocus placeholder={kind === "charge" ? "Ej. Cuota de septiembre" : kind === "invoice" ? "Ej. Reparación del ascensor" : "Describe el registro"} /></label>
              <label className="field-group">Importe *<span className="input-with-suffix"><input name="amount" type="number" min="0.01" step="0.01" required inputMode="decimal" /><b>€</b></span></label>
              <label className="field-group">Fecha y hora de emisión *<input name="eventDate" type="datetime-local" step="1" required defaultValue={now} /><small className="field-hint">{temporalZoneNote(preferences)}.</small></label>
              <label className="field-group">Vence el (incluido)<input name="dueDate" type="datetime-local" step="1" min={now} /><small className="field-hint">El pago será válido hasta el segundo indicado, incluido.</small></label>
              <label className="field-group">Persona o proveedor<input name="contact" maxLength={200} placeholder="Opcional" /></label>
              <label className="field-group field-wide">Nota<textarea name="description" rows={2} maxLength={1000} placeholder="Opcional" /></label>
            </div>
            {error && <div className="form-alert" role="alert">{error}</div>}
          </div>
          <footer className="dialog-footer"><span>Podrás editarlo después.</span><div className="dialog-footer-actions"><button type="button" className="button button-secondary" onClick={onClose} disabled={busy}>Cancelar</button><button className="button button-primary" disabled={busy}>{busy ? "Guardando…" : "Crear registro"}</button></div></footer>
        </form>
      </section>
    </div>
  );
}
