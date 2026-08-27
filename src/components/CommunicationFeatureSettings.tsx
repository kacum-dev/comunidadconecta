"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Icon } from "./Icon";
import styles from "./CommunicationFeatureSettings.module.css";

export function CommunicationFeatureSettings({ initialEnabled }: { initialEnabled: boolean }) {
  const router = useRouter();
  const [enabled, setEnabled] = useState(initialEnabled);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  async function changeEnabled(nextEnabled: boolean) {
    if (!nextEnabled && enabled) {
      const confirmed = window.confirm(
        "¿Desactivar el centro de comunicaciones? El historial se conservará, pero la bandeja omnicanal y la recepción externa dejarán de estar disponibles hasta que vuelvas a activarlo."
      );
      if (!confirmed) return;
    }

    setBusy(true);
    setMessage("");
    setError("");
    try {
      const response = await fetch("/api/settings/communications", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ enabled: nextEnabled })
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.error || "No se pudo cambiar la configuración.");
      setEnabled(body.enabled);
      setMessage(body.enabled ? "Centro de comunicaciones activado." : "Centro de comunicaciones desactivado.");
      router.refresh();
    } catch (changeError) {
      setError(changeError instanceof Error ? changeError.message : "No se pudo cambiar la configuración.");
    } finally {
      setBusy(false);
    }
  }

  return <div className={styles.slot}>
    <section className={styles.card} aria-labelledby="communication-feature-title">
      <div className={styles.copy}>
        <span className={styles.icon}><Icon name="megaphone" size={21} /></span>
        <div>
          <span className={styles.eyebrow}>MÓDULO OPCIONAL · CONTROL DE COSTE</span>
          <h2 id="communication-feature-title">Centro de comunicaciones omnicanal</h2>
          <p>Actívalo solo si la comunidad necesita reunir app, correo, teléfono, WhatsApp y atención presencial en un único historial.</p>
          <small className={styles.detail}>Desactivarlo no borra conversaciones y mantiene disponibles los avisos, incidencias y funciones básicas. Este módulo deja de aceptar correo entrante y no genera llamadas a proveedores externos propias del centro omnicanal.</small>
        </div>
      </div>
      <div className={styles.control}>
        <span className={`${styles.status} ${enabled ? styles.enabled : styles.disabled}`}>{enabled ? "Activo" : "Desactivado"}</span>
        <label className={styles.switch}>
          <input
            type="checkbox"
            checked={enabled}
            disabled={busy}
            onChange={(event) => void changeEnabled(event.target.checked)}
            aria-label="Activar centro de comunicaciones omnicanal"
          />
          <span className={styles.track} aria-hidden="true" />
          <strong>{busy ? "Guardando…" : enabled ? "Activado" : "Desactivado"}</strong>
        </label>
        {message && <p className={styles.message} role="status">{message}</p>}
        {error && <p className={styles.error} role="alert">{error}</p>}
      </div>
    </section>
  </div>;
}
