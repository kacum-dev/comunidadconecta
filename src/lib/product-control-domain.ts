export type ProductUsageType = "community" | "nonprofit" | "demo" | "development" | "commercial";
export type TelemetryLevel = "disabled" | "basic" | "product";
export type AggregateRange = "unknown" | "0" | "1-10" | "11-25" | "26-50" | "51-100" | "101-250" | "251-500" | "500+";

export interface ProductControlState {
  installationId: string;
  productCode: string;
  usageType: ProductUsageType;
  telemetryLevel: TelemetryLevel;
  controlPlaneConfigured: boolean;
  commercialLicense: {
    active: boolean;
    licenseId: string | null;
    majorVersion: number | null;
    activatedAt: string | null;
  };
  lastSyncAt: string | null;
  lastSyncStatus: "never" | "ok" | "error";
  lastSyncError: string | null;
}

export const usageLabels: Record<ProductUsageType, string> = {
  community: "Comunidad de propietarios",
  nonprofit: "Entidad sin ánimo de lucro",
  demo: "Demostración",
  development: "Desarrollo o pruebas",
  commercial: "Uso comercial"
};

export function aggregateRange(value: number): AggregateRange {
  if (!Number.isFinite(value) || value < 0) return "unknown";
  if (value === 0) return "0";
  if (value <= 10) return "1-10";
  if (value <= 25) return "11-25";
  if (value <= 50) return "26-50";
  if (value <= 100) return "51-100";
  if (value <= 250) return "101-250";
  if (value <= 500) return "251-500";
  return "500+";
}

export function safeAppVersion(value: string | undefined) {
  const normalized = String(value ?? "1.0.0").trim();
  return /^\d+\.\d+\.\d+(?:[-+][a-zA-Z0-9.-]+)?$/.test(normalized) ? normalized.slice(0, 40) : "1.0.0";
}
