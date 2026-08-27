import "server-only";

import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { withTenant } from "./db";
import type { HouseholdMemberInput, HouseholdMemberUpdate } from "./household-input";
import { isResidentRole } from "./permissions";

export async function createHouseholdMember(context: AuthContext, input: HouseholdMemberInput, userAgent?: string | null) {
  if (!isResidentRole(context.current.role)) {
    throw new ApiError(403, "Solo una persona vinculada a la vivienda puede a\u00f1adir su familia.", "forbidden");
  }

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const unit = await client.query(
      `SELECT 1
         FROM unit_relations
        WHERE community_id=$1 AND unit_id=$2 AND user_id=$3
          AND status='active' AND valid_from <= current_date
          AND (valid_to IS NULL OR valid_to >= current_date)
        LIMIT 1`,
      [context.current.communityId, input.unitId, context.user.id]
    );
    if (!unit.rowCount) throw new ApiError(403, "No puedes a\u00f1adir familiares a esta vivienda.", "forbidden");

    const result = await client.query<{ id: string; version: number }>(
      `INSERT INTO household_members
        (community_id,unit_id,created_by,full_name,relationship_type,shared_with_community)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING id::text,version`,
      [context.current.communityId, input.unitId, context.user.id, input.fullName, input.relationshipType, input.sharedWithCommunity]
    );

    await writeAudit(client, {
      communityId: context.current.communityId,
      userId: context.user.id,
      action: "household.created",
      resourceType: "household_member",
      resourceId: result.rows[0].id,
      after: {
        unitId: input.unitId,
        relationshipType: input.relationshipType,
        sharedWithCommunity: input.sharedWithCommunity
      },
      userAgent
    });
    return result.rows[0];
  });
}

export async function updateHouseholdMember(context: AuthContext, id: string, input: HouseholdMemberUpdate, userAgent?: string | null) {
  if (!isResidentRole(context.current.role)) {
    throw new ApiError(403, "No puedes modificar este familiar.", "forbidden");
  }

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const before = await client.query<{
      unit_id: string;
      relationship_type: string;
      shared_with_community: boolean;
      version: number;
    }>(
      `SELECT unit_id::text,relationship_type,shared_with_community,version
         FROM household_members
        WHERE id=$1 AND community_id=$2 AND created_by=$3 AND status='active'`,
      [id, context.current.communityId, context.user.id]
    );
    if (!before.rowCount) throw new ApiError(404, "El familiar no est\u00e1 disponible.", "not_found");

    const result = await client.query<{ id: string; version: number }>(
      `UPDATE household_members
          SET full_name=COALESCE($4,full_name),
              relationship_type=COALESCE($5,relationship_type),
              shared_with_community=COALESCE($6,shared_with_community),
              version=version+1
        WHERE id=$1 AND community_id=$2 AND created_by=$3 AND status='active' AND version=$7
        RETURNING id::text,version`,
      [id, context.current.communityId, context.user.id, input.fullName ?? null, input.relationshipType ?? null,
       input.sharedWithCommunity ?? null, input.version]
    );
    if (!result.rowCount) throw new ApiError(409, "Los datos han cambiado. Actualiza la p\u00e1gina y vuelve a intentarlo.", "version_conflict");

    await writeAudit(client, {
      communityId: context.current.communityId,
      userId: context.user.id,
      action: "household.updated",
      resourceType: "household_member",
      resourceId: id,
      before: {
        relationshipType: before.rows[0].relationship_type,
        sharedWithCommunity: before.rows[0].shared_with_community,
        version: before.rows[0].version
      },
      after: {
        relationshipType: input.relationshipType,
        sharedWithCommunity: input.sharedWithCommunity,
        version: result.rows[0].version
      },
      userAgent
    });
    return result.rows[0];
  });
}

export async function removeHouseholdMember(context: AuthContext, id: string, version: number, userAgent?: string | null) {
  if (!isResidentRole(context.current.role)) {
    throw new ApiError(403, "No puedes retirar este familiar.", "forbidden");
  }

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const result = await client.query<{ id: string; unit_id: string; shared_with_community: boolean }>(
      `UPDATE household_members
          SET status='removed',removed_at=now(),shared_with_community=false,version=version+1
        WHERE id=$1 AND community_id=$2 AND created_by=$3 AND status='active' AND version=$4
        RETURNING id::text,unit_id::text,shared_with_community`,
      [id, context.current.communityId, context.user.id, version]
    );
    if (!result.rowCount) throw new ApiError(409, "El familiar ya no est\u00e1 disponible o ha cambiado.", "version_conflict");

    await writeAudit(client, {
      communityId: context.current.communityId,
      userId: context.user.id,
      action: "household.removed",
      resourceType: "household_member",
      resourceId: id,
      after: { unitId: result.rows[0].unit_id, status: "removed" },
      userAgent
    });
    return { id: result.rows[0].id };
  });
}
