"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import type { FinanceDashboardDTO } from "@/lib/finance-types";
import { formatBusinessMoment, formatDateTime, temporalZoneNote } from "@/lib/temporal";
import { DataWorkbench } from "./DataWorkbench";
import { Icon } from "./Icon";
import type { ModuleDefinition } from "@/lib/modules";
import { FeesWorkspace } from "./FeesWorkspace";
import { AccountingWorkspace } from "./AccountingWorkspace";
import { QuickFinanceRecordDialog } from "./QuickFinanceRecordDialog";
import { useTemporalPreferences } from "./TemporalContext";

const currency = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });
const labels: Record<string,string> = {
  charge:"Cuota",assessment:"Derrama",receipt:"Recibo",invoice:"Factura",budget:"Presupuesto",ledger:"Asiento",
  credit:"Ingreso",debit:"Cargo",paid:"Pagado",approved:"Aprobado",pending:"Pendiente",issued:"Emitido",
  matched:"Conciliado",suggested:"Parcial",unmatched:"Sin conciliar",returned:"Devuelto",draft:"Borrador"
};
function money(value:number){ return currency.format(value); }
function label(value:string){ return labels[value] ?? value; }

export function FinanceWorkspace({ canWrite, definition, showRecords = false }: { canWrite: boolean; definition: ModuleDefinition; showRecords?: boolean }) {
  const preferences=useTemporalPreferences();
  const [data,setData]=useState<FinanceDashboardDTO|null>(null);
  const [loading,setLoading]=useState(true);
  const [error,setError]=useState("");
  const [message,setMessage]=useState("");
  const [selected,setSelected]=useState<string|null>(null);
  const [allocations,setAllocations]=useState<Record<string,string>>({});
  const [note,setNote]=useState("");
  const [busy,setBusy]=useState(false);
  const [createOpen,setCreateOpen]=useState(false);
  const [section,setSection]=useState<"overview"|"fees"|"accounting">("overview");

  const load=useCallback(async()=>{
    setLoading(true); setError("");
    try{
      const response=await fetch("/api/finance/dashboard",{cache:"no-store"});
      const result=await response.json();
      if(!response.ok) throw new Error(result.error||"No se pudo cargar la economía.");
      setData(result);
    }catch(loadError){setError(loadError instanceof Error?loadError.message:"No se pudo cargar la economía.");}
    finally{setLoading(false);}
  },[]);
  useEffect(()=>{const timeout=window.setTimeout(()=>void load(),0);return()=>window.clearTimeout(timeout);},[load]);
  useEffect(()=>{if(!message)return;const timeout=window.setTimeout(()=>setMessage(""),5000);return()=>window.clearTimeout(timeout);},[message]);

  const transaction=useMemo(()=>data?.transactions.find(item=>item.id===selected)??null,[data,selected]);
  const allocatedInput=Object.values(allocations).reduce((sum,value)=>sum+(Number(value)||0),0);

  async function reconcile(){
    if(!transaction)return;
    const chosen=Object.entries(allocations).filter(([,value])=>Number(value)>0).map(([financialRecordId,amount])=>({financialRecordId,amount:Number(amount)}));
    if(!chosen.length){setError("Indica al menos un importe para conciliar.");return;}
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/finance/reconciliations",{method:"POST",headers:{"Content-Type":"application/json"},body:JSON.stringify({bankTransactionId:transaction.id,allocations:chosen,note})});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"No se pudo conciliar.");
      const accountingCopy=result.accountingEntries?.length?` ${result.accountingEntries.length === 1 ? "Asiento automático creado." : `${result.accountingEntries.length} asientos automáticos creados.`}`:"";
      setMessage((result.remaining>0?"Conciliación parcial guardada. Quedan "+money(result.remaining)+".":"Movimiento conciliado por completo.")+accountingCopy);
      setSelected(null);setAllocations({});setNote("");await load();
    }catch(reconcileError){setError(reconcileError instanceof Error?reconcileError.message:"No se pudo conciliar.");}
    finally{setBusy(false);}
  }

  async function reverse(id:string){
    if(!window.confirm("¿Deshacer esta asignación? La acción quedará registrada."))return;
    setBusy(true);setError("");
    try{
      const response=await fetch("/api/finance/reconciliations/"+id+"/reverse",{method:"POST"});
      const result=await response.json();if(!response.ok)throw new Error(result.error||"No se pudo deshacer.");
      setMessage(`Conciliación deshecha con trazabilidad.${result.accountingReversal ? " Reversión contable creada." : ""}`);await load();
    }catch(reverseError){setError(reverseError instanceof Error?reverseError.message:"No se pudo deshacer.");}
    finally{setBusy(false);}
  }

  if(loading&&!data)return <div className="page finance-workspace"><div className="finance-loading" aria-live="polite"><span className="spinner"/> Cargando economía…</div></div>;
  if(!data)return <div className="page finance-workspace"><div className="form-alert" role="alert">{error}</div><button className="button button-primary" onClick={()=>void load()}>Reintentar</button></div>;

  if(section==="fees") return <FeesWorkspace onBack={()=>setSection("overview")} canWrite={canWrite}/>;
  if(section==="accounting") return <AccountingWorkspace onBack={()=>setSection("overview")}/>;

  if (showRecords) return <DataWorkbench definition={definition} permissions={{ write: canWrite, archive: canWrite, export: true }} />;

  return <div className="page finance-workspace">
    <div className="module-breadcrumb"><Link href="/inicio">← Inicio</Link><span>/</span><span>Tesorería</span></div>
    <header className="page-heading finance-heading"><div><span className="eyebrow">ECONOMÍA CONECTADA</span><h1>Economía y conciliación</h1><p>Controla recibos, facturas y movimientos bancarios desde su origen hasta el pago.</p></div>
      <div className="heading-actions">{data.accounting.enabled&&data.accounting.accessible&&<button className="button button-secondary" onClick={()=>setSection("accounting")}><Icon name="book" size={18}/> Contabilidad</button>}{!data.accounting.enabled&&data.accounting.canManage&&<Link className="button button-secondary" href="/configuracion?tab=accounting"><Icon name="book" size={18}/> Activar contabilidad</Link>}<button className="button button-secondary" onClick={()=>setSection("fees")}><Icon name="wallet" size={18}/> Presupuestos y cuotas</button>{canWrite&&<Link className="button button-secondary" href="/conexion-bancaria"><Icon name="landmark" size={18}/> Conectar / importar banco</Link>}{canWrite&&definition.key==="economia"&&<button className="button button-primary" onClick={()=>setCreateOpen(true)}><Icon name="plus" size={18}/> Nuevo registro</button>}</div>
    </header>
    {error&&<div className="form-alert" role="alert">{error}</div>}
    <section className="finance-metrics" aria-label="Resumen económico">
      <article><small>Por cobrar</small><strong>{money(data.metrics.receivable)}</strong><span>Cuotas, recibos y derramas</span></article>
      <article className={data.metrics.overdue>0?"metric-danger":""}><small>Vencido</small><strong>{money(data.metrics.overdue)}</strong><span>Requiere seguimiento</span></article>
      <article><small>Cobrado</small><strong>{money(data.metrics.paid)}</strong><span>Registros pagados</span></article>
      <article><small>Banco pendiente</small><strong>{money(data.metrics.bankUnmatched)}</strong><span>{data.metrics.bankUnmatchedCount} movimientos</span></article>
    </section>
    <div className="finance-grid">
      <section className="finance-panel"><header><div><span className="section-chip">COBROS Y PAGOS</span><h2>Registros económicos</h2><p>Saldo pendiente después de las conciliaciones activas. {temporalZoneNote(preferences)}.</p></div><Link href="/economia?view=records">Ver gestión completa</Link></header>
        <div className="finance-table-wrap"><table className="finance-table"><caption className="sr-only">Registros económicos, emisión, vencimiento y saldo pendiente</caption><thead><tr><th>Concepto</th><th>Estado</th><th>Fecha y hora de emisión</th><th>Vence el (incluido)</th><th>Importe</th><th>Pendiente</th></tr></thead><tbody>
          {data.records.map(record=><tr key={record.id}><td><strong>{record.title}</strong><small>{record.code||label(record.kind)}</small></td><td><span className={"finance-status status-"+record.status}>{label(record.status)}</span>{record.status==="paid"&&<small>{record.paidAt?`Pagado el ${formatDateTime(record.paidAt,preferences,record.paidTimePrecision==="second")}`:"Fecha y hora de pago no registradas"}</small>}</td><td>{record.eventDate?formatBusinessMoment(record.eventDate,record.eventTimePrecision,preferences):"No registrada"}</td><td>{record.dueDate?formatBusinessMoment(record.dueDate,record.dueTimePrecision,preferences,{deadline:true,inclusive:record.dueInclusive}):"Sin vencimiento"}</td><td>{money(record.amount)}</td><td><strong>{money(record.remaining)}</strong></td></tr>)}
        </tbody></table></div>
      </section>
      <section className="finance-panel bank-panel"><header><div><span className="section-chip">BANCO</span><h2>Movimientos por conciliar</h2><p>Las coincidencias se explican; tú confirmas el resultado.</p></div><Link href="/bancos?view=records">Ver movimientos</Link></header>
        <div className="bank-list">{data.transactions.map(item=><article className={item.remaining?"bank-item":"bank-item bank-complete"} key={item.id}>
          <div className="bank-item-main"><span className={item.amount>=0?"bank-sign credit":"bank-sign debit"}>{item.amount>=0?"+":"−"}</span><div><strong>{item.title}</strong><small>Fecha y hora de valor: {formatBusinessMoment(item.eventDate,item.eventTimePrecision,preferences)} · {item.contact||item.code||label(item.kind)}</small></div><b>{money(item.amount)}</b></div>
          <div className="bank-progress"><span style={{width:Math.min(100,item.allocated/Math.max(Math.abs(item.amount),.01)*100)+"%"}}/><small>{item.remaining?money(item.remaining)+" pendientes":"Conciliado"}</small></div>
          {item.allocations.length>0&&<ul className="allocation-list">{item.allocations.map(allocation=><li key={allocation.id}><span>{allocation.financialTitle}</span><strong>{money(allocation.amount)}</strong>{canWrite&&<button onClick={()=>void reverse(allocation.id)} disabled={busy} aria-label={"Deshacer conciliación con "+allocation.financialTitle}><Icon name="undo" size={15}/></button>}</li>)}</ul>}
          {canWrite&&item.remaining>0&&<button className="button button-secondary bank-action" onClick={()=>{setSelected(item.id);const suggested=item.suggestions[0];setAllocations(suggested?{[suggested.financialRecordId]:String(suggested.recommendedAmount.toFixed(2))}:{});}}>Conciliar {item.suggestions.length?"· "+item.suggestions[0].score+"% sugerencia":"manualmente"}</button>}
        </article>)}</div>
      </section>
    </div>

    {createOpen&&<QuickFinanceRecordDialog onClose={()=>setCreateOpen(false)} onCreated={async()=>{setMessage("Registro económico creado.");await load();}}/>}

    {transaction&&<div className="modal-backdrop" role="presentation"><section className="record-dialog finance-dialog reconcile-dialog" role="dialog" aria-modal="true" aria-labelledby="reconcile-title"><header className="dialog-header"><div><span className="eyebrow">CONCILIACIÓN EXPLICABLE</span><h2 id="reconcile-title">{transaction.title}</h2><p>{money(transaction.remaining)} disponibles para asignar.</p></div><button className="icon-button" onClick={()=>setSelected(null)} aria-label="Cerrar"><Icon name="close"/></button></header><div className="dialog-scroll"><div className="suggestion-list">{data.records.filter(record=>record.remaining>0).map(record=>{const suggestion=transaction.suggestions.find(item=>item.financialRecordId===record.id);return <label className={suggestion?"suggestion-row recommended":"suggestion-row"} key={record.id}><span><strong>{record.title}</strong><small>{record.code||label(record.kind)} · Pendiente {money(record.remaining)}{suggestion?" · "+suggestion.score+"%: "+suggestion.reasons.join(", "):""}</small></span><span className="input-with-suffix"><input type="number" min="0" max={Math.min(record.remaining,transaction.remaining)} step=".01" value={allocations[record.id]||""} onChange={event=>setAllocations(current=>({...current,[record.id]:event.target.value}))} aria-label={"Importe para "+record.title}/><b>€</b></span></label>})}</div><label className="finance-note">Nota opcional<textarea value={note} onChange={event=>setNote(event.target.value)} maxLength={500} rows={3}/></label></div><footer className="dialog-footer"><span className={allocatedInput>transaction.remaining?"allocation-error":""}>Asignado: {money(allocatedInput)} / {money(transaction.remaining)}</span><div className="dialog-footer-actions"><button className="button button-secondary" onClick={()=>setSelected(null)}>Cancelar</button><button className="button button-primary" disabled={busy||allocatedInput<=0||allocatedInput>transaction.remaining} onClick={()=>void reconcile()}>{busy?"Guardando…":"Confirmar conciliación"}</button></div></footer></section></div>}
    {message&&<div className="toast" role="status"><Icon name="badge-check" size={18}/>{message}</div>}
  </div>;
}
