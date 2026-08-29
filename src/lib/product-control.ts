import "server-only";

import { createPublicKey, verify } from "node:crypto";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { query, withTenant } from "./db";
import { canManageSettings } from "./permissions";
import { aggregateRange, safeAppVersion, type ProductControlState, type ProductUsageType, type TelemetryLevel } from "./product-control-domain";

interface ProductControlRow {
  installation_id: string;
  product_code: string;
  usage_type: ProductUsageType;
  telemetry_level: TelemetryLevel;
  license_id: string | null;
  license_certificate: string | null;
  license_public_key: string | null;
  license_major_version: number | null;
  activated_at: Date | null;
  last_sync_at: Date | null;
  last_sync_status: "never" | "ok" | "error";
  last_sync_error: string | null;
}

const PRODUCT_CODE = (process.env.COMMUNITY_CONNECTA_PRODUCT_CODE || "comunidad-conecta").trim().toLowerCase();
const APP_VERSION = safeAppVersion(process.env.APP_VERSION);

function planeUrl() {
  return (process.env.KACUM_CONTROL_PLANE_URL || "").trim().replace(/\/$/, "");
}

async function row(): Promise<ProductControlRow> {
  const result = await query<ProductControlRow>(
    `SELECT installation_id::text,product_code,usage_type,telemetry_level,license_id,
            license_certificate,license_public_key,license_major_version,activated_at,
            last_sync_at,last_sync_status,last_sync_error
       FROM product_control_installation
      WHERE singleton=true`
  );
  if (!result.rowCount) throw new Error("product_control_installation_missing");
  return result.rows[0];
}

function decodeBase64Url(value: string) {
  return Buffer.from(value, "base64url");
}

function certificateIsValid(value: ProductControlRow) {
  if (!value.license_certificate || !value.license_public_key || !value.license_id) return false;
  try {
    const [payloadPart, signaturePart] = value.license_certificate.split(".");
    if (!payloadPart || !signaturePart) return false;
    const payloadBytes = decodeBase64Url(payloadPart);
    const signature = decodeBase64Url(signaturePart);
    const publicKey = createPublicKey({
      key: decodeBase64Url(value.license_public_key),
      format: "der",
      type: "spki"
    });
    if (!verify(null, payloadBytes, publicKey, signature)) return false;
    const payload = JSON.parse(payloadBytes.toString("utf8")) as Record<string, unknown>;
    const currentMajorVersion = Number(APP_VERSION.split(".")[0]);
    return payload.product_code === PRODUCT_CODE
      && payload.installation_id === value.installation_id
      && payload.license_id === value.license_id
      && payload.license_type === "commercial"
      && payload.major_version === value.license_major_version
      && payload.major_version === currentMajorVersion
      && payload.expires_at === null;
  } catch {
    return false;
  }
}

function stateFromRow(value: ProductControlRow): ProductControlState {
  return {
    installationId: value.installation_id,
    productCode: value.product_code,
    usageType: value.usage_type,
    telemetryLevel: value.telemetry_level,
    controlPlaneConfigured: Boolean(planeUrl()),
    commercialLicense: {
      active: certificateIsValid(value),
      licenseId: value.license_id,
      majorVersion: value.license_major_version,
      activatedAt: value.activated_at?.toISOString() ?? null
    },
    lastSyncAt: value.last_sync_at?.toISOString() ?? null,
    lastSyncStatus: value.last_sync_status,
    lastSyncError: value.last_sync_error
  };
}

export async function getProductControlState() {
  return stateFromRow(await row());
}

function assertCanManage(context: AuthContext) {
  if (!canManageSettings(context.current.role) || context.isDemo) {
    throw new ApiError(403, "Solo la administración puede configurar esta instalación.", "forbidden");
  }
}

export async function updateProductControl(
  context: AuthContext,
  input: { usageType: ProductUsageType; telemetryLevel: TelemetryLevel },
  userAgent?: string | null
) {
  assertCanManage(context);
  const before = await row();
  if (input.usageType === "commercial" && !certificateIsValid(before)) {
    throw new ApiError(409, "Activa una licencia comercial válida antes de declarar este uso.", "commercial_license_required");
  }
  await query(
    `UPDATE product_control_installation
        SET product_code=$1,usage_type=$2,telemetry_level=$3,last_sync_error=NULL
      WHERE singleton=true`,
    [PRODUCT_CODE, input.usageType, input.telemetryLevel]
  );
  await withTenant(context.current.communityId, context.user.id, (client) => writeAudit(client, {
    communityId: context.current.communityId,
    userId: context.user.id,
    action: "settings.product_control_updated",
    resourceType: "installation_settings",
    resourceId: before.installation_id,
    before: { usageType: before.usage_type, telemetryLevel: before.telemetry_level },
    after: input,
    userAgent
  }));
  if (input.telemetryLevel !== "disabled") await syncProductControl(true).catch(() => undefined);
  return getProductControlState();
}

async function aggregateTelemetry(value: ProductControlRow) {
  const counts = await query<{
    properties: string;
    active_users: string;
    tickets: string;
    documents: string;
    meetings: string;
    communications: string;
    finance: string;
  }>(
    `SELECT
       (SELECT count(*)::text FROM private_units WHERE status='active') AS properties,
       (SELECT count(DISTINCT user_id)::text FROM user_sessions WHERE last_seen_at >= now() - interval '30 days' AND revoked_at IS NULL) AS active_users,
       (SELECT count(*)::text FROM tickets WHERE archived_at IS NULL) AS tickets,
       (SELECT count(*)::text FROM documents WHERE archived_at IS NULL) AS documents,
       (SELECT count(*)::text FROM meetings WHERE archived_at IS NULL) AS meetings,
       (SELECT count(*)::text FROM communications WHERE archived_at IS NULL) AS communications,
       (SELECT count(*)::text FROM financial_records WHERE archived_at IS NULL) AS finance`
  );
  const current = counts.rows[0];
  return {
    product_code: PRODUCT_CODE,
    installation_id: value.installation_id,
    app_version: APP_VERSION,
    deployment_type: "self_hosted",
    usage_type: value.usage_type,
    telemetry_level: value.telemetry_level === "product" ? "product" : "basic",
    properties_range: aggregateRange(Number(current.properties)),
    active_users_30d_range: aggregateRange(Number(current.active_users)),
    features: value.telemetry_level === "product" ? {
      incidents: Number(current.tickets) > 0,
      documents: Number(current.documents) > 0,
      meetings: Number(current.meetings) > 0,
      communications: Number(current.communications) > 0,
      finance: Number(current.finance) > 0
    } : {},
    health: { database: "ok" as const }
  };
}

async function post(path: string, body: unknown) {
  const base = planeUrl();
  if (!base) throw new ApiError(503, "Kacum no está configurado en esta instalación.", "control_plane_not_configured");
  const response = await fetch(`${base}${path}`, {
    method: "POST",
    headers: { "Content-Type": "application/json", "User-Agent": `ComunidadConecta/${APP_VERSION}` },
    body: JSON.stringify(body),
    cache: "no-store",
    signal: AbortSignal.timeout(8000)
  });
  const result = await response.json().catch(() => ({})) as Record<string, unknown>;
  if (!response.ok) throw new ApiError(response.status, String(result.detail || result.error || "Kacum rechazó la solicitud."), "control_plane_error");
  return result;
}

async function rememberSync(status: "ok" | "error", error?: unknown) {
  const errorMessage = error instanceof Error ? error.message.slice(0, 500) : null;
  await query(
    `UPDATE product_control_installation
        SET last_sync_at=now(),last_sync_status=$1,last_sync_error=$2
      WHERE singleton=true`,
    [status, errorMessage]
  );
}

export async function syncProductControl(force = false) {
  const value = await row();
  if (value.telemetry_level === "disabled") return stateFromRow(value);
  if (!force && value.last_sync_at && Date.now() - value.last_sync_at.getTime() < 7 * 24 * 60 * 60 * 1000) {
    return stateFromRow(value);
  }
  try {
    const payload = await aggregateTelemetry(value);
    await post("/api/product-control/v1/telemetry", payload);
    await rememberSync("ok");
  } catch (error) {
    await rememberSync("error", error);
    throw error;
  }
  return getProductControlState();
}

export async function activateCommercialLicense(context: AuthContext, licenseKey: string, userAgent?: string | null) {
  assertCanManage(context);
  const value = await row();
  const result = await post("/api/product-control/v1/licenses/activate", {
    product_code: PRODUCT_CODE,
    installation_id: value.installation_id,
    app_version: APP_VERSION,
    deployment_type: "self_hosted",
    license_key: licenseKey.trim()
  });
  const certificate = String(result.certificate || "");
  const publicKey = String(result.public_key || "");
  const payload = result.payload as Record<string, unknown> | undefined;
  if (!certificate || !publicKey || !payload?.license_id) {
    throw new ApiError(502, "Kacum devolvió una licencia incompleta.", "invalid_certificate");
  }
  const candidate: ProductControlRow = {
    ...value,
    license_id: String(payload.license_id),
    license_certificate: certificate,
    license_public_key: publicKey,
    license_major_version: Number(payload.major_version)
  };
  if (!certificateIsValid(candidate)) {
    throw new ApiError(502, "No se pudo verificar la firma de la licencia.", "invalid_certificate");
  }
  await query(
    `UPDATE product_control_installation
        SET usage_type='commercial',license_id=$1,license_certificate=$2,license_public_key=$3,
            license_major_version=$4,activated_at=now(),last_sync_at=now(),last_sync_status='ok',last_sync_error=NULL
      WHERE singleton=true`,
    [String(payload.license_id), certificate, publicKey, Number(payload.major_version)]
  );
  const saved = await row();
  await withTenant(context.current.communityId, context.user.id, (client) => writeAudit(client, {
    communityId: context.current.communityId,
    userId: context.user.id,
    action: "license.commercial_activated",
    resourceType: "installation_license",
    resourceId: value.installation_id,
    after: { licenseId: String(payload.license_id), majorVersion: Number(payload.major_version) },
    userAgent
  }));
  return stateFromRow(saved);
}
