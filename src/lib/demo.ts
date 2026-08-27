import "server-only";

import { createHash } from "node:crypto";
import type { NextRequest, NextResponse } from "next/server";
import { ApiError } from "./api";
import type { AuthContext } from "./auth";
import { COMMUNITY_COOKIE, createSession, ROLE_COOKIE, safeUserAgent } from "./auth";
import { writeAudit } from "./audit";
import { getPool, query } from "./db";
import { demoSettingsInputSchema, type DemoSettingsInput } from "./demo-input";
import { DEMO_ROLE_KEYS, demoProfiles, type DemoAdminSettingsDTO, type DemoRole, type PublicDemoConfig } from "./demo-types";
import { createPasswordHash, verifyPassword, type PasswordParams } from "./password";

type DemoSettingsRow = {
  community_id: string;
  community_name: string;
  is_demo: boolean;
  enabled: boolean;
  public_title: string;
  public_description: string;
  enabled_roles: DemoRole[];
  access_code_hash: string | null;
  access_code_salt: string | null;
  access_code_params: PasswordParams | null;
  session_duration_minutes: number;
  expires_at: Date | null;
  active_sessions: number;
};

function assertPlatformAdmin(context: AuthContext) {
  if (context.current.role !== "platform_admin" || context.isDemo) {
    throw new ApiError(403, "Solo la superadministración puede configurar el escaparate demo.", "forbidden");
  }
}

async function availableDemoRoles(communityId: string): Promise<DemoRole[]> {
  const result = await query<{ role: DemoRole }>(
    `SELECT DISTINCT m.role
       FROM memberships m
       JOIN app_users u ON u.id = m.user_id
      WHERE m.community_id = $1
        AND m.status = 'active'
        AND u.status = 'active'
        AND u.is_demo = true
        AND m.role = ANY($2::text[])`,
    [communityId, DEMO_ROLE_KEYS]
  );
  const found = new Set(result.rows.map((row) => row.role));
  return DEMO_ROLE_KEYS.filter((role) => found.has(role));
}

export async function getPublicDemoConfig(): Promise<PublicDemoConfig | null> {
  const result = await query<DemoSettingsRow>(
    `SELECT demo.community_id::text, community.name AS community_name, community.is_demo,
            demo.enabled, demo.public_title, demo.public_description, demo.enabled_roles,
            demo.access_code_hash, demo.access_code_salt, demo.access_code_params,
            demo.session_duration_minutes, demo.expires_at, 0::int AS active_sessions
       FROM community_demo_settings demo
       JOIN communities community ON community.id = demo.community_id
      WHERE demo.enabled = true
        AND community.is_demo = true
        AND community.status IN ('onboarding', 'active', 'transition')
        AND (demo.expires_at IS NULL OR demo.expires_at > now())
      LIMIT 1`
  );
  const row = result.rows[0];
  if (!row) return null;
  const available = await availableDemoRoles(row.community_id);
  const roles = row.enabled_roles.filter((role) => available.includes(role));
  if (!roles.length) return null;
  return {
    title: row.public_title,
    description: row.public_description,
    communityName: row.community_name,
    requiresAccessCode: Boolean(row.access_code_hash),
    expiresAt: row.expires_at?.toISOString() ?? null,
    profiles: demoProfiles(roles)
  };
}

export async function getDemoAdminSettings(context: AuthContext): Promise<DemoAdminSettingsDTO> {
  assertPlatformAdmin(context);
  const result = await query<DemoSettingsRow>(
    `SELECT community.id::text AS community_id, community.name AS community_name, community.is_demo,
            COALESCE(demo.enabled, false) AS enabled,
            COALESCE(demo.public_title, 'Explora Comunidad Conecta') AS public_title,
            COALESCE(demo.public_description, 'Descubre cómo se gestiona una comunidad desde cada perfil.') AS public_description,
            COALESCE(demo.enabled_roles, $2::text[]) AS enabled_roles,
            demo.access_code_hash, demo.access_code_salt, demo.access_code_params,
            COALESCE(demo.session_duration_minutes, 60) AS session_duration_minutes,
            demo.expires_at,
            (SELECT count(*)::int FROM user_sessions session
              WHERE session.demo_community_id = community.id
                AND session.session_kind = 'demo'
                AND session.revoked_at IS NULL
                AND session.expires_at > now()) AS active_sessions
       FROM communities community
       LEFT JOIN community_demo_settings demo ON demo.community_id = community.id
      WHERE community.id = $1
      LIMIT 1`,
    [context.current.communityId, DEMO_ROLE_KEYS]
  );
  const row = result.rows[0];
  if (!row) throw new ApiError(404, "La comunidad no existe.", "not_found");
  const availableRoles = await availableDemoRoles(row.community_id);
  const enabledRoles = row.enabled_roles.filter((role) => availableRoles.includes(role));
  return {
    eligible: row.is_demo && availableRoles.length > 0,
    enabled: row.enabled,
    title: row.public_title,
    description: row.public_description,
    communityName: row.community_name,
    requiresAccessCode: Boolean(row.access_code_hash),
    hasAccessCode: Boolean(row.access_code_hash),
    expiresAt: row.expires_at?.toISOString() ?? null,
    sessionDurationMinutes: row.session_duration_minutes,
    enabledRoles,
    profiles: demoProfiles(enabledRoles),
    availableProfiles: demoProfiles(availableRoles),
    activeSessions: row.active_sessions
  };
}

export async function updateDemoSettings(context: AuthContext, rawInput: DemoSettingsInput, userAgent?: string | null) {
  assertPlatformAdmin(context);
  const parsed = demoSettingsInputSchema.safeParse(rawInput);
  if (!parsed.success) throw new ApiError(400, "Revisa la configuración del modo demo.", "validation_error");
  const input = parsed.data;
  const expiresAt = input.expiresAt ? new Date(input.expiresAt) : null;
  if (input.enabled && expiresAt && expiresAt.getTime() <= Date.now()) {
    throw new ApiError(400, "La fecha de cierre de la demo debe estar en el futuro.", "invalid_expiration");
  }

  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const community = await client.query<{ is_demo: boolean }>("SELECT is_demo FROM communities WHERE id = $1 FOR UPDATE", [context.current.communityId]);
    if (!community.rowCount) throw new ApiError(404, "La comunidad no existe.", "not_found");
    if (input.enabled && !community.rows[0].is_demo) {
      throw new ApiError(409, "No se puede publicar una comunidad real. Prepara primero una comunidad con datos exclusivamente ficticios.", "demo_community_required");
    }

    const available = await client.query<{ role: DemoRole }>(
      `SELECT DISTINCT m.role FROM memberships m JOIN app_users u ON u.id = m.user_id
        WHERE m.community_id = $1 AND m.status = 'active' AND u.status = 'active'
          AND u.is_demo = true AND m.role = ANY($2::text[])`,
      [context.current.communityId, DEMO_ROLE_KEYS]
    );
    const availableSet = new Set(available.rows.map((row) => row.role));
    if (input.enabledRoles.some((role) => !availableSet.has(role))) {
      throw new ApiError(409, "Falta alguna cuenta sintética para los perfiles seleccionados.", "demo_profile_missing");
    }

    const current = await client.query<{
      access_code_hash: string | null;
      access_code_salt: string | null;
      access_code_params: PasswordParams | null;
      enabled: boolean;
    }>("SELECT access_code_hash, access_code_salt, access_code_params, enabled FROM community_demo_settings WHERE community_id = $1", [context.current.communityId]);
    let accessHash = current.rows[0]?.access_code_hash ?? null;
    let accessSalt = current.rows[0]?.access_code_salt ?? null;
    let accessParams = current.rows[0]?.access_code_params ?? null;
    if (input.accessCode === null) {
      accessHash = null;
      accessSalt = null;
      accessParams = null;
    } else if (typeof input.accessCode === "string") {
      const password = await createPasswordHash(input.accessCode);
      accessHash = password.hash;
      accessSalt = password.salt;
      accessParams = password.params;
    }

    if (input.enabled) {
      await client.query("UPDATE community_demo_settings SET enabled = false, updated_by = $1 WHERE enabled = true AND community_id <> $2", [context.user.id, context.current.communityId]);
    }
    await client.query(
      `INSERT INTO community_demo_settings
        (community_id, enabled, public_title, public_description, enabled_roles, access_code_hash,
         access_code_salt, access_code_params, session_duration_minutes, expires_at, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5::text[],$6,$7,$8::jsonb,$9,$10,$11,$11)
       ON CONFLICT (community_id) DO UPDATE SET
         enabled = EXCLUDED.enabled, public_title = EXCLUDED.public_title,
         public_description = EXCLUDED.public_description, enabled_roles = EXCLUDED.enabled_roles,
         access_code_hash = EXCLUDED.access_code_hash, access_code_salt = EXCLUDED.access_code_salt,
         access_code_params = EXCLUDED.access_code_params,
         session_duration_minutes = EXCLUDED.session_duration_minutes,
         expires_at = EXCLUDED.expires_at, updated_by = EXCLUDED.updated_by`,
      [context.current.communityId, input.enabled, input.title, input.description, input.enabledRoles,
        accessHash, accessSalt, accessParams ? JSON.stringify(accessParams) : null,
        input.sessionDurationMinutes, expiresAt, context.user.id]
    );

    if (!input.enabled) {
      await client.query(
        `UPDATE user_sessions SET revoked_at = now(), revoke_reason = 'demo_disabled'
          WHERE demo_community_id = $1 AND session_kind = 'demo' AND revoked_at IS NULL`,
        [context.current.communityId]
      );
    } else {
      await client.query(
        `UPDATE user_sessions SET revoked_at = now(), revoke_reason = 'demo_profile_disabled'
          WHERE demo_community_id = $1 AND session_kind = 'demo' AND revoked_at IS NULL
            AND NOT (demo_role = ANY($2::text[]))`,
        [context.current.communityId, input.enabledRoles]
      );
    }
    await writeAudit(client, {
      communityId: context.current.communityId,
      userId: context.user.id,
      action: input.enabled ? "demo.enabled" : "demo.disabled",
      resourceType: "community_demo_settings",
      resourceId: context.current.communityId,
      before: current.rows[0] ? { enabled: current.rows[0].enabled } : null,
      after: { enabled: input.enabled, enabledRoles: input.enabledRoles, expiresAt: input.expiresAt, accessCodeProtected: Boolean(accessHash) },
      userAgent
    });
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK").catch(() => undefined);
    throw error;
  } finally {
    client.release();
  }
  return getDemoAdminSettings(context);
}

function demoFingerprint(request: NextRequest) {
  const forwarded = request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "unknown";
  return createHash("sha256").update(`${forwarded}|${safeUserAgent(request.headers.get("user-agent")) ?? "unknown"}`).digest("hex");
}

async function recordDemoAttempt(fingerprint: string, role: DemoRole, succeeded: boolean) {
  await query(
    "INSERT INTO demo_auth_attempts (fingerprint_hash, requested_role, succeeded) VALUES ($1,$2,$3)",
    [fingerprint, role, succeeded]
  );
}

export async function startDemoSession(
  role: DemoRole,
  accessCode: string,
  request: NextRequest,
  response: NextResponse
) {
  const fingerprint = demoFingerprint(request);
  const recent = await query<{ attempts: number; failures: number }>(
    `SELECT count(*)::int AS attempts, count(*) FILTER (WHERE succeeded = false)::int AS failures
       FROM demo_auth_attempts
      WHERE fingerprint_hash = $1 AND attempted_at > now() - interval '15 minutes'`,
    [fingerprint]
  );
  if (recent.rows[0].attempts >= 24 || recent.rows[0].failures >= 8) {
    throw new ApiError(429, "Demasiados intentos. Espera unos minutos antes de volver a probar.", "rate_limited");
  }

  const result = await query<{
    community_id: string;
    user_id: string;
    access_code_hash: string | null;
    access_code_salt: string | null;
    access_code_params: PasswordParams | null;
    session_duration_minutes: number;
    expires_at: Date | null;
  }>(
    `SELECT demo.community_id::text, profile.user_id::text, demo.access_code_hash,
            demo.access_code_salt, demo.access_code_params, demo.session_duration_minutes, demo.expires_at
       FROM community_demo_settings demo
       JOIN communities community ON community.id = demo.community_id AND community.is_demo = true
       JOIN LATERAL (
         SELECT membership.user_id
           FROM memberships membership
           JOIN app_users demo_user ON demo_user.id = membership.user_id
          WHERE membership.community_id = demo.community_id
            AND membership.role = $1
            AND membership.status = 'active'
            AND membership.valid_from <= now()
            AND (membership.valid_to IS NULL OR membership.valid_to > now())
            AND demo_user.is_demo = true
            AND demo_user.status = 'active'
          ORDER BY (
            SELECT count(*) FROM memberships other_membership
             WHERE other_membership.community_id = membership.community_id
               AND other_membership.user_id = membership.user_id
               AND other_membership.status = 'active'
          ), membership.created_at, membership.user_id
          LIMIT 1
       ) profile ON true
      WHERE demo.enabled = true
        AND $1 = ANY(demo.enabled_roles)
        AND (demo.expires_at IS NULL OR demo.expires_at > now())
      LIMIT 1`,
    [role]
  );
  const row = result.rows[0];
  let valid = Boolean(row);
  if (row?.access_code_hash && row.access_code_salt && row.access_code_params) {
    valid = Boolean(accessCode) && await verifyPassword(accessCode, row.access_code_salt, row.access_code_hash, row.access_code_params);
  }
  if (!valid || !row) {
    await recordDemoAttempt(fingerprint, role, false);
    throw new ApiError(401, "El modo demo no está disponible o el código no es válido.", "demo_unavailable");
  }

  const durationExpiry = Date.now() + row.session_duration_minutes * 60_000;
  const expiresAt = new Date(Math.min(durationExpiry, row.expires_at?.getTime() ?? durationExpiry));
  await createSession(row.user_id, request, response, {
    kind: "demo",
    demoCommunityId: row.community_id,
    demoRole: role,
    expiresAt
  });
  const cookieOptions = {
    httpOnly: true,
    sameSite: "strict" as const,
    secure: process.env.SESSION_COOKIE_SECURE === "true",
    path: "/",
    maxAge: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  };
  response.cookies.set(COMMUNITY_COOKIE, row.community_id, cookieOptions);
  response.cookies.set(ROLE_COOKIE, role, cookieOptions);
  await query("UPDATE app_users SET last_login_at = now() WHERE id = $1", [row.user_id]);
  await recordDemoAttempt(fingerprint, role, true);
  return { expiresAt: expiresAt.toISOString() };
}
