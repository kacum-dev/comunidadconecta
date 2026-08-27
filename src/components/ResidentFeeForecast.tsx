"use client";

import { useCallback, useEffect, useState } from "react";
import { Icon } from "./Icon";

interface Forecast {
  year: number;
  generatedCents: number;
  paidCents: number;
  pendingCents: number;
  plannedCents: number;
  estimatedCents: number;
}

const money = (cents: number) => new Intl.NumberFormat("es-ES", {
  style: "currency",
  currency: "EUR"
}).format(cents / 100);

export function ResidentFeeForecast() {
  const [forecast, setForecast] = useState<Forecast | null>(null);
  const load = useCallback(async () => {
    try {
      const response = await fetch("/api/fees/dashboard", { cache: "no-store" });
      const body = await response.json();
      if (response.ok) setForecast(body.annualForecast);
    } catch {
      // La tabla de recibos sigue disponible aunque falle esta ayuda estimativa.
    }
  }, []);

  useEffect(() => {
    const timeout = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(timeout);
  }, [load]);

  if (!forecast) return null;
  return <section className="fee-forecast resident-fee-forecast" aria-label={`Estimación de cuotas de ${forecast.year}`}>
    <header><span><Icon name="wallet" size={19} /></span><span><small>PREVISIÓN DE TU VIVIENDA</small><strong>Estimación de cuotas {forecast.year}</strong></span><b>{money(forecast.estimatedCents)}</b></header>
    <div>
      <article><small>Generado</small><strong>{money(forecast.generatedCents)}</strong><span>Recibos ya emitidos</span></article>
      <article><small>Pagado</small><strong>{money(forecast.paidCents)}</strong><span>Parte ya cobrada</span></article>
      <article><small>Pendiente emitido</small><strong>{money(forecast.pendingCents)}</strong><span>Generado aún sin pagar</span></article>
      <article><small>Todavía previsto</small><strong>{money(forecast.plannedCents)}</strong><span>Próximas cuotas periódicas</span></article>
    </div>
    <p><Icon name="info" size={15} /> Es una estimación y se actualiza con cada emisión o pago.</p>
  </section>;
}
