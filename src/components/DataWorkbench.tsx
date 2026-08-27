"use client";

import { useCallback, useDeferredValue, useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { FieldDefinition, FieldKey, ModuleDefinition } from "@/lib/modules";
import { optionLabel } from "@/lib/modules";
import type { RecordRow } from "@/lib/records";
import { prepareResidentSubmission, type ResidentFormValues } from "@/lib/resident-forms";
import { formatBusinessMoment, formatDateTime, temporalZoneNote, toDateTimeLocal, type TemporalPreferences } from "@/lib/temporal";
import { Icon } from "./Icon";
import { ResidentMeetingLifecycle } from "./MeetingLifecyclePanel";
import { ResidentFeeForecast } from "./ResidentFeeForecast";
import { ResidentTaskDialog } from "./ResidentTaskDialog";
import { useTemporalPreferences } from "./TemporalContext";

interface WorkbenchProps {
  definition: ModuleDefinition;
  permissions: { write: boolean; archive: boolean; export: boolean };
  residentMode?: boolean;
}

type FormValues = ResidentFormValues;

const currency = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
function initialValues(definition: ModuleDefinition, preferences: TemporalPreferences, row?: RecordRow | null, residentMode = false): FormValues {
  const values: FormValues = {};
  for (const field of definition.fields) {
    if (!row) {
      if (field.type === "select") values[field.key] = field.options?.[0]?.value ?? "";
      else if (field.key === "eventDate" && field.type === "datetime") values[field.key] = toDateTimeLocal(new Date(), preferences);
      else if (field.key === "eventDate") values[field.key] = new Date().toISOString().slice(0, 10);
      else values[field.key] = "";
      continue;
    }
    const value = row[field.key as keyof RecordRow];
    values[field.key] = field.type === "datetime" && typeof value === "string"
      ? toDateTimeLocal(value, preferences)
      : typeof value === "number" || typeof value === "string" ? value : "";
  }
  if (!row && residentMode && (definition.key === "incidencias" || definition.key === "reservas")) values.kind = "";
  if (!row && residentMode && definition.key === "incidencias") values.priority = "normal";
  return values;
}

function StatusPill({ definition, value }: { definition: ModuleDefinition; value: string }) {
  const positive = ["active", "paid", "approved", "published", "matched", "closed", "current", "confirmed", "success", "validated", "answered", "completed"].includes(value);
  const warning = ["pending", "unmatched", "draft", "triage", "called", "scheduled", "review", "identity_check", "inventory", "maintenance_due"].includes(value);
  const danger = ["blocked", "returned", "rejected", "urgent", "error", "denied", "out_of_service"].includes(value);
  return <span className={`status-pill ${positive ? "positive" : warning ? "warning" : danger ? "danger" : "neutral"}`}><span />{optionLabel(definition.statusOptions, value)}</span>;
}

function RecordIcon({ definition, row }: { definition: ModuleDefinition; row: RecordRow }) {
  return (
    <span className={`record-tile tile-${definition.key}`}>
      <Icon name={definition.icon} size={20} />
      <small>{row.code?.slice(0, 7) || definition.eyebrow.slice(0, 7)}</small>
    </span>
  );
}

function readOnlyValue(field: FieldDefinition, value: FormValues[FieldKey], row: RecordRow, preferences: TemporalPreferences) {
  if (value === "" || value === null || value === undefined) return null;
  const text = String(value);
  if (field.type === "select") return optionLabel(field.options, text);
  if (field.type === "currency") {
    const amount = Number(value);
    return Number.isFinite(amount) ? currency.format(amount) : text;
  }
  if (field.type === "date") {
    return text;
  }
  if (field.type === "datetime") {
    const raw = field.key === "eventDate" ? row.eventDate : row.dueDate;
    const precision = field.key === "eventDate" ? row.eventTimePrecision : row.dueTimePrecision;
    return formatBusinessMoment(raw, precision, preferences, {
      deadline: field.deadline,
      inclusive: field.inclusive ?? row.dueInclusive
    });
  }
  return text;
}

function ReadOnlyRecordContent({ definition, row, values }: { definition: ModuleDefinition; row: RecordRow; values: FormValues }) {
  const preferences = useTemporalPreferences();
  const kindField = definition.fields.find((field) => field.key === "kind");
  const details = definition.fields.flatMap((field) => {
    if (["title", "description", "status", "kind"].includes(field.key)) return [];
    const value = readOnlyValue(field, values[field.key], row, preferences);
    return value === null ? [] : [{ field, value }];
  });
  const paymentValue = definition.key === "economia" && row.status === "paid"
    ? row.paidAt ? formatDateTime(row.paidAt, preferences, row.paidTimePrecision === "second") : "Fecha y hora de pago no registradas"
    : null;

  return (
    <div className="readonly-record-content">
      <section className="readonly-record-summary" aria-label="Resumen del registro">
        <RecordIcon definition={definition} row={row} />
        <span>
          <small>{optionLabel(kindField?.options, row.kind)}</small>
          <StatusPill definition={definition} value={row.status} />
        </span>
      </section>
      {row.description && <section className="readonly-record-description"><small>Descripción</small><p>{row.description}</p></section>}
      {(details.length > 0 || paymentValue) && <dl className="readonly-record-facts">
        {details.map(({ field, value }) => <div className={field.type === "textarea" ? "wide" : ""} key={field.key}><dt>{field.label}</dt><dd>{value}</dd></div>)}
        {paymentValue && <div><dt>Pagado el</dt><dd>{paymentValue}</dd></div>}
      </dl>}
      {definition.key === "juntas" && <ResidentMeetingLifecycle meetingId={row.id} />}
      <aside className="readonly-record-note"><Icon name="shield-check" size={18} /><span><strong>Información de tu comunidad</strong><small>Solo se muestran los datos disponibles para tu perfil. {temporalZoneNote(preferences)}.</small></span></aside>
    </div>
  );
}

function RecordDialog({
  definition,
  row,
  values,
  file,
  busy,
  error,
  onChange,
  onFile,
  onClose,
  onSubmit,
  onArchive,
  canArchive,
  readOnly = false
}: {
  definition: ModuleDefinition;
  row: RecordRow | null;
  values: FormValues;
  file: File | null;
  busy: boolean;
  error: string;
  onChange: (key: FieldKey, value: string) => void;
  onFile: (file: File | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onArchive: () => void;
  canArchive: boolean;
  readOnly?: boolean;
}) {
  const dialogRef = useRef<HTMLElement>(null);
  const preferences = useTemporalPreferences();

  useEffect(() => {
    const previousOverflow = document.body.style.overflow;
    const previousFocus = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    document.body.style.overflow = "hidden";

    const focusableElements = () => Array.from(
      dialogRef.current?.querySelectorAll<HTMLElement>(
        'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
      ) ?? []
    ).filter((element) => !element.hasAttribute("hidden") && element.getClientRects().length > 0);

    const handleKeyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !busy) {
        event.preventDefault();
        onClose();
        return;
      }
      if (event.key !== "Tab") return;
      const focusable = focusableElements();
      if (!focusable.length) {
        event.preventDefault();
        dialogRef.current?.focus();
        return;
      }
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyboard);
    window.requestAnimationFrame(() => focusableElements()[0]?.focus());
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", handleKeyboard);
      previousFocus?.focus();
    };
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section ref={dialogRef} className="record-dialog" role="dialog" aria-modal="true" aria-labelledby="dialog-title" tabIndex={-1}>
        <header className="dialog-header">
          <div>
            <span className="eyebrow">{row ? readOnly ? "DETALLE" : "DETALLE Y EDICIÓN" : definition.eyebrow}</span>
            <h2 id="dialog-title">{row ? row.title : definition.createLabel}</h2>
            <p>{row ? `Última actualización: ${formatDateTime(row.updatedAt, preferences)} · ${preferences.timeZone}` : `Completa los datos del nuevo ${definition.singular}.`}</p>
          </div>
          <button type="button" className="icon-button" onClick={onClose} disabled={busy} aria-label="Cerrar"><Icon name="close" /></button>
        </header>
        <form onSubmit={(event) => readOnly ? event.preventDefault() : onSubmit(event)} className="dialog-form">
          <div className="dialog-scroll">
            {readOnly && row ? <ReadOnlyRecordContent definition={definition} row={row} values={values} /> : <>
              {definition.key === "documentos" && (
                <div className="upload-field">
                  <span className="upload-icon"><Icon name="upload" /></span>
                  <span><strong>{file ? file.name : row?.hasFile ? "Añadir una nueva versión" : "Selecciona el archivo"}</strong><small>PDF, imagen, DOCX, XLSX, CSV o texto · máximo 10 MB</small></span>
                  <input type="file" aria-label="Archivo" accept=".pdf,.jpg,.jpeg,.png,.docx,.xlsx,.csv,.txt" onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
                </div>
              )}
              <div className="form-grid">
                {definition.fields.map((field) => (
                  <div className={`field-group ${field.type === "textarea" ? "field-wide" : ""}`} key={field.key}>
                    <label htmlFor={`field-${field.key}`}>{field.label}{field.required && <span aria-hidden="true"> *</span>}</label>
                    {field.type === "textarea" ? (
                      <textarea id={`field-${field.key}`} value={String(values[field.key] ?? "")} onChange={(event) => onChange(field.key, event.target.value)} rows={4} maxLength={5000} required={field.required} />
                    ) : field.type === "select" ? (
                      <select id={`field-${field.key}`} value={String(values[field.key] ?? "")} onChange={(event) => onChange(field.key, event.target.value)} required={field.required}>
                        {!field.required && <option value="">Sin especificar</option>}
                        {field.options?.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}
                      </select>
                    ) : (
                      <div className={field.type === "currency" ? "input-with-suffix" : ""}>
                        <input
                          id={`field-${field.key}`}
                          type={field.type === "date" ? "date" : field.type === "datetime" ? "datetime-local" : field.type === "currency" ? "number" : field.type === "email" ? "email" : "text"}
                          value={String(values[field.key] ?? "")}
                          onChange={(event) => onChange(field.key, event.target.value)}
                          placeholder={field.placeholder}
                          step={field.type === "currency" ? "0.01" : field.type === "datetime" ? "1" : undefined}
                          required={field.required}
                          maxLength={field.type === "text" || field.type === "email" ? 300 : undefined}
                        />
                        {field.type === "currency" && <span>€</span>}
                      </div>
                    )}
                    {field.type === "datetime" && <small className="field-hint">{temporalZoneNote(preferences)}. {field.deadline ? field.inclusive === false ? "La hora de fin no se incluye." : "El instante indicado se considera incluido." : "Indica también la hora exacta."}</small>}
                  </div>
                ))}
              </div>
            </>}
            {error && <div className="form-alert" role="alert">{error}</div>}
          </div>
          <footer className="dialog-footer">
            <div>{readOnly && row?.hasFile ? <a className="button button-primary" href={`/api/documents/${row.id}/download`}><Icon name="download" size={17} /> Descargar archivo</a> : !readOnly && row && canArchive ? <button className="button button-danger-ghost" type="button" onClick={onArchive} disabled={busy}><Icon name="trash" size={17} /> Archivar</button> : null}</div>
            <div className="dialog-footer-actions">
              <button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>{readOnly ? "Cerrar" : "Cancelar"}</button>
              {!readOnly && <button className="button button-primary" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : <Icon name={row ? "badge-check" : "plus"} size={17} />}{busy ? "Guardando…" : row ? "Guardar cambios" : definition.createLabel}</button>}
            </div>
          </footer>
        </form>
      </section>
    </div>
  );
}

export function DataWorkbench({ definition, permissions, residentMode = false }: WorkbenchProps) {
  const preferences = useTemporalPreferences();
  const router = useRouter();
  const searchParams = useSearchParams();
  const [rows, setRows] = useState<RecordRow[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const deferredSearch = useDeferredValue(search);
  const [status, setStatus] = useState("");
  const [mobileToolsOpen, setMobileToolsOpen] = useState(false);
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(25);
  const [sort, setSort] = useState<"title" | "status" | "updatedAt" | "eventDate" | "amount">("updatedAt");
  const [direction, setDirection] = useState<"asc" | "desc">("desc");
  const [compact, setCompact] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [refreshKey, setRefreshKey] = useState(0);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const createRequested = permissions.write && searchParams.get("new") === "1";
  const [editing, setEditing] = useState<RecordRow | null | undefined>(() => createRequested ? null : undefined);
  const [newRequestHandled, setNewRequestHandled] = useState(createRequested);
  const [formValues, setFormValues] = useState<FormValues>(() => createRequested ? initialValues(definition, preferences, undefined, residentMode) : {});
  const [formFile, setFormFile] = useState<File | null>(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [toast, setToast] = useState("");
  const [lastArchived, setLastArchived] = useState<RecordRow | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort, direction });
      if (deferredSearch.trim()) params.set("search", deferredSearch.trim());
      if (status) params.set("status", status);
      const response = await fetch(`/api/modules/${definition.key}?${params}`, { cache: "no-store" });
      const result = await response.json();
      if (response.status === 401) { router.replace("/login"); return; }
      if (!response.ok) throw new Error(result.error || "No se han podido cargar los datos.");
      const availablePages = Math.max(1, Math.ceil(result.total / pageSize));
      if (page > availablePages) {
        setPage(availablePages);
        return;
      }
      setRows(result.rows);
      setTotal(result.total);
      setSelected(new Set());
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se han podido cargar los datos.");
    } finally {
      setLoading(false);
    }
  }, [deferredSearch, definition.key, direction, page, pageSize, router, sort, status]);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load, refreshKey]);
  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 4200);
    return () => window.clearTimeout(timeout);
  }, [toast]);
  useEffect(() => {
    const timeout = window.setTimeout(() => {
      if (!createRequested) {
        setNewRequestHandled(false);
        return;
      }
      if (!newRequestHandled) {
        setEditing(null);
        setFormValues(initialValues(definition, preferences, undefined, residentMode));
        setFormFile(null);
        setFormError("");
        setNewRequestHandled(true);
      }
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [createRequested, definition, newRequestHandled, preferences, residentMode]);

  const pages = Math.max(1, Math.ceil(total / pageSize));

  const currentStart = total ? (page - 1) * pageSize + 1 : 0;
  const currentEnd = Math.min(total, page * pageSize);
  const amountField = definition.fields.find((field) => field.key === "amount");
  const kindField = definition.fields.find((field) => field.key === "kind");
  const eventField = definition.fields.find((field) => field.key === "eventDate");
  const canSelect = permissions.archive && !definition.readOnly;
  const hasActiveFilters = Boolean(search.trim() || status);
  const residentReceipts = residentMode && definition.key === "economia";

  function openCreate() {
    setEditing(null);
    setFormValues(initialValues(definition, preferences, undefined, residentMode));
    setFormFile(null);
    setFormError("");
  }

  function openEdit(row: RecordRow) {
    setEditing(row);
    setFormValues(initialValues(definition, preferences, row));
    setFormFile(null);
    setFormError("");
  }

  function closeDialog() {
    if (saving) return;
    setEditing(undefined);
    setFormFile(null);
    setFormError("");
    if (searchParams.get("new") === "1") router.replace(`/${definition.key}`);
  }

  function updateSort(nextSort: typeof sort) {
    if (sort === nextSort) setDirection((current) => current === "asc" ? "desc" : "asc");
    else { setSort(nextSort); setDirection("asc"); }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (residentMode && (definition.key === "incidencias" || definition.key === "reservas") && !formValues.kind) {
      setFormError("Elige primero la opción que mejor encaja con tu solicitud.");
      return;
    }
    if (residentMode && definition.key === "incidencias" && editing === null && formFile) {
      if (!['image/jpeg', 'image/png'].includes(formFile.type)) {
        setFormError("La fotografía debe estar en formato JPG o PNG.");
        return;
      }
      if (formFile.size > 10 * 1024 * 1024) {
        setFormError("La fotografía supera el límite de 10 MB.");
        return;
      }
    }
    setSaving(true);
    setFormError("");
    try {
      let successMessage = editing ? "Cambios guardados correctamente." : residentMode && definition.key === "incidencias" ? "Incidencia enviada. Te avisaremos cuando haya novedades." : residentMode && definition.key === "reservas" ? "Reserva solicitada. Te avisaremos cuando esté confirmada." : `${definition.singular.charAt(0).toUpperCase()}${definition.singular.slice(1)} creado correctamente.`;
      if (definition.key === "documentos" && editing === null && formFile) {
        const data = new FormData();
        Object.entries(formValues).forEach(([key, value]) => data.set(key, String(value ?? "")));
        data.set("file", formFile);
        const response = await fetch("/api/documents/upload", { method: "POST", body: data });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No se ha podido subir el documento.");
      } else {
        const isEdit = Boolean(editing);
        const submission = residentMode ? prepareResidentSubmission(definition, formValues, editing ?? null) : formValues;
        const response = await fetch(isEdit ? `/api/modules/${definition.key}/${editing?.id}` : `/api/modules/${definition.key}`, {
          method: isEdit ? "PATCH" : "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(isEdit ? { ...submission, version: editing?.version } : submission)
        });
        const result = await response.json();
        if (!response.ok) throw new Error(result.error || "No se han podido guardar los cambios.");
        if (residentMode && definition.key === "incidencias" && editing === null && formFile) {
          const data = new FormData();
          data.set("file", formFile);
          data.set("caption", "Fotografía aportada al comunicar la incidencia");
          try {
            const attachmentResponse = await fetch(`/api/operations/tickets/${result.row.id}/attachments`, { method: "POST", body: data });
            if (!attachmentResponse.ok) {
              successMessage = "La incidencia se ha enviado, pero la fotografía no pudo adjuntarse. Puedes añadirla después desde el seguimiento.";
            }
          } catch {
            successMessage = "La incidencia se ha enviado, pero la fotografía no pudo adjuntarse. Puedes añadirla después desde el seguimiento.";
          }
        }
        if (definition.key === "documentos" && editing && formFile) {
          const data = new FormData();
          data.set("file", formFile);
          const versionResponse = await fetch(`/api/documents/${editing.id}/versions`, { method: "POST", body: data });
          const versionResult = await versionResponse.json();
          if (!versionResponse.ok) throw new Error(versionResult.error || "Los datos se guardaron, pero el archivo no pudo versionarse.");
        }
      }
      setToast(successMessage);
      setEditing(undefined);
      setFormFile(null);
      setRefreshKey((value) => value + 1);
      if (searchParams.get("new") === "1") router.replace(`/${definition.key}`);
    } catch (submitError) {
      setFormError(submitError instanceof Error ? submitError.message : "No se han podido guardar los cambios.");
    } finally {
      setSaving(false);
    }
  }

  async function archive(row: RecordRow) {
    if (!window.confirm(`¿Archivar “${row.title}”? Podrás deshacerlo mientras permanezcas en esta pantalla.`)) return;
    setSaving(true);
    setFormError("");
    try {
      const response = await fetch(`/api/modules/${definition.key}/${row.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: row.version }) });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se ha podido archivar.");
      setLastArchived(result.row);
      setEditing(undefined);
      setToast("Registro archivado.");
      setRefreshKey((value) => value + 1);
    } catch (archiveError) {
      const message = archiveError instanceof Error ? archiveError.message : "No se ha podido archivar.";
      if (editing !== undefined) setFormError(message); else setError(message);
    } finally {
      setSaving(false);
    }
  }

  async function archiveSelected() {
    const chosen = rows.filter((row) => selected.has(row.id));
    if (!chosen.length || !window.confirm(`¿Archivar ${chosen.length} registros seleccionados?`)) return;
    let archivedCount = 0;
    setError("");
    for (const row of chosen) {
      const response = await fetch(`/api/modules/${definition.key}/${row.id}`, { method: "DELETE", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ version: row.version }) });
      if (!response.ok) {
        const result = await response.json();
        setError(`Se archivaron ${archivedCount} de ${chosen.length}. ${result.error || "No se pudo completar el archivado."}`);
        break;
      }
      archivedCount += 1;
    }
    if (archivedCount > 0) {
      setToast(`${archivedCount} ${archivedCount === 1 ? "registro archivado" : "registros archivados"}.`);
      setSelected(new Set());
      setRefreshKey((value) => value + 1);
    }
  }

  async function undoArchive() {
    if (!lastArchived) return;
    const response = await fetch(`/api/modules/${definition.key}/${lastArchived.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ restore: true, version: lastArchived.version }) });
    const result = await response.json();
    if (!response.ok) { setError(result.error || "No se ha podido restaurar el registro."); return; }
    setLastArchived(null);
    setToast("Registro restaurado.");
    setRefreshKey((value) => value + 1);
  }

  const selectedAll = rows.length > 0 && rows.every((row) => selected.has(row.id));
  const exportUrl = useMemo(() => {
    const params = new URLSearchParams();
    if (deferredSearch.trim()) params.set("search", deferredSearch.trim());
    if (status) params.set("status", status);
    return `/api/modules/${definition.key}/export?${params}`;
  }, [deferredSearch, definition.key, status]);

  const residentCopy = definition.key === "economia"
    ? { eyebrow: "MI ECONOMÍA", title: "Mis recibos", description: "Cuotas, recibos y pagos.", listTitle: "Recibos y cuotas", listHelp: "Importe, estado y fecha de cada concepto." }
    : definition.key === "incidencias"
      ? { eyebrow: "MANTENIMIENTO", title: "Tus incidencias", description: "Comunica un problema y sigue su estado.", listTitle: "Solicitudes comunicadas", listHelp: "Consulta o actualiza una incidencia." }
      : definition.key === "reservas"
        ? { eyebrow: "ESPACIOS COMUNES", title: "Tus reservas", description: "Reserva un espacio y consulta su confirmación.", listTitle: "Reservas solicitadas", listHelp: "Pendientes, confirmadas y finalizadas." }
        : definition.key === "juntas"
          ? { eyebrow: "GOBIERNO", title: "Juntas y acuerdos", description: "Convocatorias, acuerdos y actas.", listTitle: "Juntas y acuerdos", listHelp: "Consulta la convocatoria y sus documentos." }
          : definition.key === "avisos"
            ? { eyebrow: "COMUNICACIÓN", title: "Avisos", description: "Información importante de tu comunidad.", listTitle: "Avisos", listHelp: "Consulta el aviso completo." }
            : { eyebrow: definition.eyebrow, title: definition.title, description: definition.description, listTitle: definition.title, listHelp: "Consulta todos los detalles." };

  return (
    <div className={`page module-page ${residentMode ? "resident-workbench" : ""} ${residentReceipts ? "resident-receipts-workbench" : ""} ${expanded ? "workbench-expanded" : ""}`}>
      <div className="module-breadcrumb"><Link href="/inicio">← {residentMode ? "Volver" : "Inicio"}</Link>{!residentMode && <><span>/</span><span>{definition.eyebrow.toLowerCase()}</span></>}</div>
      <div className="page-heading module-heading">
        <div>
          <span className="eyebrow">{residentMode ? residentCopy.eyebrow : definition.eyebrow}</span>
          <h1>{residentMode ? residentCopy.title : definition.title}</h1>
          <p>{residentMode ? residentCopy.description : definition.description}</p>
        </div>
        <div className="heading-actions">
          {residentMode && <button type="button" className={`icon-button resident-mobile-tools ${mobileToolsOpen || hasActiveFilters ? "active" : ""}`} onClick={() => setMobileToolsOpen((value) => !value)} aria-expanded={mobileToolsOpen} aria-controls="resident-record-tools" title="Buscar y filtrar"><Icon name="filter" size={19} /><span className="sr-only">Buscar y filtrar</span>{hasActiveFilters && <span className="resident-filter-dot" />}</button>}
          {!residentMode && <Link className="button button-secondary" href="/inicio"><Icon name="dashboard" size={17} /> Ver resumen</Link>}
          {permissions.write && !definition.readOnly && <button className="button button-primary" onClick={openCreate}><Icon name="plus" size={18} /> {definition.createLabel}</button>}
        </div>
      </div>

      {residentReceipts && <ResidentFeeForecast />}
      <section className={`data-card ${compact ? "compact" : ""}`}>
        <div className={`data-card-top ${residentMode && mobileToolsOpen ? "mobile-tools-open" : ""}`} id={residentMode ? "resident-record-tools" : undefined}>
          <div className="data-card-title"><span className="section-chip">{residentMode ? "TU ESPACIO" : "GESTIÓN"}</span><span><strong>{residentMode ? residentCopy.listTitle : definition.title}</strong><small>{residentMode ? residentCopy.listHelp : "Selecciona un registro para consultar todos sus detalles"}</small></span></div>
          <div className="table-toolbar">
            <label className="search-control"><Icon name="search" size={18} /><span className="sr-only">Buscar</span><input value={search} onChange={(event) => { setSearch(event.target.value); setPage(1); }} placeholder="Buscar…" /></label>
            <select className="filter-control" value={status} onChange={(event) => { setStatus(event.target.value); setPage(1); }} aria-label="Filtrar por estado"><option value="">Todos los estados</option>{definition.statusOptions.map((item) => <option value={item.value} key={item.value}>{item.label}</option>)}</select>
            {selected.size > 0 && permissions.archive && <button className="button button-danger-ghost toolbar-labeled" onClick={archiveSelected}><Icon name="trash" size={17} /> Archivar ({selected.size})</button>}
            {!residentMode && permissions.write && !definition.readOnly && <button className="button button-primary toolbar-labeled" onClick={openCreate}><Icon name="plus" size={17} /> <span>{definition.singular}</span></button>}
            <button className="icon-button bordered" onClick={() => setRefreshKey((value) => value + 1)} aria-label="Actualizar tabla"><Icon name="refresh-cw" size={18} className={loading ? "spin" : ""} /></button>
            {permissions.export && <a className="button button-secondary toolbar-labeled" href={exportUrl}><Icon name="download" size={17} /> <span>Exportar</span></a>}
            {!residentMode && <button className={`button button-secondary toolbar-labeled ${compact ? "active" : ""}`} onClick={() => setCompact((value) => !value)}><Icon name="archive" size={17} /> <span>{compact ? "Cómoda" : "Compacta"}</span></button>}
            {!residentMode && <button className="button button-secondary toolbar-labeled" onClick={() => setExpanded((value) => !value)}><Icon name={expanded ? "minimize" : "maximize"} size={17} /> <span>{expanded ? "Reducir" : "Ampliar"}</span></button>}
            {lastArchived && <button className="icon-button bordered" onClick={undoArchive} aria-label="Deshacer último archivado" title="Deshacer"><Icon name="undo" size={18} /></button>}
          </div>
        </div>

        {error && <div className="table-error" role="alert"><span>{error}</span><button onClick={() => setRefreshKey((value) => value + 1)}>Reintentar</button></div>}

        <div className="table-scroll">
          <table className="data-table">
            <caption className="sr-only">{residentCopy.listTitle}. {residentCopy.listHelp}</caption>
            <thead><tr>
              {canSelect && <th className="check-column"><input type="checkbox" aria-label="Seleccionar página" checked={selectedAll} onChange={(event) => setSelected(event.target.checked ? new Set(rows.map((row) => row.id)) : new Set())} /></th>}
              <th className="grip-column" />
              <th className="record-column" aria-sort={sort === "title" ? direction === "asc" ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => updateSort("title")} aria-label={`Ordenar por registro${sort === "title" ? `, orden ${direction === "asc" ? "ascendente" : "descendente"}` : ""}`}>{residentReceipts ? "Recibo" : "Registro"} <span>{sort === "title" ? direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>
              <th className="detail-column">{residentReceipts ? "Importe" : "Tipo / detalle"}</th>
              <th className="status-column" aria-sort={sort === "status" ? direction === "asc" ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => updateSort("status")} aria-label={`Ordenar por estado${sort === "status" ? `, orden ${direction === "asc" ? "ascendente" : "descendente"}` : ""}`}>Estado <span>{sort === "status" ? direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>
              <th className="updated-column" aria-sort={sort === (eventField ? "eventDate" : "updatedAt") ? direction === "asc" ? "ascending" : "descending" : "none"}><button className="sort-button" onClick={() => updateSort(eventField ? "eventDate" : "updatedAt")} aria-label={`Ordenar por ${eventField?.label.toLowerCase() ?? "fecha de actualización"}${sort === (eventField ? "eventDate" : "updatedAt") ? `, orden ${direction === "asc" ? "ascendente" : "descendente"}` : ""}`}>{eventField?.label ?? "Última actualización"} <span>{sort === (eventField ? "eventDate" : "updatedAt") ? direction === "asc" ? "↑" : "↓" : "↕"}</span></button></th>
              <th className="actions-column"><span className="sr-only">Acciones</span></th>
            </tr></thead>
            <tbody>
              {loading && rows.length === 0 ? Array.from({ length: 5 }).map((_, index) => <tr className="skeleton-row" key={index}><td colSpan={canSelect ? 7 : 6}><span /></td></tr>) : rows.map((row) => (
                <tr key={row.id}>
                  {canSelect && <td className="check-column"><input type="checkbox" aria-label={`Seleccionar ${row.title}`} checked={selected.has(row.id)} onChange={(event) => setSelected((current) => { const next = new Set(current); if (event.target.checked) next.add(row.id); else next.delete(row.id); return next; })} /></td>}
                  <td className="grip-column"><Icon name="grip" size={14} /></td>
                  <td className="record-column">
                    <button className="record-primary" onClick={() => openEdit(row)} aria-label={`Abrir ${row.title}`}>
                      <RecordIcon definition={definition} row={row} />
                      <span><strong>{row.title}</strong><small>{row.description || row.code || `Registro de ${definition.singular}`}</small></span>
                    </button>
                  </td>
                  <td className="detail-column"><span className="kind-label">{optionLabel(kindField?.options, row.kind)}</span>{row.lifecycle ? <span className={`meeting-lifecycle-summary summary-${row.lifecycle.overallStatus}`}><b>{row.lifecycle.completed}/{row.lifecycle.total} hitos</b><small>{row.lifecycle.phaseLabel}{row.lifecycle.nextTitle ? ` · Siguiente: ${row.lifecycle.nextTitle}` : ""}</small></span> : amountField && row.amount !== null ? <strong className="amount-value">{currency.format(row.amount)}</strong> : <small>{row.location || row.contact || row.code || "—"}</small>}</td>
                  <td className="status-column"><StatusPill definition={definition} value={row.status} />{definition.key === "economia" && row.status === "paid" && <small>{row.paidAt ? `Pagado el ${formatDateTime(row.paidAt, preferences, row.paidTimePrecision === "second")}` : "Hora de pago no registrada"}</small>}</td>
                  <td className="updated-cell"><span>{row.eventDate ? formatBusinessMoment(row.eventDate, row.eventTimePrecision, preferences) : formatDateTime(row.updatedAt, preferences)}</span><small>{row.eventDate ? `Actualizado ${formatDateTime(row.updatedAt, preferences)}` : temporalZoneNote(preferences)}</small></td>
                  <td className="actions-column"><div className="row-actions">
                    {definition.key === "documentos" && row.hasFile && <a className="icon-button" href={`/api/documents/${row.id}/download`} aria-label={`Descargar ${row.title}`} title="Descargar"><Icon name="download" size={17} /></a>}
                    <button className="icon-button" onClick={() => openEdit(row)} aria-label={`Abrir ${row.title}`} title="Abrir"><Icon name={permissions.write ? "pencil" : "more"} size={17} /></button>
                    {permissions.archive && <button className="icon-button" onClick={() => archive(row)} aria-label={`Archivar ${row.title}`} title="Archivar"><Icon name="trash" size={17} /></button>}
                  </div></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>

        <div className="mobile-record-list" aria-label={`${residentCopy.listTitle} en tarjetas`}>
          {loading && rows.length === 0 ? Array.from({ length: 3 }).map((_, index) => (
            <article className="mobile-record mobile-record-skeleton" key={index} aria-hidden="true"><span /><span /><span /></article>
          )) : rows.map((row) => (
            <article className="mobile-record" key={row.id}>
              <button type="button" className="mobile-record-button" onClick={() => openEdit(row)} aria-label={`Abrir ${row.title}`}>
                <span className="mobile-record-top">
                  <RecordIcon definition={definition} row={row} />
                  <StatusPill definition={definition} value={row.status} />
                </span>
                <span className="mobile-record-copy">
                  <strong>{row.title}</strong>
                  <small>{row.description || row.code || `Registro de ${definition.singular}`}</small>
                </span>
                {(!residentMode || (amountField && row.amount !== null) || row.eventDate) && <span className="mobile-record-facts">
                  {!residentMode && <span><small>Tipo</small><strong>{optionLabel(kindField?.options, row.kind)}</strong></span>}
                  {amountField && row.amount !== null && <span title="Importe" aria-label={`Importe: ${currency.format(row.amount)}`}><Icon name="wallet" size={17} /><strong>{currency.format(row.amount)}</strong></span>}
                  {row.eventDate && <span title={eventField?.label ?? "Fecha y hora"} aria-label={`${eventField?.label ?? "Fecha y hora"}: ${formatBusinessMoment(row.eventDate, row.eventTimePrecision, preferences)}`}><Icon name="calendar-check" size={17} /><strong>{formatBusinessMoment(row.eventDate, row.eventTimePrecision, preferences)}</strong></span>}
                </span>}
                {row.lifecycle && <span className={`meeting-lifecycle-summary mobile summary-${row.lifecycle.overallStatus}`}><span><b>{row.lifecycle.completed}/{row.lifecycle.total} hitos · {row.lifecycle.phaseLabel}</b><small>{row.lifecycle.nextTitle ? `Siguiente: ${row.lifecycle.nextTitle}` : "Expediente completado"}</small></span><em>{row.lifecycle.progress}%</em></span>}
                <span className="mobile-record-footer">
                  <small className="resident-record-updated">Actualizado {formatDateTime(row.updatedAt, preferences)} · {preferences.timeZone}</small>
                  <b>Ver detalle <span aria-hidden>→</span></b>
                </span>
              </button>
              {definition.key === "documentos" && row.hasFile && (
                <a className="mobile-record-download" href={`/api/documents/${row.id}/download`} aria-label={`Descargar ${row.title}`}>
                  <Icon name="download" size={17} /> Descargar
                </a>
              )}
            </article>
          ))}
        </div>

        {!loading && rows.length === 0 && !error && <div className="empty-state"><span><Icon name={definition.icon} /></span><h3>{residentMode && !search && !status ? `Aún no tienes ${definition.title.toLowerCase()}` : "No hay resultados"}</h3><p>{search || status ? "Prueba con otros filtros." : residentMode ? "Cuando hagas una solicitud, podrás seguirla desde aquí." : `Todavía no se ha creado ningún ${definition.singular}.`}</p>{permissions.write && !definition.readOnly && <button className="button button-primary" onClick={openCreate}><Icon name="plus" size={17} /> {definition.createLabel}</button>}</div>}

        <footer className={`table-footer ${pages === 1 ? "single-page" : ""}`}>
          <span>Mostrando {currentStart}–{currentEnd} de {total}</span>
          {pages > 1 && <div className="pagination"><label>Filas <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option>10</option><option>25</option><option>50</option><option>100</option></select></label><button className="button button-secondary" disabled={page <= 1} onClick={() => setPage((value) => value - 1)}>Anterior</button><span>{page} / {pages}</span><button className="button button-secondary" disabled={page >= pages} onClick={() => setPage((value) => value + 1)}>Siguiente</button></div>}
        </footer>
      </section>

      {editing !== undefined && permissions.write && residentMode && (definition.key === "incidencias" || definition.key === "reservas") && (
        <ResidentTaskDialog
          definition={definition}
          row={editing}
          values={formValues}
          busy={saving}
          error={formError}
          file={formFile}
          onChange={(key, value) => setFormValues((current) => ({ ...current, [key]: value }))}
          onFile={setFormFile}
          onClose={closeDialog}
          onSubmit={submit}
        />
      )}
      {editing !== undefined && !(permissions.write && residentMode && (definition.key === "incidencias" || definition.key === "reservas")) && (
        <RecordDialog
          definition={definition}
          row={editing}
          values={formValues}
          file={formFile}
          busy={saving}
          error={formError}
          onChange={(key, value) => setFormValues((current) => ({ ...current, [key]: value }))}
          onFile={setFormFile}
          onClose={closeDialog}
          onSubmit={submit}
          onArchive={() => editing && archive(editing)}
          canArchive={permissions.archive}
          readOnly={!permissions.write}
        />
      )}
      {toast && <div className="toast" role="status"><Icon name="badge-check" size={18} />{toast}</div>}
    </div>
  );
}
