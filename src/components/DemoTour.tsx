"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { can, isResidentRole, type Role } from "@/lib/permissions";
import { Icon } from "./Icon";

interface TourStep {
  path: string;
  selector: string;
  title: string;
  body: string;
}

interface FocusRect { top: number; left: number; right: number; bottom: number; width: number; height: number }

function tourSteps(role: Role): TourStep[] {
  if (isResidentRole(role)) {
    const steps: TourStep[] = [
      { path: "/inicio", selector: ".resident-home-status-card", title: "Tu situación, de un vistazo", body: "Aquí ves tu vivienda y si tienes algún importe pendiente." },
      { path: "/inicio", selector: ".resident-quick-actions", title: "Lo que más utilizas", body: "Recibos, incidencias, reservas y documentos están a un toque." },
      { path: "/mi-vivienda", selector: ".resident-bank-home-card", title: "Tu vivienda", body: "Consulta datos, titulares, familia e inquilinos comunicados." }
    ];
    if (role === "owner" && can(role, "economia", "read")) {
      steps.push({ path: "/economia", selector: ".resident-fee-forecast", title: "Tu previsión anual", body: "Distingue lo pagado, lo pendiente y las cuotas todavía previstas." });
    }
    steps.push(
      { path: "/avisos", selector: ".data-card", title: "Comunicaciones claras", body: "Consulta cada aviso con su fecha, hora, alcance y documentos." },
      { path: "/incidencias", selector: ".operations-table-card", title: "Seguimiento de incidencias", body: "Abre una incidencia para ver evidencias, trabajos y cada cambio de estado." }
    );
    return steps;
  }

  const steps: TourStep[] = [
    { path: "/inicio", selector: ".dashboard-page", title: "El estado de la comunidad", body: "El inicio reúne alertas, actividad y asuntos que requieren atención." }
  ];
  if (can(role, "economia", "read")) steps.push({ path: "/economia", selector: ".finance-workspace", title: "Economía conectada", body: "Controla recibos, cuotas periódicas, pagos y conciliación bancaria." });
  if (can(role, "juntas", "read")) steps.push({ path: "/juntas", selector: ".governance-workspace", title: "Ciclo legal de las juntas", body: "Los hitos muestran qué está completo y cuál es el siguiente paso." });
  if (can(role, "incidencias", "read")) steps.push({ path: "/incidencias", selector: ".operations-table-card", title: "Incidencias ordenadas", body: "La tabla filtra el trabajo; el modal separa resumen, evidencias, órdenes y seguimiento." });
  if (can(role, "documentos", "read")) steps.push({ path: "/documentos", selector: ".data-card", title: "Documentación centralizada", body: "Actas, contratos y evidencias quedan localizables y protegidos por permisos." });
  return steps;
}

export function DemoTour({ role, pathname, request }: { role: Role; pathname: string; request: number }) {
  const router = useRouter();
  const steps = useMemo(() => tourSteps(role), [role]);
  const [open, setOpen] = useState(false);
  const [index, setIndex] = useState(0);
  const [rect, setRect] = useState<FocusRect | null>(null);
  const step = steps[index];

  function start() {
    setIndex(0);
    setRect(null);
    setOpen(true);
  }
  function finish() {
    sessionStorage.setItem(`cc-demo-tour-seen:${role}`, "1");
    setOpen(false);
    setRect(null);
  }

  useEffect(() => {
    if (request <= 0) return;
    const timeout = window.setTimeout(start, 0);
    return () => window.clearTimeout(timeout);
  }, [request]);
  useEffect(() => {
    if (sessionStorage.getItem(`cc-demo-tour-seen:${role}`)) return;
    const timeout = window.setTimeout(start, 850);
    return () => window.clearTimeout(timeout);
  }, [role]);
  useEffect(() => {
    if (!open) return;
    const close = (event: KeyboardEvent) => { if (event.key === "Escape") finish(); };
    window.addEventListener("keydown", close);
    return () => window.removeEventListener("keydown", close);
  });
  useEffect(() => {
    if (!open || !step) return;
    if (pathname !== step.path) {
      router.push(step.path);
      return;
    }
    let cancelled = false;
    let attempts = 0;
    let target: Element | null = null;
    const update = () => {
      if (cancelled || !target) return;
      const value = target.getBoundingClientRect();
      const pad = 7;
      setRect({
        top: Math.max(5, value.top - pad), left: Math.max(5, value.left - pad),
        right: Math.min(window.innerWidth - 5, value.right + pad), bottom: Math.min(window.innerHeight - 5, value.bottom + pad),
        width: Math.min(window.innerWidth - 10, value.width + pad * 2), height: Math.min(window.innerHeight - 10, value.height + pad * 2)
      });
    };
    const find = () => {
      if (cancelled) return;
      target = document.querySelector(step.selector);
      if (!target && attempts < 60) {
        attempts += 1;
        window.setTimeout(find, 100);
        return;
      }
      if (!target) { setRect(null); return; }
      const first = target.getBoundingClientRect();
      if (first.top < 20 || first.bottom > window.innerHeight - 20) target.scrollIntoView({ behavior: "smooth", block: "center" });
      update();
      window.setTimeout(update, 360);
    };
    find();
    window.addEventListener("resize", update);
    window.addEventListener("scroll", update, true);
    return () => {
      cancelled = true;
      window.removeEventListener("resize", update);
      window.removeEventListener("scroll", update, true);
    };
  }, [index, open, pathname, router, step]);

  if (!open || !step || !rect) return null;
  const tooltipStyle = {
    left: Math.max(12, Math.min(window.innerWidth - 372, rect.left + rect.width / 2 - 180)),
    top: rect.bottom + 240 < window.innerHeight ? rect.bottom + 14 : Math.max(12, rect.top - 226)
  };
  return <div className="demo-tour" role="dialog" aria-modal="true" aria-labelledby="demo-tour-title">
    <>
      <span className="demo-tour-shade" style={{ top: 0, left: 0, right: 0, height: rect.top }} />
      <span className="demo-tour-shade" style={{ top: rect.top, left: 0, width: rect.left, height: rect.height }} />
      <span className="demo-tour-shade" style={{ top: rect.top, left: rect.right, right: 0, height: rect.height }} />
      <span className="demo-tour-shade" style={{ top: rect.bottom, left: 0, right: 0, bottom: 0 }} />
      <span className="demo-tour-focus" style={{ top: rect.top, left: rect.left, width: rect.width, height: rect.height }} />
    </>
    <section className="demo-tour-card" style={tooltipStyle}>
      <header><span><Icon name="sparkles" size={17} /> VISITA GUIADA</span><button type="button" onClick={finish} aria-label="Cerrar visita"><Icon name="close" size={18} /></button></header>
      <small>Paso {index + 1} de {steps.length}</small>
      <h2 id="demo-tour-title">{step.title}</h2>
      <p>{step.body}</p>
      <div className="demo-tour-progress" aria-hidden>{steps.map((_, position) => <i className={position <= index ? "active" : ""} key={position} />)}</div>
      <footer><button type="button" className="demo-tour-skip" onClick={finish}>{index === steps.length - 1 ? "Cerrar" : "Omitir"}</button><span>{index > 0 && <button type="button" className="button button-secondary" onClick={() => { setRect(null); setIndex((value) => value - 1); }}>Anterior</button>}<button type="button" className="button button-primary" onClick={() => { if (index === steps.length - 1) finish(); else { setRect(null); setIndex((value) => value + 1); } }}>{index === steps.length - 1 ? "Finalizar" : "Siguiente"} <Icon name="arrow-right" size={15} /></button></span></footer>
    </section>
  </div>;
}
