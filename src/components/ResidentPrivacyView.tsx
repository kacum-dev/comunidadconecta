"use client";

import { useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { ResidentPrivacyData } from "@/lib/resident-privacy";
import { formatDateTime, type TemporalPreferences } from "@/lib/temporal";
import { Icon } from "./Icon";

const requestLabels: Record<string, string> = {
  access: "Acceder a mis datos",
  rectification: "Corregir mis datos",
  erasure: "Solicitar la supresión",
  opposition: "Oponerme a un tratamiento",
  restriction: "Limitar un tratamiento",
  portability: "Solicitar portabilidad"
};

const statusLabels: Record<string, string> = {
  identity_check: "Comprobando identidad",
  received: "Recibida",
  in_progress: "En tramitación",
  completed: "Completada",
  closed: "Cerrada",
  rejected: "No estimada"
};

export function ResidentPrivacyView({
  initialData,
  initialSimpleMode,
  isDemo,
  preferences
}: {
  initialData: ResidentPrivacyData;
  initialSimpleMode: boolean;
  isDemo: boolean;
  preferences: TemporalPreferences;
}) {
  const router = useRouter();
  const [data, setData] = useState(initialData);
  const [simpleMode, setSimpleMode] = useState(initialSimpleMode);
  const [kind, setKind] = useState("access");
  const [description, setDescription] = useState("");
  const [savingPreference, setSavingPreference] = useState(false);
  const [sending, setSending] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  async function changeReadingMode(enabled: boolean) {
    setSavingPreference(true);
    setError("");
    try {
      const response = await fetch("/api/profile/preferences", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ simpleMode: enabled })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se ha podido guardar la preferencia.");
      setSimpleMode(result.simpleMode);
      setNotice(result.simpleMode ? "Lectura cómoda activada." : "Lectura estándar activada.");
      router.refresh();
    } catch (preferenceError) {
      setError(preferenceError instanceof Error ? preferenceError.message : "No se ha podido guardar la preferencia.");
    } finally {
      setSavingPreference(false);
    }
  }

  async function sendRequest(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSending(true);
    setError("");
    setNotice("");
    try {
      const response = await fetch("/api/privacy/self-service", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind, description })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se ha podido registrar la solicitud.");
      const refreshed = await fetch("/api/privacy/self-service", { cache: "no-store" });
      if (refreshed.ok) setData(await refreshed.json());
      setDescription("");
      setNotice("Solicitud registrada. Podrás seguir su estado en esta misma pantalla.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se ha podido registrar la solicitud.");
    } finally {
      setSending(false);
    }
  }

  return (
    <div className="page resident-privacy-page">
      <header className="resident-privacy-heading">
        <div>
          <span className="eyebrow">AYUDA Y PRIVACIDAD</span>
          <h1>Tu información, explicada con claridad</h1>
          <p>Aquí puedes comprobar qué ves, para qué se usan tus datos, pedir una corrección y adaptar la lectura.</p>
        </div>
        <span className="resident-privacy-shield"><Icon name="shield-check" size={29} /></span>
      </header>

      {(error || notice) && <div className={`resident-privacy-message ${error ? "error" : "success"}`} role={error ? "alert" : "status"}>{error || notice}</div>}

      <section className="resident-reading-card" aria-labelledby="reading-mode-title">
        <span><Icon name="book" size={23} /></span>
        <div><h2 id="reading-mode-title">Lectura cómoda</h2><p>Aumenta textos, botones y espacios de lectura en tu área de propietario.</p></div>
        <label className="resident-switch">
          <input type="checkbox" checked={simpleMode} disabled={savingPreference || isDemo} onChange={(event) => void changeReadingMode(event.target.checked)} />
          <span aria-hidden />
          <strong>{simpleMode ? "Activada" : "Desactivada"}</strong>
        </label>
        {isDemo && <small>En la demo puedes verla, pero la preferencia no se guarda.</small>}
      </section>

      <div className="resident-privacy-grid">
        <section className="resident-privacy-panel" aria-labelledby="privacy-access-title">
          <header><span><Icon name="home" size={20} /></span><div><span className="eyebrow">TU ACCESO</span><h2 id="privacy-access-title">Qué puedes consultar</h2></div></header>
          <dl className="resident-identity-list">
            <div><dt>Cuenta</dt><dd>{data.identity.fullName}<small>{data.identity.email}</small></dd></div>
            <div><dt>Vivienda</dt><dd>{data.identity.homeCode ?? "Pendiente de vincular"}</dd></div>
          </dl>
          <ul className="resident-privacy-checks">
            <li><Icon name="badge-check" size={17} />Tus datos de vivienda y, si eres propietario, tus propios recibos.</li>
            <li><Icon name="badge-check" size={17} />Las incidencias y reservas vinculadas contigo o con tu vivienda.</li>
            <li><Icon name="badge-check" size={17} />Los avisos y documentos publicados para tu perfil.</li>
            <li><Icon name="shield-check" size={17} />No tienes acceso a la información privada de otras viviendas.</li>
          </ul>
        </section>

        <section className="resident-privacy-panel" aria-labelledby="privacy-help-title">
          <header><span><Icon name="help" size={20} /></span><div><span className="eyebrow">NECESITO AYUDA</span><h2 id="privacy-help-title">Contacta con tu comunidad</h2></div></header>
          <p className="resident-privacy-copy">La comunidad es responsable del tratamiento. La administración atiende las gestiones en su nombre y según sus instrucciones.</p>
          <div className="resident-contact-actions">
            {data.community.contactEmail && <a className="button button-primary" href={`mailto:${data.community.contactEmail}`}><Icon name="megaphone" size={17} /> Escribir por correo</a>}
            {data.community.phone && <a className="button button-secondary" href={`tel:${data.community.phone.replace(/\s+/g, "")}`}><Icon name="help" size={17} /> Llamar</a>}
            {!data.community.contactEmail && !data.community.phone && <p>La comunidad todavía no ha publicado un contacto. Solicítalo a Presidencia o Administración.</p>}
          </div>
          <small>Las acciones relevantes, como descargas, cambios de acceso y solicitudes, quedan registradas sin copiar su contenido sensible al historial de auditoría.</small>
        </section>
      </div>

      <section className="resident-privacy-panel resident-treatment-panel" aria-labelledby="treatments-title">
        <header><span><Icon name="info" size={20} /></span><div><span className="eyebrow">TRANSPARENCIA</span><h2 id="treatments-title">Para qué se utilizan los datos</h2></div></header>
        {data.activities.length ? <div className="resident-treatment-list">{data.activities.map((activity) => (
          <details key={activity.id}>
            <summary><strong>{activity.name}</strong><span>Ver explicación</span></summary>
            <dl>
              <div><dt>Finalidad</dt><dd>{activity.purpose}</dd></div>
              <div><dt>Base jurídica</dt><dd>{activity.legalBasis}</dd></div>
              <div><dt>Datos utilizados</dt><dd>{activity.dataCategories}</dd></div>
              <div><dt>Quién puede recibirlos</dt><dd>{activity.recipients}</dd></div>
              <div><dt>Conservación</dt><dd>{activity.retentionPeriod}</dd></div>
            </dl>
          </details>
        ))}</div> : <div className="resident-privacy-empty"><Icon name="alert-triangle" size={20} /><span><strong>Falta publicar esta información</strong><small>La comunidad debe completar su registro de actividades para mostrar aquí finalidades, destinatarios y plazos reales.</small></span></div>}
      </section>

      <div className="resident-privacy-grid resident-rights-grid">
        <section className="resident-privacy-panel" aria-labelledby="rights-title">
          <header><span><Icon name="pencil" size={20} /></span><div><span className="eyebrow">TUS DERECHOS</span><h2 id="rights-title">Solicita acceso o corrección</h2></div></header>
          <form className="resident-rights-form" onSubmit={sendRequest}>
            <label><span>¿Qué necesitas?</span><select value={kind} onChange={(event) => setKind(event.target.value)}>{Object.entries(requestLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            <label><span>Explícalo brevemente</span><textarea value={description} onChange={(event) => setDescription(event.target.value)} rows={5} minLength={10} maxLength={2000} placeholder="Por ejemplo: necesito corregir el teléfono asociado a mi vivienda…" required /></label>
            <div className="resident-rights-note"><Icon name="info" size={17} /><span>Antes de responder, la administración comprobará tu identidad. La solicitud y sus plazos quedarán registrados.</span></div>
            <button className="button button-primary" type="submit" disabled={sending || isDemo}>{sending ? <span className="spinner" /> : <Icon name="badge-check" size={17} />}{sending ? "Registrando…" : "Registrar solicitud"}</button>
          </form>
        </section>

        <section className="resident-privacy-panel" aria-labelledby="requests-title">
          <header><span><Icon name="scroll-text" size={20} /></span><div><span className="eyebrow">SEGUIMIENTO</span><h2 id="requests-title">Tus solicitudes</h2></div></header>
          {data.requests.length ? <div className="resident-request-list">{data.requests.map((request) => (
            <article key={request.id}>
              <span><strong>{requestLabels[request.kind] ?? request.kind}</strong><small>Recibida el {formatDateTime(request.receivedAt, preferences)}</small></span>
              <span className="status-pill neutral">{statusLabels[request.status] ?? request.status.replaceAll("_", " ")}</span>
              <small>Fecha límite registrada: {formatDateTime(request.legalDueAt, preferences)}</small>
            </article>
          ))}</div> : <div className="resident-privacy-empty"><Icon name="badge-check" size={20} /><span><strong>No tienes solicitudes abiertas</strong><small>Cuando registres una, aparecerá aquí con su estado.</small></span></div>}
        </section>
      </div>
    </div>
  );
}
