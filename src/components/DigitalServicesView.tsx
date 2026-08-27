import Link from "next/link";
import { Icon } from "./Icon";
import type { IntegrationData } from "@/lib/settings-types";
import { digitalCapabilities, resolveCapabilityState, type DigitalCapabilityState } from "@/lib/digital-services-domain";
import styles from "./DigitalServicesView.module.css";

const stateLabels: Record<DigitalCapabilityState, string> = {
  active: "Disponible",
  ready: "Por configurar",
  planned: "Siguiente fase"
};

export function DigitalServicesView({ integrations }: { integrations: readonly IntegrationData[] }) {
  const capabilities = digitalCapabilities.map((capability) => ({
    ...capability,
    state: resolveCapabilityState(capability, integrations)
  }));
  const active = capabilities.filter((capability) => capability.state === "active").length;
  const ready = capabilities.filter((capability) => capability.state === "ready").length;

  return (
    <div className={`page ${styles.page}`}>
      <div className="module-breadcrumb"><Link href="/inicio">← Inicio</Link><span>/</span><span>Servicios digitales</span></div>
      <header className={styles.heading}>
        <div>
          <span className="eyebrow">ACTIVACIÓN SEGURA</span>
          <h1>Servicios digitales</h1>
          <p>La base ya está preparada. Conecta solo los proveedores que necesite la comunidad.</p>
        </div>
        <Link className="button button-primary" href="/configuracion?tab=integrations"><Icon name="settings" size={17} /> Configurar conexiones</Link>
      </header>

      <section className={styles.summary} aria-label="Estado de los servicios digitales">
        <div className={styles.summaryMain}>
          <span><Icon name="sparkles" size={24} /></span>
          <div><strong>8 capacidades, una sola trazabilidad</strong><small>Datos de la comunidad, revisión humana y conectores sustituibles.</small></div>
        </div>
        <dl>
          <div><dt>Conectadas</dt><dd>{active}</dd></div>
          <div><dt>Listas</dt><dd>{ready}</dd></div>
          <div><dt>Total</dt><dd>{capabilities.length}</dd></div>
        </dl>
      </section>

      <div className={styles.grid}>
        {capabilities.map((capability, index) => (
          <article className={styles.card} key={capability.key}>
            <header>
              <span className={styles.icon}><Icon name={capability.icon} size={22} /></span>
              <span className={`${styles.status} ${styles[capability.state]}`}><i />{stateLabels[capability.state]}</span>
            </header>
            <div className={styles.cardTitle}>
              <small>{String(index + 1).padStart(2, "0")}</small>
              <h2>{capability.shortTitle}</h2>
              <button className={styles.help} type="button" aria-label={`Ayuda sobre ${capability.title}`} aria-describedby={`digital-help-${capability.key}`}>
                <Icon name="help" size={17} />
                <span id={`digital-help-${capability.key}`} role="tooltip">{capability.help}</span>
              </button>
            </div>
            <p>{capability.summary}</p>
            <ul>{capability.features.map((feature) => <li key={feature}><Icon name="badge-check" size={15} />{feature}</li>)}</ul>
            <footer>
              <Link href={capability.href}>Abrir módulo <span aria-hidden>→</span></Link>
              {capability.integrationKinds.length > 0 && capability.state !== "active" && <Link href={capability.key === "sepa" ? "/conexion-bancaria" : "/configuracion?tab=integrations"}>Conectar</Link>}
            </footer>
          </article>
        ))}
      </div>

      <aside className={styles.notice}>
        <Icon name="shield-check" size={21} />
        <div><strong>Activación con control</strong><p>Pagos, firma, OCR, IA y push permanecen desactivados hasta configurar un proveedor. Ninguna tarjeta equivale por sí sola a una certificación o conexión real.</p></div>
      </aside>
    </div>
  );
}
