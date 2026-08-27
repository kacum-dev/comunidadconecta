import "server-only";

import { createHash, randomBytes } from "node:crypto";
import { cookies } from "next/headers";
import type { NextRequest, NextResponse } from "next/server";
import { query, withTenant } from "./db";
import { rolePriority, type Role } from "./permissions";

export const SESSION_COOKIE = "cc_session";
export const COMMUNITY_COOKIE = "cc_community";
export const ROLE_COOKIE = "cc_role";

export interface CommunityMembership {
  communityId: string;
  communityName: string;
  communitySlug: string;
  communityAddress: string;
  timeZone: string;
  locale: string;
  dateFormat: "DD/MM/YYYY" | "YYYY-MM-DD";
  timeFormat: "24h" | "12h";
  role: Role;
  roles: Role[];
  membershipId: string;
  membershipIds: string[];
}

export interface AuthContext {
  user: {
    id: string;
    email: string;
    fullName: string;
    simpleMode: boolean;
  };
  current: CommunityMembership;
  communities: CommunityMembership[];
  primaryHome: { id: string; code: string; relation: string } | null;
  sessionId: string;
  sessionExpiresAt: string;
  isDemo: boolean;
}

export function hashToken(token: string) {
  return createHash("sha256").update(token).digest("hex");
}

export function safeUserAgent(value: string | null) {
  return value?.slice(0, 300) || null;
}

export async function getAuthContext(): Promise<AuthContext | null> {
  const cookieStore = await cookies();
  const token = cookieStore.get(SESSION_COOKIE)?.value;
  if (!token || token.length < 32) return null;

  const sessionResult = await query<{
    session_id: string;
    user_id: string;
    email: string;
    full_name: string;
    simple_mode: boolean;
    session_kind: "standard" | "demo";
    demo_community_id: string | null;
    demo_role: Role | null;
    expires_at: Date;
  }>(
    `SELECT s.id AS session_id, u.id AS user_id, u.email::text, u.full_name, u.simple_mode,
            s.session_kind, s.demo_community_id::text, s.demo_role, s.expires_at
       FROM user_sessions s
       JOIN app_users u ON u.id = s.user_id
      WHERE s.token_hash = $1
        AND s.revoked_at IS NULL
        AND s.expires_at > now()
        AND u.status = 'active'
        AND (
          s.session_kind = 'standard'
          OR EXISTS (
            SELECT 1
              FROM community_demo_settings demo
              JOIN communities demo_community ON demo_community.id = demo.community_id
             WHERE demo.community_id = s.demo_community_id
               AND demo.enabled = true
               AND demo_community.is_demo = true
               AND (demo.expires_at IS NULL OR demo.expires_at > now())
               AND s.demo_role = ANY(demo.enabled_roles)
          )
        )
      LIMIT 1`,
    [hashToken(token)]
  );

  if (!sessionResult.rowCount) return null;
  const session = sessionResult.rows[0];

  const membershipsResult = await query<{
    membership_id: string;
    community_id: string;
    community_name: string;
    community_slug: string;
    community_address: string;
    timezone: string;
    locale: string;
    date_format: "DD/MM/YYYY" | "YYYY-MM-DD";
    time_format: "24h" | "12h";
    role: Role;
  }>(
    `SELECT m.id AS membership_id, c.id AS community_id, c.name AS community_name,
            c.slug::text AS community_slug, c.address AS community_address, m.role,
            c.timezone, c.locale,
            COALESCE(settings.date_format, 'DD/MM/YYYY') AS date_format,
            COALESCE(settings.time_format, '24h') AS time_format
       FROM memberships m
       JOIN communities c ON c.id = m.community_id
       LEFT JOIN community_app_settings settings ON settings.community_id = c.id
      WHERE m.user_id = $1
        AND m.status = 'active'
        AND m.valid_from <= now()
        AND (m.valid_to IS NULL OR m.valid_to > now())
        AND c.status IN ('onboarding', 'active', 'transition')
        AND ($2::uuid IS NULL OR m.community_id = $2)
        AND ($3::text IS NULL OR m.role = $3)
      ORDER BY c.name, m.role`,
    [session.user_id, session.demo_community_id, session.demo_role]
  );

  if (!membershipsResult.rowCount) return null;
  const grouped = new Map<string, CommunityMembership>();
  for (const row of membershipsResult.rows) {
    const existing = grouped.get(row.community_id);
    if (existing) {
      if (!existing.roles.includes(row.role)) existing.roles.push(row.role);
      existing.membershipIds.push(row.membership_id);
      continue;
    }
    grouped.set(row.community_id, {
      membershipId: row.membership_id,
      membershipIds: [row.membership_id],
      communityId: row.community_id,
      communityName: row.community_name,
      communitySlug: row.community_slug,
      communityAddress: row.community_address,
      timeZone: row.timezone,
      locale: row.locale,
      dateFormat: row.date_format,
      timeFormat: row.time_format,
      role: row.role,
      roles: [row.role]
    });
  }
  const communities = Array.from(grouped.values());
  for (const community of communities) {
    community.roles.sort((a, b) => rolePriority.indexOf(a) - rolePriority.indexOf(b));
    community.role = community.roles[0];
  }

  const requestedCommunity = session.demo_community_id ?? cookieStore.get(COMMUNITY_COOKIE)?.value;
  const current = communities.find((membership) => membership.communityId === requestedCommunity) ?? communities[0];
  const requestedRole = session.demo_role ?? cookieStore.get(ROLE_COOKIE)?.value as Role | undefined;
  if (requestedRole && current.roles.includes(requestedRole)) current.role = requestedRole;

  const primaryHomeResult = await withTenant(current.communityId, session.user_id, (client) => client.query<{
    id: string;
    code: string;
    relation_type: string;
  }>(
    `SELECT pu.id::text, pu.code, ur.relation_type
       FROM unit_relations ur
       JOIN private_units pu ON pu.id = ur.unit_id AND pu.community_id = ur.community_id
      WHERE ur.community_id = $1 AND ur.user_id = $2 AND ur.status = 'active'
        AND ur.valid_from <= current_date AND (ur.valid_to IS NULL OR ur.valid_to >= current_date)
        AND pu.status = 'active'
      ORDER BY ur.is_primary DESC, pu.code
      LIMIT 1`,
    [current.communityId, session.user_id]
  ));
  const primaryHome = primaryHomeResult.rows[0];

  return {
    user: {
      id: session.user_id,
      email: session.email,
      fullName: session.full_name,
      simpleMode: session.simple_mode
    },
    current,
    communities,
    primaryHome: primaryHome ? { id: primaryHome.id, code: primaryHome.code, relation: primaryHome.relation_type } : null,
    sessionId: session.session_id,
    sessionExpiresAt: session.expires_at.toISOString(),
    isDemo: session.session_kind === "demo"
  };
}

export interface CreateSessionOptions {
  expiresAt?: Date;
  kind?: "standard" | "demo";
  demoCommunityId?: string | null;
  demoRole?: Role | null;
}

export async function createSession(userId: string, request: NextRequest, response: NextResponse, options: CreateSessionOptions = {}) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = options.expiresAt ?? new Date(Date.now() + 12 * 60 * 60 * 1000);
  const kind = options.kind ?? "standard";
  const result = await query<{ id: string }>(
    `INSERT INTO user_sessions (user_id, token_hash, user_agent, expires_at, session_kind, demo_community_id, demo_role)
     VALUES ($1, $2, $3, $4, $5, $6, $7)
     RETURNING id`,
    [userId, hashToken(token), safeUserAgent(request.headers.get("user-agent")), expiresAt, kind, options.demoCommunityId ?? null, options.demoRole ?? null]
  );

  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    sameSite: "strict",
    secure: process.env.SESSION_COOKIE_SECURE === "true",
    path: "/",
    maxAge: Math.max(1, Math.floor((expiresAt.getTime() - Date.now()) / 1000))
  });

  return result.rows[0].id;
}

export function clearSessionCookies(response: NextResponse) {
  response.cookies.set(SESSION_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  response.cookies.set(COMMUNITY_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
  response.cookies.set(ROLE_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
}
