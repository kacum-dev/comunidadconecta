"use client";

import { useMemo, useState, type FormEvent } from "react";
import Link from "next/link";
import type { DemoAdminSettingsDTO, DemoRole } from "@/lib/demo-types";
import { Icon } from "./Icon";

function toLocalDateTime(value: string | null) {
  if (!value) return "";
  const date = new Date(value);
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

export function DemoSettingsView({ initialSettings }: { initialSettings: DemoAdminSettingsDTO }) {
  const [settings, setSettings] = useState(initialSettings);
  const [expiresAt, setExpiresAt] = useState(toLocalDateTime(initialSettings.expiresAt));
  const [accessCode, setAccessCode] = useState("");
  const [removeAccessCode, setRemoveAccessCode] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [saved, setSaved] = useState(false);
  const profileSet = useMemo(() => new Set(settings.enabledRoles), [settings.enabledRoles]);

  function toggleRole(role: DemoRole) {
    setSettings((current) => ({
      ...current,
      enabledRoles: current.enabledRoles.includes(role)
        ? current.enabledRoles.filter((item) => item !== role)
        : [...current.enabledRoles, role]
    }));
  }

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setSaved(false);
    setSaving(true);
    try {
      const payload = {
        enabled: settings.enabled,
        title: settings.title,
        description: settings.description,
        enabledRoles: settings.enabledRoles,
        sessionDurationMinutes: settings.sessionDurationMinutes,
        expiresAt: expiresAt ? new Date(expiresAt).toISOString() : null,
        ...(accessCode.trim() ? { accessCode: accessCode.trim() } : removeAccessCode ? { accessCode: null } : {})
      };
      const response = await fetch("/api/settings/demo", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload)
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se ha podido guardar el modo demo.");
      setSettings(body as DemoAdminSettingsDTO);
      setExpiresAt(toLocalDateTime(body.expiresAt));
      setAccessCode("");
      setRemoveAccessCode(false);
      setSaved(true);
    } catch (saveError) {
      setError(saveError instanceof Error ? saveError.message : "No se ha podido guardar el modo demo.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="page demo-settings-page">
      <div className="module-breadcrumb"><Link href="/configuracion">Configuración</Link><span>/</span><strong>Modo demo</strong></div>
      <header className="page-heading demo-settings-heading">
        <div><span className="eyebrow">ESCAPARATE COMERCIAL</span><h1>Modo demo</h1><p>Publica una comunidad ficticia y permite probar la aplicación con diferentes perfiles.</p></div>
        <div className={`demo-publish-status ${settings.enabled ? "enabled" : "disabled"}`}><span /><strong>{settings.enabled ? "Demo publicada" : "Demo desactivada"}</strong><small>{settings.activeSessions} sesiones activas</small></div>
      </header>

      {!settings.eligible && <div className="settings-notice danger demo-eligibility-warning"><Icon name="shield-check" size={19} /><span><strong>Esta comunidad no puede publicarse</strong><small>El modo demo solo admite comunidades marcadas como sintéticas y con cuentas ficticias. Así se evita exponer por error datos de una comunidad real.</small></span></div>}

      <form className="demo-settings-grid" onSubmit={save}>
        <section className="settings-content demo-settings-main">
          <div className="settings-panel demo-settings-panel">
            <header><span className="settings-section-icon purple"><Icon name="sparkles" /></span><span><h2>Publicación y acceso</h2><p>Control exclusivo de la superadministración de la plataforma.</p></span></header>
            <label className={`demo-master-toggle ${settings.enabled ? "is-on" : ""}`}>
              <span><strong>Permitir el acceso público a la demo</strong><small>Al desactivarlo, las sesiones demo abiertas se cierran inmediatamente.</small></span>
              <input className="sr-only" type="checkbox" checked={settings.enabled} disabled={!settings.eligible} onChange={(event) => setSettings((current) => ({ ...current, enabled: event.target.checked }))} />
              <span aria-hidden><span /></span>
            </label>

            <div className="settings-form-grid demo-copy-fields">
              <div className="field-group field-wide"><label htmlFor="demo-title">Título del acceso</label><input id="demo-title" required minLength={4} maxLength={100} value={settings.title} onChange={(event) => setSettings((current) => ({ ...current, title: event.target.value }))} /></div>
              <div className="field-group field-wide"><label htmlFor="demo-description">Mensaje para quien prueba la app</label><textarea id="demo-description" required minLength={10} maxLength={320} rows={3} value={settings.description} onChange={(event) => setSettings((current) => ({ ...current, description: event.target.value }))} /></div>
              <div className="field-group"><label htmlFor="demo-duration">Duración de cada sesión</label><select id="demo-duration" value={settings.sessionDurationMinutes} onChange={(event) => setSettings((current) => ({ ...current, sessionDurationMinutes: Number(event.target.value) }))}><option value={30}>30 minutos</option><option value={60}>1 hora</option><option value={120}>2 horas</option><option value={240}>4 horas</option></select></div>
              <div className="field-group"><label htmlFor="demo-expiration">Cerrar la demo el</label><input id="demo-expiration" type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /><small className="field-hint">Déjalo vacío para mantenerla abierta hasta que la desactives.</small></div>
            </div>

            <div className="demo-access-protection">
              <div><span><Icon name="shield-check" size={18} /></span><span><strong>Código compartido opcional</strong><small>{settings.hasAccessCode && !removeAccessCode ? "La demo está protegida con un código que nunca se vuelve a mostrar." : "Cualquier visitante podrá elegir un perfil sin contraseña."}</small></span></div>
              <div className="demo-code-row"><div className="field-group"><label htmlFor="demo-code">{settings.hasAccessCode && !removeAccessCode ? "Cambiar código" : "Nuevo código"}</label><input id="demo-code" type="password" autoComplete="new-password" minLength={6} maxLength={128} value={accessCode} disabled={removeAccessCode} onChange={(event) => setAccessCode(event.target.value)} placeholder="Mínimo 6 caracteres" /></div>{settings.hasAccessCode && <button className={`button ${removeAccessCode ? "button-secondary active" : "button-danger-ghost"}`} type="button" onClick={() => { setRemoveAccessCode((current) => !current); setAccessCode(""); }}>{removeAccessCode ? "Conservar código" : "Quitar código"}</button>}</div>
            </div>
          </div>
        </section>

        <aside className="demo-settings-side">
          <section className="demo-profile-settings-card">
            <header><span><Icon name="users" size={19} /></span><span><h2>Perfiles disponibles</h2><p>El visitante verá solo los perfiles seleccionados.</p></span></header>
            <div className="demo-profile-settings-list">
              {settings.availableProfiles.map((profile) => <label key={profile.role} className={profileSet.has(profile.role) ? "selected" : ""}><input className="sr-only" type="checkbox" checked={profileSet.has(profile.role)} onChange={() => toggleRole(profile.role)} /><span><Icon name={profile.icon} size={18} /></span><span><strong>{profile.label}</strong><small>{profile.description}</small></span><b aria-hidden>{profileSet.has(profile.role) ? "✓" : "+"}</b></label>)}
            </div>
          </section>
          <section className="demo-preview-card"><span className="eyebrow">VISTA PREVIA</span><h3>{settings.title}</h3><p>{settings.description}</p><div><Icon name="building" size={16} /><span><strong>{settings.communityName}</strong><small>Datos ficticios</small></span></div><Link className="button button-secondary full-button" href="/api/demo" target="_blank"><Icon name="sparkles" size={16} /> Comprobar publicación</Link></section>
        </aside>

        <footer className="demo-settings-footer">
          <span><Icon name="info" size={16} /> Los cambios quedan registrados; no se publican correos ni contraseñas de las cuentas internas.</span>
          <div>{error && <span className="demo-save-error" role="alert">{error}</span>}{saved && <span className="demo-save-success" role="status"><Icon name="badge-check" size={16} /> Configuración guardada</span>}<button className="button button-primary" type="submit" disabled={saving || settings.enabledRoles.length === 0}>{saving ? "Guardando…" : "Guardar modo demo"}</button></div>
        </footer>
      </form>
    </div>
  );
}
