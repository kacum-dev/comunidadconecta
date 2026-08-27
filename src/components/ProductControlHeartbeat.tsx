"use client";

import { useEffect } from "react";

const HEARTBEAT_KEY = "comunidad_conecta_product_control_heartbeat";
const ONE_DAY = 24 * 60 * 60 * 1000;

export function ProductControlHeartbeat() {
  useEffect(() => {
    const now = Date.now();
    const lastAttempt = Number(window.localStorage.getItem(HEARTBEAT_KEY) || 0);
    if (Number.isFinite(lastAttempt) && now - lastAttempt < ONE_DAY) return;

    window.localStorage.setItem(HEARTBEAT_KEY, String(now));
    void fetch("/api/settings/product-control/sync", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ force: false })
    }).catch(() => {
      window.localStorage.removeItem(HEARTBEAT_KEY);
    });
  }, []);

  return null;
}
