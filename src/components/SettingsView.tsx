"use client";

import { useEffect, useState, type FormEvent } from "react";
import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import type { CommunitySettingsData, IntegrationData, OperationalSettingsData, SettingsDTO } from "@/lib/settings-types";
import { formatDateTime } from "@/lib/temporal";
import { Icon } from "./Icon";
import { useTemporalPreferences } from "./TemporalContext";

type Tab = "community" | "regional" | "notifications" | "accounting" | "backups" | "integrations";

const tabs: Array<{ id: Tab; label: string; description: string; icon: string }> = [
  { id: "community", label: "Comunidad", description: "Identidad y contacto", icon: "building" },
  { id: "regional", label: "Horario y formato", description: "Zona horaria y recibos", icon: "calendar-check" },
  { id: "notifications", label: "Avisos", description: "Canales por defecto", icon: "bell" },
  { id: "accounting", label: "Contabilidad", description: "Libro y automatización", icon: "book" },
  { id: "backups", label: "Copias de seguridad", description: "Política y conservación", icon: "archive" },
  { id: "integrations", label: "Conexiones", description: "Servicios externos", icon: "zap" }
];

const integrationKinds = {
  accounting: "Contabilidad", banking: "Banca", storage: "Almacenamiento", calendar: "Calendario",
  email: "Correo", weather: "Meteorología", payments: "Pagos", signature: "Firma electrónica", ai: "Inteligencia artificial",
  ocr: "OCR de facturas", import: "Importación", push: "Notificaciones push", webhook: "Webhook", other: "Otra"
} as const;

const integrationStatuses = { draft: "Borrador", enabled: "Activa", paused: "Pausada" } as const;
const months = ["Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio", "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"];

function Toggle({ checked, onChange, label, description }: { checked: boolean; onChange: (checked: boolean) => void; label: string; description: string }) {
  return (
    <label className="settings-toggle-row">
      <span><strong>{label}</strong><small>{description}</small></span>
      <input className="sr-only" type="checkbox" checked={checked} onChange={(event) => onChange(event.target.checked)} />
      <span className={`settings-switch ${checked ? "is-on" : ""}`} aria-hidden="true"><span /></span>
    </label>
  );
}

function IntegrationDialog({ integration, secretStorageReady, busy, error, onClose, onSubmit, onDelete }: {
  integration: IntegrationData | null;
  secretStorageReady: boolean;
  busy: boolean;
  error: string;
  onClose: () => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onDelete?: () => void;
}) {
  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) onClose(); }}>
      <section className="record-dialog settings-integration-dialog" role="dialog" aria-modal="true" aria-labelledby="integration-dialog-title">
        <header className="dialog-header">
          <div><span className="eyebrow">CONEXIÓN EXTERNA</span><h2 id="integration-dialog-title">{integration ? "Editar conexión" : "Nueva conexión"}</h2><p>Registra el proveedor y guarda su credencial de forma cifrada.</p></div>
          <button className="icon-button" type="button" onClick={onClose} disabled={busy} aria-label="Cerrar"><Icon name="close" /></button>
        </header>
        <form className="dialog-form" onSubmit={onSubmit}>
          <div className="dialog-scroll">
            <div className="form-grid">
              <div className="field-group"><label htmlFor="integration-name">Nombre visible</label><input id="integration-name" name="name" required maxLength={120} defaultValue={integration?.name ?? ""} placeholder="Ej. Contabilidad de la comunidad" /></div>
              <div className="field-group"><label htmlFor="integration-kind">Tipo</label><select id="integration-kind" name="kind" defaultValue={integration?.kind ?? "accounting"}>{Object.entries(integrationKinds).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></div>
              <div className="field-group"><label htmlFor="integration-provider">Proveedor</label><input id="integration-provider" name="provider" required maxLength={120} defaultValue={integration?.provider ?? ""} placeholder="Nombre del servicio" /></div>
              <div className="field-group"><label htmlFor="integration-account">Cuenta o referencia</label><input id="integration-account" name="accountReference" maxLength={160} defaultValue={integration?.accountReference ?? ""} placeholder="Identificador no sensible" /></div>
              <div className="field-group field-wide"><label htmlFor="integration-endpoint">Dirección de conexión (HTTPS)</label><input id="integration-endpoint" name="endpointUrl" type="url" maxLength={500} defaultValue={integration?.endpointUrl ?? ""} placeholder="https://api.proveedor.com" /><small className="field-hint">Se guarda como referencia; la aplicación no realiza llamadas automáticas a una dirección arbitraria.</small></div>
              <div className="field-group"><label htmlFor="integration-status">Estado</label><select id="integration-status" name="status" defaultValue={integration?.status ?? "draft"}><option value="draft">Borrador</option><option value="enabled">Activa</option><option value="paused">Pausada</option></select></div>
              <div className="field-group"><label htmlFor="integration-credential">Clave o token</label><input id="integration-credential" name="credential" type="password" maxLength={4096} autoComplete="new-password" disabled={!secretStorageReady} placeholder={integration?.credentialConfigured ? `Guardada (${integration.credentialHint})` : "Se guardará cifrada"} /><small className="field-hint">{integration?.credentialConfigured ? "Déjalo vacío para conservar la credencial actual." : "La credencial nunca vuelve a mostrarse."}</small></div>
            </div>
            {!secretStorageReady && <div className="settings-notice danger"><Icon name="shield-check" size={18} /><span><strong>Almacén de secretos pendiente</strong><small>Configura SETTINGS_ENCRYPTION_KEY en el servidor para poder guardar tokens o claves.</small></span></div>}
            {error && <div className="form-alert" role="alert">{error}</div>}
          </div>
          <footer className="dialog-footer"><div>{integration && onDelete ? <button className="button button-danger-ghost" type="button" onClick={onDelete} disabled={busy}><Icon name="trash" size={15} /> Desconectar</button> : <span className="settings-security-copy"><Icon name="shield-check" size={15} /> Credenciales cifradas en reposo</span>}</div><div className="dialog-footer-actions"><button className="button button-secondary" type="button" onClick={onClose} disabled={busy}>Cancelar</button><button className="button button-primary" type="submit" disabled={busy}>{busy ? "Guardando…" : "Guardar conexión"}</button></div></footer>
        </form>
      </section>
    </div>
  );
}

export function SettingsView({ initialSettings }: { initialSettings: SettingsDTO }) {
  const preferences = useTemporalPreferences();
  const router = useRouter();
  const searchParams = useSearchParams();
  const requestedTab = searchParams.get("tab") as Tab | null;
  const [tab, setTab] = useState<Tab>(requestedTab && tabs.some((item) => item.id === requestedTab) ? requestedTab : "community");
  const [settings, setSettings] = useState(initialSettings);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const [dialogOpen, setDialogOpen] = useState(false);
  const [editing, setEditing] = useState<IntegrationData | null>(null);
  const [integrationBusy, setIntegrationBusy] = useState(false);
  const [integrationError, setIntegrationError] = useState("");

  useEffect(() => {
    if (!toast) return;
    const timeout = window.setTimeout(() => setToast(""), 3500);
    return () => window.clearTimeout(timeout);
  }, [toast]);

  function updateCommunity<K extends keyof CommunitySettingsData>(key: K, value: CommunitySettingsData[K]) {
    setSettings((current) => ({ ...current, community: { ...current.community, [key]: value } }));
  }

  function updatePreferences<K extends keyof OperationalSettingsData>(key: K, value: OperationalSettingsData[K]) {
    setSettings((current) => ({ ...current, preferences: { ...current.preferences, [key]: value } }));
  }

  async function saveSettings(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setSaving(true); setError("");
    const response = await fetch("/api/settings", {
      method: "PATCH", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ community: settings.community, preferences: settings.preferences })
    });
    const body = await response.json();
    if (!response.ok) setError(body.error || "No se ha podido guardar la configuración.");
    else {
      setSettings(body as SettingsDTO);
      setToast("Configuración guardada");
      router.refresh();
    }
    setSaving(false);
  }

  function openIntegration(integration: IntegrationData | null) {
    setEditing(integration); setIntegrationError(""); setDialogOpen(true);
  }

  async function saveIntegration(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setIntegrationBusy(true); setIntegrationError("");
    const form = new FormData(event.currentTarget);
    const credential = String(form.get("credential") || "").trim();
    const payload = {
      name: form.get("name"), kind: form.get("kind"), provider: form.get("provider"),
      endpointUrl: form.get("endpointUrl"), accountReference: form.get("accountReference"),
      status: form.get("status"), ...(credential ? { credential } : {})
    };
    const response = await fetch(editing ? `/api/settings/integrations/${editing.id}` : "/api/settings/integrations", {
      method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) setIntegrationError(body.error || "No se ha podido guardar la conexión.");
    else {
      const next = body.integration as IntegrationData;
      setSettings((current) => ({ ...current, integrations: editing ? current.integrations.map((item) => item.id === next.id ? next : item) : [...current.integrations, next] }));
      setDialogOpen(false); setEditing(null); setToast(editing ? "Conexión actualizada" : "Conexión creada");
    }
    setIntegrationBusy(false);
  }

  async function deleteIntegration() {
    if (!editing || !window.confirm(`¿Desconectar ${editing.name}? La credencial dejará de estar disponible en la aplicación.`)) return;
    setIntegrationBusy(true); setIntegrationError("");
    const response = await fetch(`/api/settings/integrations/${editing.id}`, { method: "DELETE" });
    const body = await response.json();
    if (!response.ok) setIntegrationError(body.error || "No se ha podido desconectar el servicio.");
    else {
      setSettings((current) => ({ ...current, integrations: current.integrations.filter((item) => item.id !== editing.id) }));
      setDialogOpen(false); setEditing(null); setToast("Conexión eliminada");
    }
    setIntegrationBusy(false);
  }

  return (
    <div className="page settings-page">
      <div className="module-breadcrumb"><span>Administración</span><span>/</span><strong>Configuración</strong></div>
      <header className="page-heading settings-heading">
        <div><span className="eyebrow">AJUSTES DE LA APLICACIÓN</span><h1>Configuración de la comunidad</h1><p>Gestiona desde un único lugar los datos oficiales, contabilidad, avisos, copias y servicios conectados.</p></div>
        <div className="heading-actions">{tab === "integrations" && <button className="button button-secondary" type="button" onClick={() => openIntegration(null)}><Icon name="plus" size={17} /> Nueva conexión</button>}<button className="button button-primary" type="submit" form="community-settings-form" disabled={saving}><Icon name="badge-check" size={17} /> {saving ? "Guardando…" : "Guardar cambios"}</button></div>
      </header>

      <div className="settings-layout">
        <nav className="settings-nav" aria-label="Secciones de configuración">
          {tabs.map((item) => <button type="button" key={item.id} className={tab === item.id ? "active" : ""} onClick={() => { setTab(item.id); setError(""); }} aria-current={tab === item.id ? "page" : undefined}><span><Icon name={item.icon} size={18} /></span><span><strong>{item.label}</strong><small>{item.description}</small></span></button>)}
          <div className={`settings-secret-status ${settings.secretStorageReady ? "ready" : "pending"}`}><Icon name="shield-check" size={18} /><span><strong>{settings.secretStorageReady ? "Secretos protegidos" : "Protección pendiente"}</strong><small>{settings.secretStorageReady ? "Cifrado del servidor activo" : "Falta la clave del servidor"}</small></span></div>
        </nav>

        <form id="community-settings-form" className="settings-content" onSubmit={saveSettings}>
          {tab === "community" && <section className="settings-panel" aria-labelledby="settings-community-title">
            <header><span className="settings-section-icon purple"><Icon name="building" /></span><span><h2 id="settings-community-title">Datos de la comunidad</h2><p>Estos datos identifican la comunidad y se muestran en toda la aplicación.</p></span></header>
            <div className="settings-form-grid">
              <div className="field-group field-wide"><label htmlFor="settings-name">Nombre de la comunidad *</label><input id="settings-name" required maxLength={160} value={settings.community.name} onChange={(event) => updateCommunity("name", event.target.value)} /></div>
              <div className="field-group"><label htmlFor="settings-tax">CIF / NIF</label><input id="settings-tax" maxLength={40} value={settings.community.taxId} onChange={(event) => updateCommunity("taxId", event.target.value)} /></div>
              <div className="field-group"><label htmlFor="settings-phone">Teléfono</label><input id="settings-phone" type="tel" maxLength={40} value={settings.community.phone} onChange={(event) => updateCommunity("phone", event.target.value)} /></div>
              <div className="field-group field-wide"><label htmlFor="settings-address">Dirección *</label><input id="settings-address" required maxLength={240} value={settings.community.address} onChange={(event) => updateCommunity("address", event.target.value)} /></div>
              <div className="field-group"><label htmlFor="settings-postal">Código postal</label><input id="settings-postal" maxLength={20} value={settings.community.postalCode} onChange={(event) => updateCommunity("postalCode", event.target.value)} /></div>
              <div className="field-group"><label htmlFor="settings-city">Municipio</label><input id="settings-city" maxLength={120} value={settings.community.city} onChange={(event) => updateCommunity("city", event.target.value)} /></div>
              <div className="field-group"><label htmlFor="settings-province">Provincia</label><input id="settings-province" maxLength={120} value={settings.community.province} onChange={(event) => updateCommunity("province", event.target.value)} /></div>
              <div className="field-group"><label htmlFor="settings-country">País</label><select id="settings-country" value={settings.community.countryCode} onChange={(event) => updateCommunity("countryCode", event.target.value)}><option value="ES">España</option><option value="PT">Portugal</option><option value="FR">Francia</option><option value="AD">Andorra</option></select></div>
              <div className="field-group"><label htmlFor="settings-email">Correo de contacto</label><input id="settings-email" type="email" value={settings.community.contactEmail} onChange={(event) => updateCommunity("contactEmail", event.target.value)} /></div>
              <div className="field-group"><label htmlFor="settings-website">Página web (HTTPS)</label><input id="settings-website" type="url" value={settings.community.websiteUrl} onChange={(event) => updateCommunity("websiteUrl", event.target.value)} placeholder="https://" /></div>
            </div>
          </section>}

          {tab === "regional" && <section className="settings-panel" aria-labelledby="settings-regional-title">
            <header><span className="settings-section-icon blue"><Icon name="calendar-check" /></span><span><h2 id="settings-regional-title">Horario, idioma y formatos</h2><p>Controla cómo se presentan las fechas, horas e importes y cuándo atiende la administración.</p></span></header>
            <div className="settings-form-grid">
              <div className="field-group"><label htmlFor="settings-timezone">Zona horaria</label><select id="settings-timezone" value={settings.community.timezone} onChange={(event) => updateCommunity("timezone", event.target.value)}><option value="Europe/Madrid">Península · Europe/Madrid</option><option value="Atlantic/Canary">Canarias · Atlantic/Canary</option><option value="Europe/Lisbon">Portugal · Europe/Lisbon</option></select></div>
              <div className="field-group"><label htmlFor="settings-locale">Idioma</label><select id="settings-locale" value={settings.community.locale} onChange={(event) => updateCommunity("locale", event.target.value)}><option value="es-ES">Español</option><option value="ca-ES">Català</option><option value="eu-ES">Euskara</option><option value="gl-ES">Galego</option><option value="en-GB">English</option></select></div>
              <div className="field-group"><label htmlFor="settings-time-format">Formato de hora</label><select id="settings-time-format" value={settings.preferences.timeFormat} onChange={(event) => updatePreferences("timeFormat", event.target.value as OperationalSettingsData["timeFormat"])}><option value="24h">24 horas · 18:30</option><option value="12h">12 horas · 6:30 PM</option></select></div>
              <div className="field-group"><label htmlFor="settings-date-format">Formato de fecha</label><select id="settings-date-format" value={settings.preferences.dateFormat} onChange={(event) => updatePreferences("dateFormat", event.target.value as OperationalSettingsData["dateFormat"])}><option value="DD/MM/YYYY">Día / mes / año</option><option value="YYYY-MM-DD">Año - mes - día</option></select></div>
              <div className="field-group"><label htmlFor="settings-currency">Moneda</label><select id="settings-currency" value={settings.preferences.currencyCode} onChange={(event) => updatePreferences("currencyCode", event.target.value)}><option value="EUR">Euro (€)</option><option value="GBP">Libra esterlina (£)</option><option value="USD">Dólar estadounidense ($)</option></select></div>
              <div className="field-group"><label htmlFor="settings-fiscal-month">Inicio del ejercicio económico</label><select id="settings-fiscal-month" value={settings.preferences.fiscalYearStartMonth} onChange={(event) => updatePreferences("fiscalYearStartMonth", Number(event.target.value))}>{months.map((month, index) => <option key={month} value={index + 1}>{month}</option>)}</select></div>
              <div className="field-group"><label htmlFor="settings-due-day">Día de vencimiento habitual</label><input id="settings-due-day" type="number" min={1} max={31} value={settings.preferences.defaultDueDay} onChange={(event) => updatePreferences("defaultDueDay", Number(event.target.value))} /></div>
              <div className="field-group"><label htmlFor="settings-legal">Marco jurídico</label><select id="settings-legal" value={settings.community.legalProfile} onChange={(event) => updateCommunity("legalProfile", event.target.value)}><option value="LPH_ESTATAL">Ley de Propiedad Horizontal (estatal)</option></select></div>
              <div className="field-group field-wide"><label htmlFor="settings-office-hours">Horario de atención</label><textarea id="settings-office-hours" rows={3} maxLength={300} value={settings.preferences.officeHours} onChange={(event) => updatePreferences("officeHours", event.target.value)} placeholder="Ej. Lunes a viernes, de 09:00 a 14:00" /></div>
            </div>
          </section>}

          {tab === "notifications" && <section className="settings-panel" aria-labelledby="settings-notifications-title">
            <header><span className="settings-section-icon orange"><Icon name="bell" /></span><span><h2 id="settings-notifications-title">Avisos y notificaciones</h2><p>Elige los canales generales que podrá usar la comunidad para sus comunicaciones.</p></span></header>
            <div className="settings-toggle-list">
              <Toggle checked={settings.preferences.notificationsEmail} onChange={(value) => updatePreferences("notificationsEmail", value)} label="Preparar envíos por correo" description="Crea entregas para direcciones verificadas. El envío externo requiere un proveedor de correo activo." />
              <Toggle checked={settings.preferences.notificationsPush} onChange={(value) => updatePreferences("notificationsPush", value)} label="Preparar notificaciones push" description="Crea entregas push cuando exista un proveedor configurado. Los avisos dentro de la aplicación permanecen disponibles." />
            </div>
            <div className="settings-notice"><Icon name="info" size={18} /><span><strong>Preferencia general</strong><small>Cada aviso seguirá respetando su audiencia, estado de publicación y los permisos de cada usuario.</small></span></div>
          </section>}

          {tab === "accounting" && <section className="settings-panel settings-accounting-panel" aria-labelledby="settings-accounting-title">
            <header><span className="settings-section-icon purple"><Icon name="book" /></span><span><h2 id="settings-accounting-title">Contabilidad de la comunidad</h2><p>Decide si esta comunidad utiliza libro contable y asientos automáticos.</p></span></header>
            <div className={`settings-accounting-status ${settings.preferences.accountingEnabled ? "enabled" : "disabled"}`}>
              <span><Icon name={settings.preferences.accountingEnabled ? "badge-check" : "book"} size={24} /></span>
              <div><small>ESTADO DEL MÓDULO</small><strong>{settings.preferences.accountingEnabled ? "Contabilidad activa" : "Contabilidad desactivada"}</strong><p>{settings.preferences.accountingEnabled ? "Los nuevos cobros, pagos y reversiones se registrarán automáticamente." : "La comunidad seguirá usando Economía y Bancos sin generar asientos contables."}</p></div>
              {settings.preferences.accountingEnabled && <b>{settings.preferences.automaticAccountingEntries} asientos automáticos</b>}
            </div>
            <div className="settings-toggle-list">
              <Toggle checked={settings.preferences.accountingEnabled} onChange={(value) => updatePreferences("accountingEnabled", value)} label="Activar el módulo de contabilidad" description="Muestra el libro contable y activa la contabilización automática para esta comunidad." />
            </div>
            <div className="settings-accounting-flow" aria-label="Reglas de contabilización automática">
              <article><span><Icon name="landmark" size={19} /></span><div><strong>Recibos y cuotas cobrados</strong><p>Registra el ingreso en Banco contra Cuotas ordinarias, Derramas u Otros ingresos, según el tipo.</p></div></article>
              <article><span><Icon name="files" size={19} /></span><div><strong>Facturas y gastos pagados</strong><p>Registra el gasto contra Banco cuando el pago queda confirmado.</p></div></article>
              <article><span><Icon name="undo" size={19} /></span><div><strong>Devoluciones y conciliaciones deshechas</strong><p>Crea un asiento de reversión; nunca modifica ni borra el asiento contabilizado.</p></div></article>
            </div>
            <div className="settings-notice warning"><Icon name="info" size={18} /><span><strong>Sin borrado de datos</strong><small>Desactivar el módulo conserva los ejercicios y asientos existentes, pero detiene nuevas automatizaciones. Al volver a activarlo solo se registran hechos confirmados desde ese momento.</small></span></div>
            {settings.preferences.accountingEnabled && <Link className="button button-secondary settings-accounting-open" href="/economia"><Icon name="book" size={16} /> Abrir Economía y contabilidad</Link>}
          </section>}

          {tab === "backups" && <section className="settings-panel" aria-labelledby="settings-backups-title">
            <header><span className="settings-section-icon green"><Icon name="archive" /></span><span><h2 id="settings-backups-title">Política de copias de seguridad</h2><p>Define la frecuencia y conservación esperadas para los datos de esta comunidad.</p></span></header>
            <div className="settings-backup-status"><span><Icon name="shield-check" /></span><div><strong>{settings.preferences.backupProvider === "disabled" ? "Copias desactivadas" : settings.preferences.backupProvider === "hosting" ? "Gestionadas por el alojamiento" : "Almacenamiento externo S3"}</strong><p>{settings.preferences.backupProvider === "hosting" ? "La política se guarda aquí; las copias reales deben estar activadas en el proveedor de alojamiento o Coolify." : settings.preferences.backupProvider === "s3" ? "Requiere una conexión de almacenamiento activa y sus credenciales cifradas." : "No se ha definido una política de copias para la comunidad."}</p></div></div>
            <div className="settings-form-grid">
              <div className="field-group"><label htmlFor="settings-backup-provider">Responsable de la copia</label><select id="settings-backup-provider" value={settings.preferences.backupProvider} onChange={(event) => updatePreferences("backupProvider", event.target.value as OperationalSettingsData["backupProvider"])}><option value="hosting">Proveedor de alojamiento / Coolify</option><option value="s3">Almacenamiento compatible con S3</option><option value="disabled">Sin política de copias</option></select></div>
              <div className="field-group"><label htmlFor="settings-backup-frequency">Frecuencia</label><select id="settings-backup-frequency" disabled={settings.preferences.backupProvider === "disabled"} value={settings.preferences.backupFrequency} onChange={(event) => updatePreferences("backupFrequency", event.target.value as OperationalSettingsData["backupFrequency"])}><option value="daily">Diaria</option><option value="weekly">Semanal</option><option value="monthly">Mensual</option></select></div>
              <div className="field-group"><label htmlFor="settings-backup-time">Hora prevista</label><input id="settings-backup-time" type="time" disabled={settings.preferences.backupProvider === "disabled"} value={settings.preferences.backupTime} onChange={(event) => updatePreferences("backupTime", event.target.value)} /></div>
              <div className="field-group"><label htmlFor="settings-backup-retention">Conservación (días)</label><input id="settings-backup-retention" type="number" min={1} max={3650} disabled={settings.preferences.backupProvider === "disabled"} value={settings.preferences.backupRetentionDays} onChange={(event) => updatePreferences("backupRetentionDays", Number(event.target.value))} /></div>
              <div className="field-group field-wide"><label htmlFor="settings-backup-email">Correo para incidencias de copia</label><input id="settings-backup-email" type="email" disabled={settings.preferences.backupProvider === "disabled"} value={settings.preferences.backupNotificationEmail} onChange={(event) => updatePreferences("backupNotificationEmail", event.target.value)} placeholder="administracion@comunidad.es" /></div>
            </div>
            <div className="settings-notice warning"><Icon name="info" size={18} /><span><strong>Configuración operativa necesaria</strong><small>Guardar esta política no crea por sí solo una copia de la base de datos. El alojamiento debe ejecutar y verificar las copias con la misma frecuencia.</small></span></div>
          </section>}

          {tab === "integrations" && <section className="settings-panel settings-integrations-panel" aria-labelledby="settings-integrations-title">
            <header><span className="settings-section-icon cyan"><Icon name="zap" /></span><span><h2 id="settings-integrations-title">Conexiones con otras aplicaciones</h2><p>Empieza con asistentes sencillos. La configuración técnica queda como opción avanzada.</p></span><div className="heading-actions"><Link className="button button-primary" href="/conexion-bancaria"><Icon name="landmark" size={16} /> Conectar banco</Link><button className="button button-secondary settings-mobile-add" type="button" onClick={() => openIntegration(null)}><Icon name="plus" size={16} /> Conexión avanzada</button></div></header>
            {!settings.secretStorageReady && <div className="settings-notice danger"><Icon name="shield-check" size={18} /><span><strong>No se pueden guardar credenciales todavía</strong><small>Añade SETTINGS_ENCRYPTION_KEY al servidor y reinicia la aplicación. Los datos descriptivos sí pueden guardarse.</small></span></div>}
            <div className="settings-notice"><Icon name="landmark" size={18} /><span><strong>Banca sin contraseñas</strong><small>El asistente permite identificar la cuenta e importar CSV o Norma 43. Una conexión automática futura deberá autorizarse en el entorno seguro del banco mediante un proveedor PSD2.</small></span></div>
            <div className="settings-notice"><Icon name="cloud-sun" size={18} /><span><strong>Servicios meteorológicos</strong><small>Para avisos oficiales usa AEMET como proveedor. Para una licencia comercial del tiempo actual, añade también una conexión Open-Meteo. Guarda cada API key y deja la conexión activa.</small></span></div>
            <div className="settings-integration-list">
              {settings.integrations.map((integration) => <button type="button" className="settings-integration-card" onClick={() => openIntegration(integration)} key={integration.id}><span className="integration-provider-icon"><Icon name={integration.kind === "banking" ? "landmark" : integration.kind === "storage" ? "archive" : integration.kind === "email" ? "megaphone" : integration.kind === "weather" ? "cloud-sun" : "zap"} size={20} /></span><span className="integration-main"><span><strong>{integration.name}</strong><small>{integration.provider} · {integrationKinds[integration.kind]}</small></span><span className={`settings-status ${integration.status}`}><span />{integrationStatuses[integration.status]}</span></span><span className="integration-meta"><span><Icon name="shield-check" size={14} />{integration.credentialConfigured ? `Credencial ${integration.credentialHint}` : "Sin credencial"}</span><span>Actualizada el {formatDateTime(integration.updatedAt,preferences)} · {preferences.timeZone}</span></span><Icon name="pencil" className="integration-edit" size={17} /></button>)}
              {!settings.integrations.length && <div className="settings-integrations-empty"><span><Icon name="zap" size={25} /></span><h3>Aún no hay conexiones</h3><p>Añade un proveedor contable, bancario, meteorológico, de correo, calendario o almacenamiento.</p><button type="button" className="button button-primary" onClick={() => openIntegration(null)}><Icon name="plus" size={16} /> Crear primera conexión</button></div>}
            </div>
          </section>}

          {error && <div className="form-alert settings-form-error" role="alert">{error}</div>}
          <footer className="settings-save-footer"><span><Icon name="info" size={15} /> Los cambios quedan registrados en la auditoría.</span><button className="button button-primary" type="submit" disabled={saving}>{saving ? "Guardando…" : "Guardar cambios"}</button></footer>
        </form>
      </div>

      {dialogOpen && <IntegrationDialog integration={editing} secretStorageReady={settings.secretStorageReady} busy={integrationBusy} error={integrationError} onClose={() => { setDialogOpen(false); setEditing(null); }} onSubmit={saveIntegration} onDelete={editing ? deleteIntegration : undefined} />}
      {toast && <div className="toast" role="status"><Icon name="badge-check" size={18} />{toast}</div>}
    </div>
  );
}
