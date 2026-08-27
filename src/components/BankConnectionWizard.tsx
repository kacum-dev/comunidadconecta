"use client";

import { useState, type FormEvent } from "react";
import Link from "next/link";
import { Icon } from "./Icon";
import styles from "./GuidedFlows.module.css";

const banks = ["CaixaBank", "BBVA", "Banco Santander", "Banco Sabadell", "Bankinter", "Unicaja", "Kutxabank", "Abanca", "Cajamar", "Otro banco"];

type ImportResult = { imported: number; duplicates: number; errors: Array<{ row: number; message: string }>; format?: "csv" | "norma43" };

export function BankConnectionWizard() {
  const [step, setStep] = useState(1);
  const [bank, setBank] = useState("");
  const [otherBank, setOtherBank] = useState("");
  const [accountReference, setAccountReference] = useState("");
  const [file, setFile] = useState<File | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const bankName = bank === "Otro banco" ? otherBank.trim() : bank;

  async function saveConnection(event: FormEvent) {
    event.preventDefault();
    if (bankName.length < 2) { setError("Elige tu banco o escribe su nombre."); return; }
    setBusy(true); setError("");
    const response = await fetch("/api/finance/bank-connection", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ bankName, accountReference })
    });
    const body = await response.json();
    if (!response.ok) setError(body.error || "No se pudo guardar la conexión.");
    else setStep(2);
    setBusy(false);
  }

  async function importStatement(event: FormEvent) {
    event.preventDefault();
    if (!file) return;
    setBusy(true); setError("");
    const payload = new FormData(); payload.set("file", file);
    const response = await fetch("/api/finance/import", { method: "POST", body: payload });
    const body = await response.json();
    if (!response.ok) setError(body.error || "No se pudo leer el extracto.");
    else { setResult(body); setStep(3); }
    setBusy(false);
  }

  return <div className={`page ${styles.wizardPage}`}>
    <div className="module-breadcrumb"><Link href="/economia">← Economía</Link><span>/</span><span>Conectar banco</span></div>
    <header className={styles.wizardHeading}><span className="eyebrow">ASISTENTE PASO A PASO</span><h1>Conectar el banco</h1><p>Sin claves bancarias y sin tecnicismos. Configura la cuenta e importa el extracto que descargas de tu banco.</p></header>

    <ol className={styles.steps} aria-label="Progreso">
      {["Elige el banco", "Sube el extracto", "Revisa el resultado"].map((label, index) => <li className={step >= index + 1 ? styles.stepActive : ""} key={label}><span>{step > index + 1 ? "✓" : index + 1}</span><small>{label}</small></li>)}
    </ol>

    <main className={styles.wizardCard}>
      {step === 1 && <form onSubmit={saveConnection}>
        <header><span className={styles.bigIcon}><Icon name="landmark" size={28} /></span><div><h2>¿Con qué banco trabajáis?</h2><p>Esto solo sirve para identificar el origen de los extractos.</p></div></header>
        <div className={styles.bankGrid}>{banks.map((name) => <label className={bank === name ? styles.bankActive : styles.bankChoice} key={name}><input className="sr-only" type="radio" name="bank" value={name} checked={bank === name} onChange={() => setBank(name)} /><span>{name}</span><Icon name="badge-check" size={18} /></label>)}</div>
        {bank === "Otro banco" && <label className="field-group">Nombre del banco<input value={otherBank} onChange={(event) => setOtherBank(event.target.value)} required maxLength={120} autoFocus /></label>}
        <label className="field-group">Referencia para reconocer la cuenta<input value={accountReference} onChange={(event) => setAccountReference(event.target.value)} maxLength={160} placeholder="Ej. Cuenta comunidad · termina en 4821" /><small className="field-hint">No escribas el IBAN completo ni ninguna contraseña.</small></label>
        <div className={styles.safety}><Icon name="shield-check" size={20} /><span><strong>No pedimos acceso a la banca online.</strong><small>Las claves y códigos SMS se introducen únicamente en la web o app oficial de tu banco.</small></span></div>
        {error && <div className="form-alert" role="alert">{error}</div>}
        <footer><span /><button className="button button-primary" disabled={busy || !bankName}>{busy ? "Guardando…" : "Continuar"} <span aria-hidden>→</span></button></footer>
      </form>}

      {step === 2 && <form onSubmit={importStatement}>
        <header><span className={styles.bigIcon}><Icon name="upload" size={28} /></span><div><h2>Sube un extracto de {bankName}</h2><p>Descárgalo desde tu banco en CSV o Norma 43. Puede llamarse .n43, .norma43 o .txt.</p></div></header>
        <label className={styles.dropzone}><Icon name="files" size={34} /><strong>{file?.name || "Pulsa para elegir el extracto"}</strong><small>CSV o Norma 43 · máximo 5 MB</small><input type="file" required accept=".csv,.n43,.norma43,.txt,text/csv,text/plain" onChange={(event) => setFile(event.target.files?.[0] ?? null)} /></label>
        <details className={styles.helpDetails}><summary><Icon name="help" size={17} /> ¿Dónde lo encuentro?</summary><p>En la banca online busca “Movimientos”, “Descargar” o “Exportar”. Elige CSV o Norma 43. Si tienes dudas, prueba con el archivo: antes de guardar, la aplicación comprueba el formato y te explica cualquier error.</p></details>
        {error && <div className="form-alert" role="alert">{error}</div>}
        <footer><button type="button" className="button button-secondary" onClick={() => { setStep(1); setError(""); }}>Atrás</button><button className="button button-primary" disabled={busy || !file}>{busy ? "Leyendo extracto…" : "Importar y revisar"}</button></footer>
      </form>}

      {step === 3 && result && <section className={styles.result}>
        <span className={styles.successIcon}><Icon name="badge-check" size={38} /></span><h2>Extracto importado</h2><p>Los movimientos ya están disponibles para conciliarlos. Los duplicados no se han vuelto a guardar.</p>
        <dl><div><dt>Nuevos</dt><dd>{result.imported}</dd></div><div><dt>Duplicados</dt><dd>{result.duplicates}</dd></div><div><dt>Con error</dt><dd>{result.errors.length}</dd></div></dl>
        {result.errors.length > 0 && <details className={styles.helpDetails}><summary>Ver filas que necesitan revisión</summary><ul>{result.errors.slice(0, 20).map((item) => <li key={`${item.row}-${item.message}`}>Fila {item.row}: {item.message}</li>)}</ul></details>}
        <div className={styles.resultActions}><Link className="button button-primary" href="/economia">Ir a conciliar</Link><button className="button button-secondary" onClick={() => { setStep(2); setFile(null); setResult(null); }}>Importar otro</button></div>
      </section>}
    </main>

    <aside className={styles.automaticNote}><Icon name="info" size={20} /><div><strong>¿Y la sincronización automática?</strong><p>Se activará cuando la comunidad contrate un proveedor bancario PSD2 compatible. El proceso se iniciará siempre desde Comunidad Conecta, pero la autorización se hará en el entorno seguro del banco.</p></div></aside>
  </div>;
}
