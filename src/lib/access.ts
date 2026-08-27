import "server-only";

import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { getPool, withTenant } from "./db";
import { createPasswordHash } from "./password";
import { canManageAccess, type Role } from "./permissions";

export interface AccessEntry {
  membershipId: string;
  userId: string;
  fullName: string;
  email: string;
  role: Role;
  status: string;
  unitCode: string | null;
  lastLoginAt: string | null;
}

export async function listAccess(context: AuthContext): Promise<AccessEntry[]> {
  if (!canManageAccess(context.current.role) || context.isDemo) throw new ApiError(403, "No tienes permiso para gestionar accesos.", "forbidden");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const result = await client.query<{
      membership_id: string; user_id: string; full_name: string; email: string; role: Role;
      status: string; unit_code: string | null; last_login_at: Date | null;
    }>(
      `SELECT m.id::text AS membership_id, u.id::text AS user_id, u.full_name, u.email::text,
              m.role, m.status, max(pu.code) AS unit_code, u.last_login_at
         FROM memberships m JOIN app_users u ON u.id = m.user_id
         LEFT JOIN unit_relations ur ON ur.user_id = u.id AND ur.community_id = m.community_id AND ur.status = 'active'
         LEFT JOIN private_units pu ON pu.id = ur.unit_id
        WHERE m.community_id = $1 AND m.status IN ('active','invited')
        GROUP BY m.id, u.id ORDER BY u.full_name, m.role`,
      [context.current.communityId]
    );
    return result.rows.map((row) => ({ membershipId: row.membership_id, userId: row.user_id, fullName: row.full_name, email: row.email, role: row.role, status: row.status, unitCode: row.unit_code, lastLoginAt: row.last_login_at?.toISOString() ?? null }));
  });
}

function allowedRoles(context: AuthContext): Role[] {
  if (context.current.role === "platform_admin") return ["owner","resident","president","vice_president","secretary","treasurer","administrator","supplier","auditor","support"];
  if (context.current.role === "president") return ["owner","resident","vice_president","secretary","treasurer","administrator","supplier","auditor"];
  return ["owner","resident","supplier","auditor"];
}

export async function createAccess(context: AuthContext, input: { fullName: string; email: string; role: Role; temporaryPassword?: string | null; unitId?: string | null; relationType?: "owner" | "co_owner" | "tenant" | "authorized_resident" | null }) {
  if (context.isDemo || !canManageAccess(context.current.role) || !allowedRoles(context).includes(input.role)) throw new ApiError(403, "No puedes asignar ese perfil.", "forbidden");
  if (["owner", "resident"].includes(input.role) && (!input.unitId || !input.relationType)) throw new ApiError(400, "Los accesos de propietarios y residentes deben vincularse a un inmueble.", "unit_required");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const existing = await client.query<{ id: string }>("SELECT id::text FROM app_users WHERE email = $1 LIMIT 1", [input.email]);
    let userId = existing.rows[0]?.id;
    if (!userId) {
      if (!input.temporaryPassword || input.temporaryPassword.length < 12) throw new ApiError(400, "La contraseña temporal debe tener al menos 12 caracteres.", "password_required");
      const password = await createPasswordHash(input.temporaryPassword);
      const created = await client.query<{ id: string }>(
        `INSERT INTO app_users (email, full_name, password_hash, password_salt, password_params, status)
         VALUES ($1,$2,$3,$4,$5::jsonb,'active') RETURNING id::text`,
        [input.email, input.fullName, password.hash, password.salt, JSON.stringify(password.params)]
      );
      userId = created.rows[0].id;
    }
    const membership = await client.query<{ id: string }>(
      `INSERT INTO memberships (community_id,user_id,role,status) VALUES ($1,$2,$3,'active')
       ON CONFLICT (community_id,user_id,role) DO UPDATE SET status='active',valid_from=now(),valid_to=NULL
       RETURNING id::text`,
      [context.current.communityId, userId, input.role]
    );
    if (input.unitId && input.relationType) {
      const unit = await client.query("SELECT 1 FROM private_units WHERE id = $1 AND community_id = $2", [input.unitId, context.current.communityId]);
      if (!unit.rowCount) throw new ApiError(404, "El inmueble no existe.", "not_found");
      const ownership = ["owner", "co_owner"].includes(input.relationType) ? 100 : null;
      await client.query(
        `INSERT INTO unit_relations (community_id,unit_id,user_id,full_name,email,relation_type,ownership_percentage,is_primary,can_vote,valid_from,status,source,declared_by,verified_by,verified_at)
         VALUES ($1,$2,$3,$4,$5,$6,$7,true,$8,current_date,'active','administration',$9,$9,now())
         ON CONFLICT (community_id,unit_id,user_id,relation_type) WHERE status IN ('pending','active') AND user_id IS NOT NULL
         DO UPDATE SET full_name=EXCLUDED.full_name,email=EXCLUDED.email,status='active',valid_to=NULL,verified_by=$9,verified_at=now()`,
        [context.current.communityId, input.unitId, userId, input.fullName, input.email, input.relationType, ownership, input.role === "owner", context.user.id]
      );
    }
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "access.created", resourceType: "membership", resourceId: membership.rows[0].id, after: { email: input.email, role: input.role, unitId: input.unitId ?? null } });
    await client.query("COMMIT");
    return membership.rows[0];
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}

export async function revokeAccess(context: AuthContext, membershipId: string) {
  if (!canManageAccess(context.current.role) || context.isDemo) throw new ApiError(403, "No tienes permiso para retirar accesos.", "forbidden");
  if (context.current.membershipIds.includes(membershipId)) throw new ApiError(409, "No puedes retirar el perfil con el que estás trabajando.", "self_revoke");
  const client = await getPool().connect();
  try {
    await client.query("BEGIN");
    const result = await client.query<{ id: string; user_id: string; role: Role }>(
      `UPDATE memberships SET status='revoked',valid_to=now(),updated_at=now()
       WHERE id=$1 AND community_id=$2 AND status='active' RETURNING id::text,user_id::text,role`,
      [membershipId, context.current.communityId]
    );
    if (!result.rowCount) throw new ApiError(404, "El acceso ya no está activo.", "not_found");
    const row = result.rows[0];
    if (["owner", "resident"].includes(row.role)) {
      const types = row.role === "owner" ? ["owner", "co_owner"] : ["tenant", "authorized_resident"];
      await client.query(`UPDATE unit_relations SET status='ended',valid_to=current_date WHERE community_id=$1 AND user_id=$2 AND status='active' AND relation_type=ANY($3::text[])`, [context.current.communityId, row.user_id, types]);
    }
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "access.revoked", resourceType: "membership", resourceId: membershipId, after: { role: row.role } });
    await client.query("COMMIT");
    return row;
  } catch (error) { await client.query("ROLLBACK").catch(() => undefined); throw error; }
  finally { client.release(); }
}
