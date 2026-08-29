"use client";

import { useState } from "react";
import { Icon } from "./Icon";
import { usageLabels, type ProductControlState, type ProductUsageType, type TelemetryLevel } from "@/lib/product-control-domain";
import styles from "./ProductControlSettings.module.css";

export function ProductControlSettings({ initialState }: { initialState: ProductControlState }) {
  const [state, setState] = useState(initialState);
  const [usageType, setUsageType] = useState<ProductUsageType>(initialState.usageType);
  const [telemetryLevel, setTelemetryLevel] = useState<TelemetryLevel>(initialState.telemetryLevel);
  const [licenseKey, setLicenseKey] = useState("");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function request(path: string, body?: unknown, method = "POST") {
    const response = await fetch(path, {
      method,
      headers: { "Content-Type": "application/json" },
      body: body === undefined ? undefined : JSON.stringify(body)
    });
    const result = await response.json();
    if (!response.ok) throw new Error(result.error || "No se pudo completar la operación.");
    return result as ProductControlState;
  }

  async function save() {
    if (usageType === "commercial" && !state.commercialLicense.active) {
      setError("Para declarar uso comercial primero debes activar una licencia emitida por Kacum.");
      return;
    }
    setBusy(true); setMessage(""); setError("");
    try {
      const updated = await request("/api/settings/product-control", { usageType, telemetryLevel }, "PATCH");
      setState(updated);
      setMessage(telemetryLevel === "disabled" ? "Configuración guardada. No se enviará telemetría." : "Configuración guardada y sincronizada con Kacum.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo guardar.");
    } finally { setBusy(false); }
  }

  async function activate() {
    if (!licenseKey.trim()) return;
    setBusy(true); setMessage(""); setError("");
    try {
      const updated = await request("/api/settings/product-control/activate", { licenseKey });
      setState(updated); setUsageType("commercial"); setLicenseKey("");
      setMessage("Licencia comercial activada y verificada localmente.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo activar la licencia.");
    } finally { setBusy(false); }
  }

  async function sync() {
    setBusy(true); setMessage(""); setError("");
    try {
      const updated = await request("/api/settings/product-control/sync", { force: true });
      setState(updated); setMessage("Kacum ha recibido el estado agregado de esta instalación.");
    } catch (requestError) {
      setError(requestError instanceof Error ? requestError.message : "No se pudo sincronizar.");
    } finally { setBusy(false); }
  }

  return <div className={styles.slot}>
    <section className={styles.card} aria-labelledby="product-control-title">
      <header className={styles.header}>
        <span className={styles.icon}><Icon name="shield-check" size={22} /></span>
        <div><span className={styles.eyebrow}>LICENCIA Y PRIVACIDAD DE LA INSTALACIÓN</span><h2 id="product-control-title">Comunidad gratuita, explotación comercial autorizada</h2><p>Todas las funciones siguen disponibles para las comunidades. Solo necesitas una licencia cuando la instalación se explota como servicio comercial.</p></div>
        <span className={`${styles.status} ${state.commercialLicense.active ? styles.commercial : styles.community}`}>
          {state.commercialLicense.active ? "Licencia comercial válida" : "Uso comunitario gratuito"}
        </span>
      </header>

      {!state.controlPlaneConfigured && <div className={styles.warning}><Icon name="info" size={18} /><span><strong>Kacum no está configurado</strong><small>Añade KACUM_CONTROL_PLANE_URL al servidor para registrar instalaciones o activar licencias comerciales.</small></span></div>}

      <div className={styles.grid}>
        <div className={styles.field}><label htmlFor="product-usage">Finalidad de esta instalación</label><select id="product-usage" value={usageType} onChange={(event) => setUsageType(event.target.value as ProductUsageType)} disabled={busy}>{Object.entries(usageLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select><small>El administrador invitado por una comunidad no convierte por sí mismo el uso en comercial.</small></div>
        <div className={styles.field}><label htmlFor="product-telemetry">Información compartida</label><select id="product-telemetry" value={telemetryLevel} onChange={(event) => setTelemetryLevel(event.target.value as TelemetryLevel)} disabled={busy}><option value="disabled">Desactivada</option><option value="basic">Básica: instalación, versión y salud</option><option value="product">Mejora del producto: rangos y funciones usadas</option></select><small>Nunca se envían propietarios, direcciones, documentos, incidencias, saldos, IBAN ni textos.</small></div>
      </div>

      <div className={styles.identity}><span><small>IDENTIFICADOR ALEATORIO</small><code>{state.installationId}</code></span><span><small>ÚLTIMA SINCRONIZACIÓN</small><strong>{state.lastSyncAt ? new Date(state.lastSyncAt).toLocaleString("es-ES") : "Nunca"}</strong></span><span><small>ESTADO</small><strong>{state.lastSyncStatus === "ok" ? "Correcto" : state.lastSyncStatus === "error" ? "Con error" : "Sin registrar"}</strong></span></div>

      {state.lastSyncError && <div className={styles.error} role="alert">{state.lastSyncError}</div>}

      <div className={styles.actions}><button type="button" className="button button-primary" onClick={() => void save()} disabled={busy}>{busy ? "Procesando…" : "Guardar configuración"}</button><button type="button" className="button button-secondary" onClick={() => void sync()} disabled={busy || telemetryLevel === "disabled" || !state.controlPlaneConfigured}>Enviar estado ahora</button></div>

      {!state.commercialLicense.active && <div className={styles.activation}><div><strong>¿Esta instalación se utiliza comercialmente?</strong><p>Introduce la clave emitida por Kacum. La clave no se conserva: solo se guarda un certificado firmado que puede verificarse sin conexión.</p></div><div className={styles.activationForm}><input type="password" autoComplete="off" value={licenseKey} onChange={(event) => setLicenseKey(event.target.value)} placeholder="Clave comercial" disabled={busy || !state.controlPlaneConfigured} /><button type="button" className="button button-secondary" onClick={() => void activate()} disabled={busy || !licenseKey.trim() || !state.controlPlaneConfigured}>Activar</button></div></div>}

      {state.commercialLicense.active && <div className={styles.license}><Icon name="badge-check" size={20} /><span><strong>Certificado comercial verificado</strong><small>Licencia {state.commercialLicense.licenseId} · versión {state.commercialLicense.majorVersion}.x · sin caducidad</small></span></div>}
      {message && <div className={styles.success} role="status">{message}</div>}
      {error && <div className={styles.error} role="alert">{error}</div>}
    </section>
  </div>;
}
