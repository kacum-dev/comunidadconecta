import "server-only";

export type InstanceMode = "demo" | "customer";

const INSTANCE_MODE_ENV = "KACUM_INSTANCE_MODE";

export function getInstanceMode(): InstanceMode {
  const raw = (process.env[INSTANCE_MODE_ENV] || "customer").trim().toLowerCase();
  if (raw === "demo" || raw === "customer") return raw;
  throw new Error(`${INSTANCE_MODE_ENV} debe ser "demo" o "customer".`);
}

export function isDemoInstance(): boolean {
  return getInstanceMode() === "demo";
}

export function isCustomerInstance(): boolean {
  return getInstanceMode() === "customer";
}

export function assertDemoInstance(): void {
  if (!isDemoInstance()) throw new Error("Demo no disponible en esta instalación.");
}

export function assertCustomerInstance(): void {
  if (!isCustomerInstance()) throw new Error("El acceso privado no está disponible en la instancia demo.");
}
