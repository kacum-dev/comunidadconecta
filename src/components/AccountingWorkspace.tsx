"use client";

import { Fragment, useCallback, useEffect, useMemo, useState } from "react";
import type { ReactNode } from "react";
import { Icon } from "./Icon";
import styles from "./AccountingWorkspace.module.css";

type PeriodStatus = "open" | "closing" | "closed";
type EntryStatus = "draft" | "review" | "posted";
type AccountType = "asset" | "liability" | "equity" | "income" | "expense" | "off_balance";
type NormalSide = "debit" | "credit";

interface Period {
  id: string;
  name: string;
  startsOn: string;
  endsOn: string;
  status: PeriodStatus;
  lockedThrough: string | null;
  closedAt: string | null;
}

interface Account {
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  normalSide: NormalSide;
  parentId: string | null;
  level: number;
  acceptsEntries: boolean;
  active: boolean;
  systemKey: string | null;
  isTemplate: boolean;
}

interface Journal {
  id: string;
  code: string;
  name: string;
  kind: string;
  active: boolean;
}

interface EntryLine {
  id: string;
  lineNumber: number;
  accountId: string;
  accountCode: string;
  accountName: string;
  description: string | null;
  debit: number;
  credit: number;
}

interface Entry {
  id: string;
  periodId: string;
  journalId: string;
  entryNumber: string | null;
  entryDate: string;
  documentDate: string | null;
  concept: string;
  reference: string | null;
  status: EntryStatus;
  createdBy: string | null;
  createdByName: string | null;
  submittedBy: string | null;
  submittedByName: string | null;
  submittedAt: string | null;
  postedBy: string | null;
  postedByName: string | null;
  postedAt: string | null;
  createdAt: string;
  reversalOfId: string | null;
  reversedByEntryId: string | null;
  sourceType: string | null;
  sourceId: string | null;
  journalCode: string;
  debit: number;
  credit: number;
  lines: EntryLine[];
}

interface Balance {
  id: string;
  code: string;
  name: string;
  accountType: AccountType;
  normalSide: NormalSide;
  active: boolean;
  balance: number;
  debit: number;
  credit: number;
}

interface Dashboard {
  periods: Period[];
  selectedPeriodId: string | null;
  accounts: Account[];
  journals: Journal[];
  entries: Entry[];
  trialBalance: Balance[];
  metrics: { bank: number; receivables: number; payables: number; income: number; expenses: number; result: number };
  stats: { draft: number; review: number; posted: number };
  chart: { templateAccounts: number; totalAccounts: number; activeAccounts: number; customAccounts: number };
  capabilities: { write: boolean; post: boolean; close: boolean; export: boolean };
}

type Tab = "summary" | "journal" | "accounts" | "reports";
type DraftLine = { accountId: string; description: string; debit: string; credit: string };

const euro = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const date = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeZone: "UTC" });
const dateTime = new Intl.DateTimeFormat("es-ES", { dateStyle: "medium", timeStyle: "short" });
const accountTypeLabels: Record<AccountType, string> = {
  asset: "Activo",
  liability: "Pasivo",
  equity: "Fondos y patrimonio",
  income: "Ingreso",
  expense: "Gasto",
  off_balance: "Fuera de balance",
};
const statusLabels: Record<EntryStatus, string> = { draft: "Borrador", review: "Por revisar", posted: "Contabilizado" };
const periodStatusLabels: Record<PeriodStatus, string> = { open: "Abierto", closing: "En cierre", closed: "Cerrado" };
const groupLabels: Record<string, string> = {
  "1": "Financiación y fondos",
  "2": "Bienes e inversiones",
  "3": "Existencias",
  "4": "Propietarios, proveedores y administraciones",
  "5": "Tesorería y financiación",
  "6": "Gastos",
  "7": "Ingresos",
  "8": "Gastos imputados al patrimonio",
  "9": "Ingresos imputados al patrimonio",
};

function browserDate() {
  const now = new Date();
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
}

function emptyLine(): DraftLine {
  return { accountId: "", description: "", debit: "", credit: "" };
}

async function responseError(response: Response, fallback: string) {
  const body = await response.json().catch(() => null) as { error?: string } | null;
  return body?.error || fallback;
}

export function AccountingWorkspace({ onBack }: { onBack: () => void }) {
  const [data, setData] = useState<Dashboard | null>(null);
  const [tab, setTab] = useState<Tab>("summary");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");
  const [selectedPeriodId, setSelectedPeriodId] = useState("");
  const [editorEntry, setEditorEntry] = useState<Entry | "new" | null>(null);
  const [selectedEntry, setSelectedEntry] = useState<Entry | null>(null);
  const [periodOpen, setPeriodOpen] = useState(false);
  const [accountOpen, setAccountOpen] = useState(false);
  const [entrySearch, setEntrySearch] = useState("");
  const [entryStatus, setEntryStatus] = useState<"all" | EntryStatus>("all");
  const [accountSearch, setAccountSearch] = useState("");
  const [showInactive, setShowInactive] = useState(false);

  const load = useCallback(async (periodId?: string) => {
    setLoading(true);
    setError("");
    try {
      const params = new URLSearchParams();
      if (periodId) params.set("periodId", periodId);
      const response = await fetch(`/api/finance/accounting${params.size ? `?${params}` : ""}`, { cache: "no-store" });
      if (!response.ok) throw new Error(await responseError(response, "No se pudo cargar la contabilidad."));
      const result = await response.json() as Dashboard;
      setData(result);
      setSelectedPeriodId(result.selectedPeriodId ?? "");
      setSelectedEntry((current) => current ? result.entries.find((entry) => entry.id === current.id) ?? null : null);
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "No se pudo cargar la contabilidad.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    const timer = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  useEffect(() => {
    if (!message) return;
    const timer = window.setTimeout(() => setMessage(""), 4500);
    return () => window.clearTimeout(timer);
  }, [message]);

  async function command(body: Record<string, unknown>, success: string) {
    setBusy(true);
    setError("");
    try {
      const response = await fetch("/api/finance/accounting", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      if (!response.ok) throw new Error(await responseError(response, "No se pudo completar la operación."));
      setMessage(success);
      await load(selectedPeriodId);
      return true;
    } catch (commandError) {
      setError(commandError instanceof Error ? commandError.message : "No se pudo completar la operación.");
      return false;
    } finally {
      setBusy(false);
    }
  }

  const filteredEntries = useMemo(() => {
    const query = entrySearch.trim().toLocaleLowerCase("es");
    return data?.entries.filter((entry) => {
      if (entryStatus !== "all" && entry.status !== entryStatus) return false;
      if (!query) return true;
      return [entry.entryNumber, entry.concept, entry.reference, entry.journalCode]
        .filter(Boolean)
        .some((value) => String(value).toLocaleLowerCase("es").includes(query));
    }) ?? [];
  }, [data, entrySearch, entryStatus]);

  const filteredAccounts = useMemo(() => {
    const query = accountSearch.trim().toLocaleLowerCase("es");
    return data?.accounts.filter((account) => {
      if (!showInactive && !account.active) return false;
      return !query || `${account.code} ${account.name}`.toLocaleLowerCase("es").includes(query);
    }) ?? [];
  }, [accountSearch, data, showInactive]);

  if (loading && !data) return <div className={styles.loading}><span className="spinner" /> Cargando contabilidad…</div>;
  if (!data) return <div className={styles.shell}><div className="form-alert" role="alert">{error}</div><button className="button button-primary" onClick={() => void load()}>Reintentar</button></div>;

  const selectedPeriod = data.periods.find((period) => period.id === selectedPeriodId) ?? null;
  const openPeriod = data.periods.find((period) => period.status === "open") ?? null;

  return <div className={styles.shell} data-accounting-workspace>
    <header className={styles.heading}>
      <div>
        <button className={styles.back} onClick={onBack}>← Economía</button>
        <span className="eyebrow">CONTABILIDAD DE LA COMUNIDAD</span>
        <h1>Libro contable</h1>
        <p>Plan de gestión basado en PGC, diario de doble partida e informes por ejercicio.</p>
      </div>
      <div className={styles.actions}>
        {data.capabilities.write && <button className="button button-secondary" onClick={() => setAccountOpen(true)}><Icon name="plus" size={17} /> Cuenta</button>}
        {data.capabilities.write && <button className="button button-secondary" onClick={() => setPeriodOpen(true)}><Icon name="calendar-check" size={17} /> Ejercicio</button>}
        {data.capabilities.write && <button className="button button-primary" disabled={!openPeriod} onClick={() => setEditorEntry("new")}><Icon name="plus" size={17} /> Nuevo asiento</button>}
      </div>
    </header>

    {error && <div className="form-alert" role="alert">{error}</div>}

    <div className={styles.navigationRow}>
      <nav className={styles.tabs} aria-label="Secciones contables">
        {(["summary", "journal", "accounts", "reports"] as const).map((key) => <button key={key} className={tab === key ? styles.active : ""} onClick={() => setTab(key)}>{({ summary: "Resumen", journal: "Diario", accounts: "Plan contable", reports: "Informes" })[key]}</button>)}
      </nav>
      <label className={styles.periodFilter}>Ejercicio
        <select value={selectedPeriodId} onChange={(event) => { setSelectedPeriodId(event.target.value); void load(event.target.value); }}>
          {data.periods.map((period) => <option value={period.id} key={period.id}>{period.name} · {periodStatusLabels[period.status]}</option>)}
        </select>
      </label>
    </div>

    {tab === "summary" && <>
      <section className={styles.metrics} aria-label="Resumen contable">
        <article><small>Banco y caja</small><strong>{euro.format(data.metrics.bank)}</strong><span>Cuentas 570 y 572</span></article>
        <article><small>Cuotas pendientes</small><strong>{euro.format(data.metrics.receivables)}</strong><span>Cuentas 430, 431 y 436</span></article>
        <article><small>Deudas con proveedores</small><strong>{euro.format(data.metrics.payables)}</strong><span>Cuentas 400 y 410</span></article>
        <article className={data.metrics.result < 0 ? styles.negative : styles.positive}><small>Resultado del ejercicio</small><strong>{euro.format(data.metrics.result)}</strong><span>Ingresos menos gastos</span></article>
      </section>
      <section className={styles.guide}>
        <div>
          <span className="section-chip">CONTROL Y TRAZABILIDAD</span>
          <h2>{selectedPeriod?.name ?? "Sin ejercicio"}</h2>
          <p>Los borradores se preparan, otra persona los contabiliza y los asientos publicados solo se corrigen mediante reversión.</p>
          <div className={styles.workflowStats}>
            <span><b>{data.stats.draft}</b> borradores</span>
            <span><b>{data.stats.review}</b> por revisar</span>
            <span><b>{data.stats.posted}</b> contabilizados</span>
          </div>
        </div>
        {selectedPeriod?.status === "open" && data.capabilities.close && <button className="button button-secondary" disabled={busy} onClick={() => {
          if (window.confirm(`¿Cerrar ${selectedPeriod.name}? Después no admitirá nuevos asientos.`)) void command({ action: "close_period", id: selectedPeriod.id }, "Ejercicio cerrado y bloqueado.");
        }}>Cerrar ejercicio</button>}
      </section>
      <EntryList entries={data.entries.slice(0, 8)} data={data} busy={busy} onSelect={setSelectedEntry} command={command} />
    </>}

    {tab === "journal" && <>
      <section className={styles.toolbar} aria-label="Filtros del diario">
        <label className={styles.search}><Icon name="search" size={17} /><span className="sr-only">Buscar asiento</span><input value={entrySearch} onChange={(event) => setEntrySearch(event.target.value)} placeholder="Buscar por número, concepto o referencia" /></label>
        <select value={entryStatus} onChange={(event) => setEntryStatus(event.target.value as "all" | EntryStatus)} aria-label="Filtrar por estado">
          <option value="all">Todos los estados</option>
          <option value="draft">Borradores</option>
          <option value="review">Por revisar</option>
          <option value="posted">Contabilizados</option>
        </select>
        <span>{filteredEntries.length} asientos</span>
      </section>
      <EntryList entries={filteredEntries} data={data} busy={busy} onSelect={setSelectedEntry} command={command} />
    </>}

    {tab === "accounts" && <section className={styles.panel}>
      <header className={styles.panelHeader}>
        <div><span className="section-chip">PLAN DE GESTIÓN ADAPTADO</span><h2>Plan de cuentas</h2><p>{data.chart.activeAccounts} cuentas activas · estructura decimal basada en el PGC.</p></div>
        {data.capabilities.write && <button className="button button-primary" onClick={() => setAccountOpen(true)}><Icon name="plus" size={16} /> Añadir cuenta</button>}
      </header>
      <div className={styles.planNotice}><Icon name="info" size={18} /><span>La comunidad puede adaptar numeración y nombres. Este catálogo facilita la rendición de ingresos, gastos y situación financiera; no sustituye el criterio profesional aplicable a actividades empresariales especiales.</span></div>
      <div className={styles.toolbar}>
        <label className={styles.search}><Icon name="search" size={17} /><span className="sr-only">Buscar cuenta</span><input value={accountSearch} onChange={(event) => setAccountSearch(event.target.value)} placeholder="Buscar código o nombre" /></label>
        <label className={styles.check}><input type="checkbox" checked={showInactive} onChange={(event) => setShowInactive(event.target.checked)} /> Mostrar inactivas</label>
      </div>
      <div className={styles.tableWrap}><table><caption className="sr-only">Plan de cuentas de la comunidad</caption><thead><tr><th>Código</th><th>Cuenta</th><th>Tipo</th><th>Naturaleza</th><th>Estado</th><th><span className="sr-only">Acciones</span></th></tr></thead><tbody>
        {filteredAccounts.map((account, index) => {
          const group = account.code.charAt(0);
          const previousGroup = filteredAccounts[index - 1]?.code.charAt(0);
          return <Fragment key={account.id}>
            {group !== previousGroup && <tr className={styles.groupRow}><th colSpan={6}>Grupo {group} · {groupLabels[group] ?? "Otras cuentas"}</th></tr>}
            <tr className={!account.active ? styles.inactiveRow : ""}>
              <td><b>{account.code}</b></td>
              <td><strong>{account.name}</strong><small>{account.isTemplate ? "Catálogo base" : "Cuenta propia"}</small></td>
              <td>{accountTypeLabels[account.accountType]}</td>
              <td>{account.normalSide === "debit" ? "Deudora" : "Acreedora"}</td>
              <td><span className={`${styles.accountState} ${account.active ? styles.accountActive : styles.accountInactive}`}>{account.active ? "Activa" : "Inactiva"}</span></td>
              <td>{data.capabilities.write && !account.isTemplate && <button className={styles.rowAction} disabled={busy} onClick={() => void command({ action: "set_account_active", id: account.id, active: !account.active }, account.active ? "Cuenta desactivada." : "Cuenta activada.")}>{account.active ? "Desactivar" : "Activar"}</button>}</td>
            </tr>
          </Fragment>;
        })}
      </tbody></table></div>
    </section>}

    {tab === "reports" && <>
      <section className={styles.reportCards}>
        <article><small>Ingresos contabilizados</small><strong>{euro.format(data.metrics.income)}</strong></article>
        <article><small>Gastos contabilizados</small><strong>{euro.format(data.metrics.expenses)}</strong></article>
        <article className={data.metrics.result < 0 ? styles.negative : styles.positive}><small>Resultado</small><strong>{euro.format(data.metrics.result)}</strong></article>
      </section>
      <section className={styles.panel}>
        <header className={styles.panelHeader}><div><span className="section-chip">INFORME CONTABLE</span><h2>Balance de sumas y saldos</h2><p>Solo incluye asientos contabilizados en {selectedPeriod?.name ?? "el ejercicio seleccionado"}.</p></div>{data.capabilities.export && <a className="button button-secondary" href={`/api/finance/accounting?format=csv${selectedPeriodId ? `&periodId=${encodeURIComponent(selectedPeriodId)}` : ""}`}><Icon name="download" size={17} /> Exportar CSV</a>}</header>
        <div className={styles.tableWrap}><table><caption className="sr-only">Balance de sumas y saldos</caption><thead><tr><th>Cuenta</th><th>Nombre</th><th>Debe</th><th>Haber</th><th>Saldo</th></tr></thead><tbody>
          {data.trialBalance.filter((row) => Number(row.debit) || Number(row.credit)).length === 0 ? <tr><td colSpan={5} className={styles.empty}>Todavía no hay asientos contabilizados en este ejercicio.</td></tr> : data.trialBalance.filter((row) => Number(row.debit) || Number(row.credit)).map((row) => <tr key={row.id}><td><b>{row.code}</b></td><td>{row.name}</td><td>{euro.format(Number(row.debit))}</td><td>{euro.format(Number(row.credit))}</td><td><b>{euro.format(Number(row.balance))}</b></td></tr>)}
        </tbody><tfoot><tr><th colSpan={2}>Totales</th><th>{euro.format(data.trialBalance.reduce((sum, row) => sum + Number(row.debit), 0))}</th><th>{euro.format(data.trialBalance.reduce((sum, row) => sum + Number(row.credit), 0))}</th><th /></tr></tfoot></table></div>
      </section>
    </>}

    {editorEntry && <EntryEditorDialog
      data={data}
      entry={editorEntry === "new" ? null : editorEntry}
      busy={busy}
      onClose={() => setEditorEntry(null)}
      onSave={async (payload) => {
        const editing = editorEntry !== "new";
        const ok = await command({ action: editing ? "update_entry" : "create_entry", ...(editing ? { id: editorEntry.id } : {}), ...payload }, editing ? "Borrador actualizado." : "Asiento guardado como borrador.");
        if (ok) { setEditorEntry(null); setSelectedEntry(null); setTab("journal"); }
      }}
    />}
    {selectedEntry && <EntryDetailDialog entry={selectedEntry} data={data} busy={busy} onClose={() => setSelectedEntry(null)} onEdit={() => { setEditorEntry(selectedEntry); setSelectedEntry(null); }} command={async (body, success) => { const ok = await command(body, success); if (ok) setSelectedEntry(null); return ok; }} />}
    {periodOpen && <PeriodDialog busy={busy} onClose={() => setPeriodOpen(false)} onSave={async (body) => { if (await command({ action: "create_period", ...body }, "Ejercicio creado.")) setPeriodOpen(false); }} />}
    {accountOpen && <AccountDialog accounts={data.accounts} busy={busy} onClose={() => setAccountOpen(false)} onSave={async (body) => { if (await command({ action: "create_account", ...body }, "Cuenta añadida al plan.")) setAccountOpen(false); }} />}
    {message && <div className="toast" role="status"><Icon name="badge-check" size={18} />{message}</div>}
  </div>;
}

function EntryList({ entries, data, busy, onSelect, command }: { entries: Entry[]; data: Dashboard; busy: boolean; onSelect: (entry: Entry) => void; command: (body: Record<string, unknown>, success: string) => Promise<boolean> }) {
  return <section className={styles.panel}>
    <header className={styles.panelHeader}><div><span className="section-chip">LIBRO DIARIO</span><h2>Asientos</h2><p>Preparación, revisión y contabilización con trazabilidad.</p></div></header>
    <div className={styles.tableWrap}><table className={styles.entryTable}><caption className="sr-only">Asientos del ejercicio</caption><thead><tr><th>Nº</th><th>Fecha</th><th>Diario</th><th>Concepto</th><th>Importe</th><th>Estado</th><th>Acción</th></tr></thead><tbody>
      {entries.length === 0 ? <tr><td colSpan={7} className={styles.empty}>No hay asientos que coincidan con la selección.</td></tr> : entries.map((entry) => <tr key={entry.id}>
        <td>{entry.entryNumber ?? "—"}</td><td>{date.format(new Date(`${entry.entryDate}T00:00:00Z`))}</td><td>{entry.journalCode}</td><td><button className={styles.entryLink} onClick={() => onSelect(entry)}><strong>{entry.concept}</strong>{entry.reference && <small>{entry.reference}</small>}{entry.sourceType?.startsWith("financial_record.") && <small className={styles.automaticLabel}>Automático · Economía</small>}</button></td><td>{euro.format(Number(entry.debit))}</td><td><span className={`${styles.status} ${styles[entry.status]}`}>{statusLabels[entry.status]}</span>{entry.reversedByEntryId && <small>Revertido</small>}{entry.reversalOfId && <small>Asiento de reversión</small>}</td><td><div className={styles.rowActions}><button className={styles.rowAction} onClick={() => onSelect(entry)}>Ver</button>{entry.status === "draft" && data.capabilities.write && <button className={styles.rowAction} disabled={busy} onClick={() => void command({ action: "submit_entry", id: entry.id }, "Asiento enviado a revisión.")}>Enviar</button>}{entry.status === "review" && data.capabilities.post && <button className={styles.rowAction} disabled={busy} onClick={() => void command({ action: "post_entry", id: entry.id }, "Asiento contabilizado.")}>Contabilizar</button>}</div></td>
      </tr>)}
    </tbody></table></div>
    <div className={styles.mobileEntries}>{entries.map((entry) => <button key={entry.id} className={styles.mobileEntry} onClick={() => onSelect(entry)}><span><small>{entry.entryNumber ? `Asiento ${entry.entryNumber}` : "Borrador sin número"} · {date.format(new Date(`${entry.entryDate}T00:00:00Z`))}</small><strong>{entry.concept}</strong><em>{entry.journalCode}</em></span><span><b>{euro.format(Number(entry.debit))}</b><i className={`${styles.status} ${styles[entry.status]}`}>{statusLabels[entry.status]}</i></span></button>)}</div>
  </section>;
}

function EntryEditorDialog({ data, entry, busy, onClose, onSave }: { data: Dashboard; entry: Entry | null; busy: boolean; onClose: () => void; onSave: (payload: Record<string, unknown>) => Promise<void> }) {
  const openPeriods = data.periods.filter((period) => period.status === "open");
  const activeJournals = data.journals.filter((journal) => journal.active);
  const activeAccounts = data.accounts.filter((account) => account.active && account.acceptsEntries);
  const [periodId, setPeriodId] = useState(entry?.periodId ?? data.selectedPeriodId ?? openPeriods[0]?.id ?? "");
  const [journalId, setJournalId] = useState(entry?.journalId ?? activeJournals.find((journal) => journal.code === "GENERAL")?.id ?? activeJournals[0]?.id ?? "");
  const [entryDate, setEntryDate] = useState(entry?.entryDate ?? browserDate());
  const [concept, setConcept] = useState(entry?.concept ?? "");
  const [reference, setReference] = useState(entry?.reference ?? "");
  const [lines, setLines] = useState<DraftLine[]>(entry ? entry.lines.map((line) => ({ accountId: line.accountId, description: line.description ?? "", debit: Number(line.debit) ? String(Number(line.debit)) : "", credit: Number(line.credit) ? String(Number(line.credit)) : "" })) : [emptyLine(), emptyLine()]);

  const totals = useMemo(() => lines.reduce((value, line) => ({ debit: value.debit + (Number(line.debit) || 0), credit: value.credit + (Number(line.credit) || 0) }), { debit: 0, credit: 0 }), [lines]);
  const hasAmounts = totals.debit > 0 || totals.credit > 0;
  const balanced = totals.debit > 0 && Math.abs(totals.debit - totals.credit) < 0.001;
  const completeLines = lines.length >= 2 && lines.every((line) => line.accountId && ((Number(line.debit) > 0) !== (Number(line.credit) > 0)));
  const canSave = Boolean(concept.trim() && periodId && journalId && entryDate && completeLines && balanced);

  function updateLine(index: number, field: keyof DraftLine, value: string) {
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      if (field === "debit" && Number(value) > 0) return { ...line, debit: value, credit: "" };
      if (field === "credit" && Number(value) > 0) return { ...line, credit: value, debit: "" };
      return { ...line, [field]: value };
    }));
  }

  return <div className="modal-backdrop" role="presentation"><section className={`${styles.dialog} record-dialog`} role="dialog" aria-modal="true" aria-labelledby="accounting-entry-title">
    <header className={styles.dialogHeader}><div><span className="eyebrow">DOBLE PARTIDA</span><h2 id="accounting-entry-title">{entry ? "Editar borrador" : "Nuevo asiento"}</h2><p>Completa los datos y registra al menos dos apuntes con el mismo total en Debe y Haber.</p></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button></header>
    <div className={styles.dialogBody}>
      <section className={styles.formSection}><h3>Datos del asiento</h3><div className={styles.formGrid}>
        <label>Ejercicio<select value={periodId} onChange={(event) => setPeriodId(event.target.value)}>{openPeriods.map((period) => <option value={period.id} key={period.id}>{period.name}</option>)}</select></label>
        <label>Diario<select value={journalId} onChange={(event) => setJournalId(event.target.value)}>{activeJournals.map((journal) => <option value={journal.id} key={journal.id}>{journal.name}</option>)}</select></label>
        <label>Fecha<input type="date" value={entryDate} onChange={(event) => setEntryDate(event.target.value)} /></label>
        <label>Referencia <span>opcional</span><input value={reference} onChange={(event) => setReference(event.target.value)} maxLength={120} placeholder="Factura, recibo…" /></label>
        <label className={styles.full}>Concepto<input value={concept} onChange={(event) => setConcept(event.target.value)} maxLength={240} placeholder="Describe brevemente la operación" required /></label>
      </div></section>
      <section className={styles.formSection}><div className={styles.linesTitle}><div><h3>Apuntes</h3><p>Cada fila lleva importe solo en una de las dos columnas.</p></div><span>{lines.length} líneas</span></div>
        <div className={styles.lineHead}><span>Cuenta</span><span>Descripción</span><span>Debe</span><span>Haber</span><span /></div>
        <div className={styles.lines}>{lines.map((line, index) => <div className={styles.line} key={index}>
          <label><span>Cuenta</span><select value={line.accountId} onChange={(event) => updateLine(index, "accountId", event.target.value)} aria-label={`Cuenta línea ${index + 1}`}><option value="">Selecciona una cuenta</option>{activeAccounts.map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
          <label><span>Descripción</span><input value={line.description} onChange={(event) => updateLine(index, "description", event.target.value)} placeholder="Detalle opcional" maxLength={300} /></label>
          <label className={styles.amountField}><span>Debe</span><input type="number" inputMode="decimal" min="0" max="999999999.99" step="0.01" value={line.debit} onChange={(event) => updateLine(index, "debit", event.target.value)} placeholder="0,00" aria-label={`Debe línea ${index + 1}`} /><b>€</b></label>
          <label className={styles.amountField}><span>Haber</span><input type="number" inputMode="decimal" min="0" max="999999999.99" step="0.01" value={line.credit} onChange={(event) => updateLine(index, "credit", event.target.value)} placeholder="0,00" aria-label={`Haber línea ${index + 1}`} /><b>€</b></label>
          <button className={styles.removeLine} disabled={lines.length <= 2} onClick={() => setLines((current) => current.filter((_, lineIndex) => lineIndex !== index))} aria-label={`Eliminar línea ${index + 1}`} title="Eliminar línea"><Icon name="trash" size={17} /></button>
        </div>)}</div>
        <button className={styles.addLine} onClick={() => setLines((current) => [...current, emptyLine()])}><Icon name="plus" size={16} /> Añadir línea</button>
      </section>
      <div className={`${styles.totals} ${!hasAmounts ? styles.totalsEmpty : balanced ? styles.balanced : styles.unbalanced}`} aria-live="polite"><span><small>Debe</small><b>{euro.format(totals.debit)}</b></span><span><small>Haber</small><b>{euro.format(totals.credit)}</b></span><strong>{!hasAmounts ? "Añade los importes del asiento" : balanced ? <><Icon name="badge-check" size={18} /> Asiento cuadrado</> : `Diferencia: ${euro.format(Math.abs(totals.debit - totals.credit))}`}</strong></div>
    </div>
    <footer className={styles.dialogFooter}><span>{!canSave && hasAmounts ? "Completa cuentas, concepto y cuadratura para guardar." : "Se guardará como borrador editable."}</span><div><button className="button button-secondary" onClick={onClose}>Cancelar</button><button className="button button-primary" disabled={busy || !canSave} onClick={() => void onSave({ periodId, journalId, entryDate, concept, reference, lines: lines.map((line) => ({ accountId: line.accountId, description: line.description, debit: Number(line.debit) || 0, credit: Number(line.credit) || 0 })) })}>{busy ? "Guardando…" : entry ? "Guardar cambios" : "Guardar borrador"}</button></div></footer>
  </section></div>;
}

function EntryDetailDialog({ entry, data, busy, onClose, onEdit, command }: { entry: Entry; data: Dashboard; busy: boolean; onClose: () => void; onEdit: () => void; command: (body: Record<string, unknown>, success: string) => Promise<boolean> }) {
  return <div className="modal-backdrop" role="presentation"><section className={`${styles.detailDialog} record-dialog`} role="dialog" aria-modal="true" aria-labelledby="entry-detail-title">
    <header className={styles.dialogHeader}><div><span className="eyebrow">{entry.entryNumber ? `ASIENTO ${entry.entryNumber}` : "BORRADOR"}</span><h2 id="entry-detail-title">{entry.concept}</h2><p>{entry.journalCode} · {date.format(new Date(`${entry.entryDate}T00:00:00Z`))}{entry.reference ? ` · ${entry.reference}` : ""}</p></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button></header>
    <div className={styles.dialogBody}>
      <div className={styles.detailSummary}><span className={`${styles.status} ${styles[entry.status]}`}>{statusLabels[entry.status]}</span>{entry.sourceType?.startsWith("financial_record.") && <span className={styles.automaticBadge}><Icon name="sparkles" size={15} /> Automático</span>}<strong>{euro.format(Number(entry.debit))}</strong>{entry.reversedByEntryId && <span className={styles.reversal}>Revertido</span>}{entry.reversalOfId && <span className={styles.reversal}>Reversión</span>}</div>
      <div className={styles.detailTable}><div className={styles.detailTableHead}><span>Cuenta</span><span>Descripción</span><span>Debe</span><span>Haber</span></div>{entry.lines.map((line) => <div className={styles.detailLine} key={line.id}><span><b>{line.accountCode}</b><small>{line.accountName}</small></span><span>{line.description || "—"}</span><span>{Number(line.debit) ? euro.format(Number(line.debit)) : "—"}</span><span>{Number(line.credit) ? euro.format(Number(line.credit)) : "—"}</span></div>)}</div>
      <dl className={styles.auditTrail}><div><dt>Preparado por</dt><dd>{entry.createdByName || "No identificado"}<small>{entry.createdAt ? dateTime.format(new Date(entry.createdAt)) : ""}</small></dd></div>{entry.submittedAt && <div><dt>Enviado a revisión</dt><dd>{entry.submittedByName || "No identificado"}<small>{dateTime.format(new Date(entry.submittedAt))}</small></dd></div>}{entry.postedAt && <div><dt>Contabilizado por</dt><dd>{entry.postedByName || "No identificado"}<small>{dateTime.format(new Date(entry.postedAt))}</small></dd></div>}</dl>
    </div>
    <footer className={styles.dialogFooter}><span>Los asientos contabilizados permanecen inmutables.</span><div>
      {entry.status === "draft" && data.capabilities.write && <><button className="button button-danger-ghost" disabled={busy} onClick={() => { if (window.confirm("¿Eliminar este borrador? Esta acción quedará auditada.")) void command({ action: "delete_entry", id: entry.id }, "Borrador eliminado."); }}><Icon name="trash" size={16} /> Eliminar</button><button className="button button-secondary" onClick={onEdit}><Icon name="pencil" size={16} /> Editar</button><button className="button button-primary" disabled={busy} onClick={() => void command({ action: "submit_entry", id: entry.id }, "Asiento enviado a revisión.")}>Enviar a revisión</button></>}
      {entry.status === "review" && data.capabilities.post && <><button className="button button-secondary" disabled={busy} onClick={() => void command({ action: "return_entry", id: entry.id }, "Asiento devuelto a borrador.")}>Devolver a borrador</button><button className="button button-primary" disabled={busy} onClick={() => void command({ action: "post_entry", id: entry.id }, "Asiento contabilizado.")}>Contabilizar</button></>}
      {entry.status === "posted" && !entry.reversalOfId && !entry.reversedByEntryId && data.capabilities.post && <button className="button button-secondary" disabled={busy} onClick={() => { if (window.confirm("Se creará un asiento inverso en el ejercicio abierto actual. El original seguirá visible.")) void command({ action: "reverse_entry", id: entry.id }, "Asiento revertido con trazabilidad."); }}><Icon name="undo" size={16} /> Revertir</button>}
    </div></footer>
  </section></div>;
}

function PeriodDialog({ busy, onClose, onSave }: { busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const year = new Date().getFullYear();
  const [name, setName] = useState(`Ejercicio ${year + 1}`);
  const [startsOn, setStartsOn] = useState(`${year + 1}-01-01`);
  const [endsOn, setEndsOn] = useState(`${year + 1}-12-31`);
  return <SimpleDialog title="Nuevo ejercicio" description="Los ejercicios no pueden solaparse con otros periodos." onClose={onClose}>
    <label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} maxLength={120} /></label>
    <div className={styles.twoColumns}><label>Desde<input type="date" value={startsOn} onChange={(event) => setStartsOn(event.target.value)} /></label><label>Hasta<input type="date" value={endsOn} onChange={(event) => setEndsOn(event.target.value)} /></label></div>
    <button className="button button-primary" disabled={busy || !name.trim() || !startsOn || !endsOn || startsOn > endsOn} onClick={() => void onSave({ name, startsOn, endsOn })}>{busy ? "Guardando…" : "Crear ejercicio"}</button>
  </SimpleDialog>;
}

function AccountDialog({ accounts, busy, onClose, onSave }: { accounts: Account[]; busy: boolean; onClose: () => void; onSave: (body: Record<string, unknown>) => Promise<void> }) {
  const [code, setCode] = useState("");
  const [name, setName] = useState("");
  const [accountType, setAccountType] = useState<AccountType>("expense");
  const [normalSide, setNormalSide] = useState<NormalSide>("debit");
  const [parentId, setParentId] = useState("");
  return <SimpleDialog title="Añadir cuenta" description="Crea una cuenta propia sin alterar el catálogo base." onClose={onClose}>
    <div className={styles.twoColumns}><label>Código<input inputMode="numeric" value={code} onChange={(event) => setCode(event.target.value.replace(/\D/g, ""))} placeholder="Ej. 6221" maxLength={10} /></label><label>Nombre<input value={name} onChange={(event) => setName(event.target.value)} maxLength={180} /></label></div>
    <label>Cuenta superior <span>opcional</span><select value={parentId} onChange={(event) => setParentId(event.target.value)}><option value="">Sin cuenta superior</option>{accounts.filter((account) => account.active && account.level < 8).map((account) => <option key={account.id} value={account.id}>{account.code} · {account.name}</option>)}</select></label>
    <div className={styles.twoColumns}><label>Tipo<select value={accountType} onChange={(event) => setAccountType(event.target.value as AccountType)}>{Object.entries(accountTypeLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label>Naturaleza<select value={normalSide} onChange={(event) => setNormalSide(event.target.value as NormalSide)}><option value="debit">Deudora</option><option value="credit">Acreedora</option></select></label></div>
    <button className="button button-primary" disabled={busy || code.length < 3 || !name.trim()} onClick={() => void onSave({ code, name, accountType, normalSide, parentId: parentId || null })}>{busy ? "Guardando…" : "Añadir cuenta"}</button>
  </SimpleDialog>;
}

function SimpleDialog({ title, description, onClose, children }: { title: string; description: string; onClose: () => void; children: ReactNode }) {
  return <div className="modal-backdrop" role="presentation"><section className={`${styles.smallDialog} record-dialog`} role="dialog" aria-modal="true" aria-labelledby="simple-dialog-title"><header className={styles.dialogHeader}><div><h2 id="simple-dialog-title">{title}</h2><p>{description}</p></div><button className="icon-button" onClick={onClose} aria-label="Cerrar"><Icon name="close" /></button></header><div className={styles.smallDialogBody}>{children}</div></section></div>;
}
