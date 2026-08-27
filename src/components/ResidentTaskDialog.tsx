"use client";

import { useEffect, useRef, useState, type FormEvent } from "react";
import type { FieldKey, ModuleDefinition } from "@/lib/modules";
import { optionLabel } from "@/lib/modules";
import type { RecordRow } from "@/lib/records";
import { temporalZoneNote, toDateTimeLocal } from "@/lib/temporal";
import { Icon } from "./Icon";
import { useTemporalPreferences } from "./TemporalContext";

type FormValues = Partial<Record<FieldKey, string | number>>;

interface ResidentTaskDialogProps {
  definition: ModuleDefinition;
  row: RecordRow | null;
  values: FormValues;
  busy: boolean;
  error: string;
  file: File | null;
  onChange: (key: FieldKey, value: string) => void;
  onFile: (file: File | null) => void;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
}

const incidentKinds = [
  { value: "water", label: "Agua o humedad", help: "Fugas, goteras o malos olores", icon: "droplets" },
  { value: "elevator", label: "Ascensor", help: "Parado, ruido o funcionamiento extraño", icon: "arrow-up-down" },
  { value: "electricity", label: "Electricidad", help: "Luz, portero o instalación eléctrica", icon: "zap" },
  { value: "cleaning", label: "Limpieza", help: "Suciedad o retirada de residuos", icon: "sparkles" },
  { value: "security", label: "Seguridad", help: "Puertas, accesos o riesgo para personas", icon: "shield-check" },
  { value: "maintenance", label: "Mantenimiento", help: "Algo roto o que necesita revisión", icon: "wrench" },
  { value: "other", label: "Otra cosa", help: "Cuéntanoslo con tus palabras", icon: "more" }
] as const;

const incidentLocations = ["Dentro de mi vivienda", "Portal o escalera", "Ascensor", "Garaje", "Zona común", "Fachada o cubierta"];

const urgencyOptions = [
  { value: "low", label: "Puede esperar", help: "No impide usar nada" },
  { value: "normal", label: "Necesita atención", help: "Conviene revisarlo pronto" },
  { value: "high", label: "Es importante", help: "Afecta al uso normal" },
  { value: "urgent", label: "Hay peligro ahora", help: "Existe riesgo para personas o bienes" }
] as const;

const reservationKinds = [
  { value: "community_room", label: "Sala comunitaria", icon: "building" },
  { value: "pool", label: "Piscina", icon: "sparkles" },
  { value: "sports", label: "Pista deportiva", icon: "activity" },
  { value: "moving", label: "Mudanza", icon: "home" },
  { value: "resource", label: "Otro espacio", icon: "calendar-check" }
] as const;

function ChoiceButton({ selected, icon, label, help, onClick }: { selected: boolean; icon: string; label: string; help?: string; onClick: () => void }) {
  return (
    <button type="button" className={`guided-choice ${selected ? "selected" : ""}`} aria-pressed={selected} onClick={onClick}>
      <span className="guided-choice-icon"><Icon name={icon} size={22} /></span>
      <span><strong>{label}</strong>{help && <small>{help}</small>}</span>
      <span className="guided-choice-check"><Icon name="badge-check" size={18} /></span>
    </button>
  );
}

export function ResidentTaskDialog({ definition, row, values, file, busy, error, onChange, onFile, onClose, onSubmit }: ResidentTaskDialogProps) {
  const incident = definition.key === "incidencias";
  const preferences = useTemporalPreferences();
  const [reviewing, setReviewing] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const kind = incidentKinds.find((item) => item.value === values.kind);
  const urgency = urgencyOptions.find((item) => item.value === values.priority);

  function submitOrReview(event: FormEvent<HTMLFormElement>) {
    if (incident && !row && !reviewing) {
      event.preventDefault();
      setReviewing(true);
      scrollRef.current?.scrollTo({ top: 0, behavior: "smooth" });
      return;
    }
    onSubmit(event);
  }

  useEffect(() => {
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const closeOnEscape = (event: KeyboardEvent) => { if (event.key === "Escape" && !busy) onClose(); };
    document.addEventListener("keydown", closeOnEscape);
    return () => {
      document.body.style.overflow = previous;
      document.removeEventListener("keydown", closeOnEscape);
    };
  }, [busy, onClose]);

  return (
    <div className="modal-backdrop guided-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="record-dialog guided-dialog" role="dialog" aria-modal="true" aria-labelledby="resident-task-title">
        <header className="dialog-header guided-header">
          <span className={`guided-header-icon ${incident ? "incident" : "reservation"}`}><Icon name={incident ? "wrench" : "calendar-check"} size={24} /></span>
          <div>
            <span className="eyebrow">{reviewing ? "REVISA ANTES DE ENVIAR" : row ? "ACTUALIZAR" : "TE AYUDAMOS PASO A PASO"}</span>
            <h2 id="resident-task-title">{reviewing ? "Comprueba tu incidencia" : incident ? "¿Qué ha ocurrido?" : "¿Qué quieres reservar?"}</h2>
            <p>{reviewing ? "Nada se enviará hasta que pulses Confirmar y enviar." : incident ? "Cuéntanos lo necesario. La administración se encargará de clasificarlo y buscar una solución." : "Elige el espacio y el horario exacto. Te confirmaremos la reserva cuando esté revisada."}</p>
          </div>
          <button type="button" className="icon-button guided-close" onClick={onClose} disabled={busy} aria-label="Cerrar"><Icon name="close" /></button>
        </header>

        <form className="dialog-form" onSubmit={submitOrReview}>
          <div className="dialog-scroll guided-scroll" ref={scrollRef}>
            <div className="guided-reassurance"><Icon name="shield-check" size={18} /><span><strong>{reviewing ? "Todavía puedes volver y corregirlo" : "Solo te pediremos lo necesario"}</strong><small>{reviewing ? "La incidencia quedará registrada cuando confirmes el envío." : "No necesitas conocer términos técnicos."}</small></span></div>
            {row && <div className="guided-current-status"><span>Estado actual</span><strong>{optionLabel(definition.statusOptions, row.status)}</strong><small>La administración actualizará este estado cuando haya novedades.</small></div>}

            {incident && reviewing ? (
              <section className="incident-review" aria-labelledby="incident-review-title">
                <div className="guided-section-title"><span>5</span><div><h3 id="incident-review-title">Esto es lo que vas a enviar</h3><p>Comprueba que se entiende bien.</p></div></div>
                <dl>
                  <div><dt>Relacionado con</dt><dd>{kind?.label ?? String(values.kind ?? "—")}</dd></div>
                  <div><dt>Lugar</dt><dd>{String(values.location ?? "—")}</dd></div>
                  <div><dt>Qué está pasando</dt><dd>{String(values.description ?? "—")}</dd></div>
                  <div><dt>Urgencia</dt><dd>{urgency?.label ?? String(values.priority ?? "—")}</dd></div>
                  <div><dt>Fotografía</dt><dd>{file?.name ?? "No has añadido ninguna"}</dd></div>
                </dl>
                <div className="incident-visibility-note">
                  <Icon name="info" size={19} />
                  <span><strong>¿Quién podrá verlo?</strong><small>Las personas autorizadas para gestionar incidencias y, si se asigna una reparación, el profesional que deba atenderla. Podrás consultar el estado y añadir más información desde Incidencias.</small></span>
                </div>
              </section>
            ) : incident ? (
              <>
                <section className="guided-section" aria-labelledby="incident-kind-label">
                  <div className="guided-section-title"><span>1</span><div><h3 id="incident-kind-label">¿Con qué está relacionado?</h3><p>Elige la opción que más se parezca.</p></div></div>
                  <div className="guided-choice-grid" role="group" aria-labelledby="incident-kind-label">
                    {incidentKinds.map((item) => <ChoiceButton key={item.value} {...item} selected={values.kind === item.value} onClick={() => onChange("kind", item.value)} />)}
                  </div>
                </section>

                <section className="guided-section" aria-labelledby="incident-location-label">
                  <div className="guided-section-title"><span>2</span><div><h3 id="incident-location-label">¿Dónde ocurre?</h3><p>Puedes elegir un lugar o escribirlo.</p></div></div>
                  <div className="guided-chips" role="group" aria-labelledby="incident-location-label">
                    {incidentLocations.map((location) => <button type="button" key={location} className={values.location === location ? "selected" : ""} aria-pressed={values.location === location} onClick={() => onChange("location", location)}>{location}</button>)}
                  </div>
                  <label className="guided-field"><span>Indica el lugar con más detalle</span><input value={String(values.location ?? "")} onChange={(event) => onChange("location", event.target.value)} placeholder="Por ejemplo: portal 2, junto a los buzones" maxLength={300} required /></label>
                </section>

                <section className="guided-section" aria-labelledby="incident-description-label">
                  <div className="guided-section-title"><span>3</span><div><h3 id="incident-description-label">Cuéntanos qué está pasando</h3><p>Escribe como se lo contarías a otra persona.</p></div></div>
                  <label className="guided-field"><span className="sr-only">Descripción de lo ocurrido</span><textarea value={String(values.description ?? "")} onChange={(event) => onChange("description", event.target.value)} rows={5} placeholder="Por ejemplo: desde anoche cae agua del techo y el suelo está mojado..." maxLength={5000} required /></label>
                </section>

                <section className="guided-section" aria-labelledby="incident-urgency-label">
                  <div className="guided-section-title"><span>4</span><div><h3 id="incident-urgency-label">¿Cuánta prisa corre?</h3><p>Elige según cómo te afecta ahora.</p></div></div>
                  <div className="urgency-grid" role="group" aria-labelledby="incident-urgency-label">
                    {urgencyOptions.map((item) => <button type="button" key={item.value} className={`${values.priority === item.value ? "selected" : ""} urgency-${item.value}`} aria-pressed={values.priority === item.value} onClick={() => onChange("priority", item.value)}><span /><strong>{item.label}</strong><small>{item.help}</small></button>)}
                  </div>
                  {values.priority === "urgent" && <div className="emergency-note" role="note"><Icon name="shield-check" size={19} /><span><strong>Si hay peligro inmediato, llama primero al 112.</strong><small>Después puedes enviar la incidencia para que la comunidad haga seguimiento.</small></span></div>}
                </section>

                {!row && <section className="guided-section" aria-labelledby="incident-photo-label">
                  <div className="guided-section-title"><span>5</span><div><h3 id="incident-photo-label">Añade una fotografía si quieres</h3><p>Es opcional. Puede ayudar a entender el problema.</p></div></div>
                  <label className="guided-file-field">
                    <input type="file" accept="image/jpeg,image/png" onChange={(event) => onFile(event.target.files?.[0] ?? null)} />
                    <span><Icon name="upload" size={20} /><strong>{file ? "Cambiar fotografía" : "Elegir fotografía"}</strong><small>JPG o PNG · máximo 10 MB</small></span>
                  </label>
                  {file && <div className="guided-selected-file"><span><Icon name="badge-check" size={17} />{file.name}</span><button type="button" onClick={() => onFile(null)}>Quitar</button></div>}
                </section>}
              </>
            ) : (
              <>
                <section className="guided-section" aria-labelledby="reservation-kind-label">
                  <div className="guided-section-title"><span>1</span><div><h3 id="reservation-kind-label">Elige el espacio o servicio</h3><p>Selecciona el que quieres utilizar.</p></div></div>
                  <div className="guided-choice-grid reservation-choices" role="group" aria-labelledby="reservation-kind-label">
                    {reservationKinds.map((item) => <ChoiceButton key={item.value} {...item} selected={values.kind === item.value} onClick={() => onChange("kind", item.value)} />)}
                  </div>
                </section>

                <section className="guided-section" aria-labelledby="reservation-date-label">
                  <div className="guided-section-title"><span>2</span><div><h3 id="reservation-date-label">¿Qué día y a qué hora?</h3><p>La hora de inicio se incluye y la hora de fin no se incluye.</p></div></div>
                  <div className="guided-fields-stack">
                    <label className="guided-field guided-date"><span>Comienza el</span><input type="datetime-local" step="1" value={String(values.eventDate ?? "")} onChange={(event) => onChange("eventDate", event.target.value)} min={row ? undefined : toDateTimeLocal(new Date(), preferences)} required /></label>
                    <label className="guided-field guided-date"><span>Finaliza el (excluido)</span><input type="datetime-local" step="1" value={String(values.dueDate ?? "")} onChange={(event) => onChange("dueDate", event.target.value)} min={String(values.eventDate ?? "") || undefined} required /></label>
                    <small className="field-hint">{temporalZoneNote(preferences)}.</small>
                  </div>
                </section>

                <section className="guided-section" aria-labelledby="reservation-details-label">
                  <div className="guided-section-title"><span>3</span><div><h3 id="reservation-details-label">¿Quieres añadir algún detalle?</h3><p>Es opcional, pero puede ayudar a confirmar la reserva.</p></div></div>
                  <div className="guided-fields-stack">
                    <label className="guided-field"><span>Zona o detalle del espacio <small>(opcional)</small></span><input value={String(values.location ?? "")} onChange={(event) => onChange("location", event.target.value)} placeholder="Por ejemplo: sala grande o pista 1" maxLength={300} /></label>
                    <label className="guided-field"><span>Comentario <small>(opcional)</small></span><textarea value={String(values.description ?? "")} onChange={(event) => onChange("description", event.target.value)} rows={4} placeholder="Cuéntanos cualquier necesidad especial" maxLength={5000} /></label>
                  </div>
                </section>
              </>
            )}

            {error && <div className="form-alert guided-error" role="alert">{error}</div>}
          </div>
          <footer className="dialog-footer guided-footer">
            <button className="button button-secondary" type="button" onClick={reviewing ? () => setReviewing(false) : onClose} disabled={busy}>{reviewing ? "Volver y corregir" : "Ahora no"}</button>
            <button className="button button-primary guided-submit" type="submit" disabled={busy}>{busy ? <span className="spinner" /> : <Icon name="badge-check" size={19} />}{busy ? "Enviando…" : reviewing ? "Confirmar y enviar" : row ? "Guardar cambios" : incident ? "Revisar incidencia" : "Solicitar reserva"}</button>
          </footer>
        </form>
      </section>
    </div>
  );
}
