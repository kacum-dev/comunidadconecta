import "server-only";

import { timingSafeEqual } from "node:crypto";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { query, withTenant } from "./db";
import { canManageSettings } from "./permissions";

export interface CommunicationFeatureState {
  enabled: boolean;
}

const disabledError = () => new ApiError(
  404,
  "El centro de comunicaciones no está activo para esta comunidad.",
  "communications_disabled"
);

export async function getCommunicationFeature(context: AuthContext): Promise<CommunicationFeatureState> {
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const result = await client.query<{ communications_enabled: boolean }>(
      `SELECT communications_enabled
         FROM community_app_settings
        WHERE community_id=$1`,
      [context.current.communityId]
    );
    return { enabled: result.rows[0]?.communications_enabled ?? false };
  });
}

export async function assertCommunicationFeatureEnabled(context: AuthContext) {
  const state = await getCommunicationFeature(context);
  if (!state.enabled) throw disabledError();
}

export async function updateCommunicationFeature(
  context: AuthContext,
  enabled: boolean,
  userAgent?: string | null
): Promise<CommunicationFeatureState> {
  if (!canManageSettings(context.current.role) || context.isDemo) {
    throw new ApiError(403, "Solo la administración puede cambiar esta función.", "forbidden");
  }

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const before = await client.query<{ communications_enabled: boolean }>(
      `SELECT communications_enabled
         FROM community_app_settings
        WHERE community_id=$1
        FOR UPDATE`,
      [context.current.communityId]
    );
    if (!before.rowCount) throw new ApiError(404, "No se encontró la configuración de la comunidad.", "not_found");

    await client.query(
      `UPDATE community_app_settings
          SET communications_enabled=$2,updated_by=$3
        WHERE community_id=$1`,
      [context.current.communityId, enabled, context.user.id]
    );

    await writeAudit(client, {
      communityId: context.current.communityId,
      userId: context.user.id,
      action: "settings.communications_toggled",
      resourceType: "community_settings",
      resourceId: context.current.communityId,
      before: { communicationsEnabled: before.rows[0].communications_enabled },
      after: { communicationsEnabled: enabled },
      userAgent
    });

    return { enabled };
  });
}

function secureSecretMatches(provided: string, expected: string) {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && left.length > 0 && timingSafeEqual(left, right);
}

export async function assertExternalCommunicationFeatureEnabled(communitySlug: unknown, providedSecret: string) {
  const expectedSecret = process.env.COMMUNICATION_INGEST_SECRET ?? "";
  if (expectedSecret.length < 32) {
    throw new ApiError(503, "La recepción externa de correo no está configurada.", "integration_not_configured");
  }
  if (!secureSecretMatches(providedSecret, expectedSecret)) {
    throw new ApiError(401, "Credencial de integración no válida.", "unauthorized");
  }

  const slug = String(communitySlug ?? "").trim().slice(0, 120);
  if (!slug) throw new ApiError(400, "Falta identificar la comunidad.", "validation_error");

  const result = await query<{ communications_enabled: boolean }>(
    `SELECT settings.communications_enabled
       FROM communities community
       JOIN community_app_settings settings ON settings.community_id=community.id
      WHERE community.slug=$1
        AND community.status IN ('onboarding','active','transition')
      LIMIT 1`,
    [slug]
  );
  if (!result.rowCount) throw new ApiError(404, "Comunidad no encontrada.", "community_not_found");
  if (!result.rows[0].communications_enabled) throw disabledError();
}
