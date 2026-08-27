import "server-only";

import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { withTenant } from "./db";
import type { HomeWriteInput } from "./home-input";
import { canManageHomes } from "./permissions";

export type RelationType = "owner" | "co_owner" | "tenant" | "authorized_resident";
export type RelationStatus = "pending" | "active" | "ended" | "rejected";
export type HomeOccupancyFilter = "rented" | "no_tenant" | "pending" | "no_owner";
export type QuotaMethod = "fixed_amount" | "participation_coefficient";
export type QuotaFrequency = "monthly" | "quarterly" | "semiannual" | "annual";
export type HouseholdRelationshipType = "partner" | "child" | "parent" | "sibling" | "other_relative" | "dependent" | "other";

export interface HouseholdMember {
  id: string;
  fullName: string;
  relationshipType: HouseholdRelationshipType;
  sharedWithCommunity: boolean;
  canEdit: boolean;
  version: number;
  createdAt: string;
}

export interface UnitRelation {
  id: string;
  userId: string | null;
  fullName: string;
  email: string | null;
  relationType: RelationType;
  ownershipPercentage: number | null;
  isPrimary: boolean;
  canVote: boolean;
  validFrom: string;
  validTo: string | null;
  status: RelationStatus;
  source: string;
  verifiedAt: string | null;
  createdAt: string;
}

export interface PrivateUnit {
  id: string;
  code: string;
  unitType: string;
  siteName: string | null;
  blockName: string | null;
  staircase: string | null;
  floor: string | null;
  door: string | null;
  cadastralReference: string | null;
  builtAreaM2: number | null;
  usableAreaM2: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  participationCoefficient: number;
  quotaMethod: QuotaMethod;
  fixedQuotaAmount: number | null;
  quotaFrequency: QuotaFrequency;
  status: string;
  updatedAt: string;
  relations: UnitRelation[];
  familyMembers: HouseholdMember[];
  ownerNames: string[];
  occupantNames: string[];
  pendingRelations: number;
}

export interface HomeDirectoryInput {
  search?: string;
  siteName?: string;
  blockName?: string;
  staircase?: string;
  floor?: string;
  unitType?: string;
  occupancy?: HomeOccupancyFilter;
  page?: number;
  pageSize?: number;
  sort?: "location" | "code" | "coefficient" | "updatedAt";
  direction?: "asc" | "desc";
}

export interface HomeDirectoryResult {
  rows: PrivateUnit[];
  total: number;
  page: number;
  pageSize: number;
  summary: { total: number; withTenant: number; pendingRelations: number; withoutOwner: number };
  filters: { sites: string[]; blocks: string[]; staircases: string[]; floors: string[] };
}

export interface HomeChoice { id: string; code: string; locationLabel: string; }

type UnitRow = {
  id: string;
  code: string;
  unit_type: string;
  site_name: string | null;
  block_name: string | null;
  staircase: string | null;
  floor: string | null;
  door: string | null;
  cadastral_reference: string | null;
  built_area_m2: string | null;
  usable_area_m2: string | null;
  bedrooms: number | null;
  bathrooms: number | null;
  participation_coefficient: string;
  quota_method: QuotaMethod;
  fixed_quota_cents: string | null;
  quota_frequency: QuotaFrequency;
  status: string;
  updated_at: Date;
  relations: UnitRelation[] | null;
  family_members: HouseholdMember[] | null;
  owner_names: string[] | null;
  occupant_names: string[] | null;
  pending_relations: number | null;
};

const activeRelation = `ur.status IN ('pending', 'active')
  AND (ur.valid_to IS NULL OR ur.valid_to >= current_date)`;

const relationsAggregate = `COALESCE(jsonb_agg(jsonb_build_object(
    'id', ur.id::text, 'userId', ur.user_id::text, 'fullName', ur.full_name,
    'email', ur.email::text, 'relationType', ur.relation_type,
    'ownershipPercentage', ur.ownership_percentage, 'isPrimary', ur.is_primary,
    'canVote', ur.can_vote, 'validFrom', ur.valid_from,
    'validTo', ur.valid_to, 'status', ur.status, 'source', ur.source,
    'verifiedAt', ur.verified_at, 'createdAt', ur.created_at
  ) ORDER BY ur.status DESC, ur.is_primary DESC, ur.relation_type, ur.full_name)
  FILTER (WHERE ur.id IS NOT NULL), '[]'::jsonb)`;

const householdAggregate = `COALESCE((
  SELECT jsonb_agg(jsonb_build_object(
    'id', hm.id::text, 'fullName', hm.full_name,
    'relationshipType', hm.relationship_type,
    'sharedWithCommunity', hm.shared_with_community,
    'canEdit', hm.created_by = current_app_user_id(),
    'version', hm.version, 'createdAt', hm.created_at
  ) ORDER BY hm.created_at, hm.full_name)
    FROM household_members hm
   WHERE hm.community_id = pu.community_id AND hm.unit_id = pu.id AND hm.status = 'active'
), '[]'::jsonb)`;

function normalizeUnit(row: UnitRow, hideEmails = false): PrivateUnit {
  const relations = (row.relations ?? []).map((relation) => hideEmails ? { ...relation, email: null } : relation);
  return {
    id: row.id,
    code: row.code,
    unitType: row.unit_type,
    siteName: row.site_name,
    blockName: row.block_name,
    staircase: row.staircase,
    floor: row.floor,
    door: row.door,
    cadastralReference: row.cadastral_reference,
    builtAreaM2: row.built_area_m2 === null ? null : Number(row.built_area_m2),
    usableAreaM2: row.usable_area_m2 === null ? null : Number(row.usable_area_m2),
    bedrooms: row.bedrooms,
    bathrooms: row.bathrooms,
    participationCoefficient: Number(row.participation_coefficient),
    quotaMethod: row.quota_method,
    fixedQuotaAmount: row.fixed_quota_cents === null ? null : Number(row.fixed_quota_cents) / 100,
    quotaFrequency: row.quota_frequency,
    status: row.status,
    updatedAt: row.updated_at.toISOString(),
    relations,
    familyMembers: row.family_members ?? [],
    ownerNames: row.owner_names ?? relations.filter((item) => ["owner", "co_owner"].includes(item.relationType)).map((item) => item.fullName),
    occupantNames: row.occupant_names ?? relations.filter((item) => ["tenant", "authorized_resident"].includes(item.relationType)).map((item) => item.fullName),
    pendingRelations: Number(row.pending_relations ?? relations.filter((item) => item.status === "pending").length)
  };
}

function boundedInt(value: number | undefined, fallback: number, min: number, max: number) {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(max, Math.max(min, Math.trunc(value as number)));
}

function directoryWhere(communityId: string, input: HomeDirectoryInput) {
  const params: unknown[] = [communityId];
  const where = ["pu.community_id = $1", "pu.status = 'active'"];
  const addExact = (column: string, value?: string) => {
    if (!value?.trim()) return;
    params.push(value.trim().slice(0, 120));
    where.push(`${column} = $${params.length}`);
  };
  addExact("pu.site_name", input.siteName);
  addExact("pu.block_name", input.blockName);
  addExact("pu.staircase", input.staircase);
  addExact("pu.floor", input.floor);
  addExact("pu.unit_type", input.unitType);
  if (input.search?.trim()) {
    params.push(`%${input.search.trim().slice(0, 120)}%`);
    const searchParam = `$${params.length}`;
    where.push(`(concat_ws(' ', pu.code, pu.site_name, pu.block_name, pu.staircase, pu.floor, pu.door) ILIKE ${searchParam}
      OR EXISTS (SELECT 1 FROM unit_relations search_relation
        WHERE search_relation.community_id = pu.community_id AND search_relation.unit_id = pu.id
          AND search_relation.status IN ('pending','active')
          AND concat_ws(' ', search_relation.full_name, search_relation.email::text) ILIKE ${searchParam}))`);
  }
  if (input.occupancy === "rented") {
    where.push(`EXISTS (SELECT 1 FROM unit_relations occupancy_relation WHERE occupancy_relation.community_id = pu.community_id
      AND occupancy_relation.unit_id = pu.id AND occupancy_relation.relation_type IN ('tenant','authorized_resident')
      AND occupancy_relation.status = 'active' AND (occupancy_relation.valid_to IS NULL OR occupancy_relation.valid_to >= current_date))`);
  }
  if (input.occupancy === "no_tenant") {
    where.push(`NOT EXISTS (SELECT 1 FROM unit_relations occupancy_relation WHERE occupancy_relation.community_id = pu.community_id
      AND occupancy_relation.unit_id = pu.id AND occupancy_relation.relation_type IN ('tenant','authorized_resident')
      AND occupancy_relation.status = 'active' AND (occupancy_relation.valid_to IS NULL OR occupancy_relation.valid_to >= current_date))`);
  }
  if (input.occupancy === "pending") {
    where.push(`EXISTS (SELECT 1 FROM unit_relations occupancy_relation WHERE occupancy_relation.community_id = pu.community_id
      AND occupancy_relation.unit_id = pu.id AND occupancy_relation.status = 'pending')`);
  }
  if (input.occupancy === "no_owner") {
    where.push(`NOT EXISTS (SELECT 1 FROM unit_relations occupancy_relation WHERE occupancy_relation.community_id = pu.community_id
      AND occupancy_relation.unit_id = pu.id AND occupancy_relation.relation_type IN ('owner','co_owner')
      AND occupancy_relation.status = 'active' AND (occupancy_relation.valid_to IS NULL OR occupancy_relation.valid_to >= current_date))`);
  }
  return { params, where };
}

export async function listHomeDirectory(context: AuthContext, input: HomeDirectoryInput = {}): Promise<HomeDirectoryResult> {
  if (!canManageHomes(context.current.role)) throw new ApiError(403, "No tienes permiso para consultar el directorio de inmuebles.", "forbidden");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const page = boundedInt(input.page, 1, 1, 1_000_000);
    const pageSize = boundedInt(input.pageSize, 25, 10, 100);
    const { params, where } = directoryWhere(context.current.communityId, input);
    const totalResult = await client.query<{ total: number }>(
      `SELECT count(*)::int AS total FROM private_units pu WHERE ${where.join(" AND ")}`,
      params
    );
    const summaryResult = await client.query<{
      total: number; with_tenant: number; pending_relations: number; without_owner: number;
    }>(
      `SELECT count(*)::int AS total,
        count(*) FILTER (WHERE EXISTS (SELECT 1 FROM unit_relations r WHERE r.community_id = pu.community_id AND r.unit_id = pu.id AND r.relation_type IN ('tenant','authorized_resident') AND r.status = 'active' AND (r.valid_to IS NULL OR r.valid_to >= current_date)))::int AS with_tenant,
        (SELECT count(*)::int FROM unit_relations r WHERE r.community_id = $1 AND r.status = 'pending') AS pending_relations,
        count(*) FILTER (WHERE NOT EXISTS (SELECT 1 FROM unit_relations r WHERE r.community_id = pu.community_id AND r.unit_id = pu.id AND r.relation_type IN ('owner','co_owner') AND r.status = 'active' AND (r.valid_to IS NULL OR r.valid_to >= current_date)))::int AS without_owner
       FROM private_units pu WHERE pu.community_id = $1 AND pu.status = 'active'`,
      [context.current.communityId]
    );
    const filterResult = await client.query<{ sites: string[]; blocks: string[]; staircases: string[]; floors: string[] }>(
      `SELECT
        COALESCE(array_agg(DISTINCT site_name ORDER BY site_name) FILTER (WHERE site_name IS NOT NULL AND site_name <> ''), '{}'::text[]) AS sites,
        COALESCE(array_agg(DISTINCT block_name ORDER BY block_name) FILTER (WHERE block_name IS NOT NULL AND block_name <> ''), '{}'::text[]) AS blocks,
        COALESCE(array_agg(DISTINCT staircase ORDER BY staircase) FILTER (WHERE staircase IS NOT NULL AND staircase <> ''), '{}'::text[]) AS staircases,
        COALESCE(array_agg(DISTINCT floor ORDER BY floor) FILTER (WHERE floor IS NOT NULL AND floor <> ''), '{}'::text[]) AS floors
       FROM private_units WHERE community_id = $1 AND status = 'active'`,
      [context.current.communityId]
    );
    const sortMap = {
      code: "pu.code",
      coefficient: "pu.participation_coefficient",
      updatedAt: "pu.updated_at"
    } as const;
    const direction = input.direction === "desc" ? "DESC" : "ASC";
    const requestedSort = input.sort ?? "location";
    const sort = requestedSort === "location"
      ? [`pu.site_name ${direction} NULLS FIRST`, `pu.block_name ${direction} NULLS FIRST`, `pu.staircase ${direction} NULLS FIRST`, `CASE
          WHEN lower(COALESCE(pu.floor,'')) ~ '^(s[oó]tano|semis[oó]tano)' THEN -100
          WHEN lower(COALESCE(pu.floor,'')) IN ('bajo','baja','pb','planta baja') THEN 0
          WHEN lower(COALESCE(pu.floor,'')) ~ '^(entreplanta|entresuelo)' THEN 1
          WHEN COALESCE(pu.floor,'') ~ '^-?[0-9]+' THEN substring(pu.floor FROM '^-?[0-9]+')::int + 10
          WHEN lower(COALESCE(pu.floor,'')) ~ '^(ático|atico)' THEN 1000
          ELSE 500 END ${direction}`,
         `pu.floor ${direction} NULLS FIRST`, `pu.door ${direction} NULLS FIRST`, `pu.code ${direction}`].join(", ")
      : `${sortMap[requestedSort as keyof typeof sortMap] ?? sortMap.code} ${direction}`;
    const rowParams = [...params, pageSize, (page - 1) * pageSize];
    const rowsResult = await client.query<UnitRow>(
      `SELECT pu.id::text, pu.code, pu.unit_type, pu.site_name, pu.block_name, pu.staircase,
              pu.floor, pu.door, pu.cadastral_reference, pu.built_area_m2::text, pu.usable_area_m2::text,
              pu.bedrooms, pu.bathrooms, pu.participation_coefficient::text, pu.quota_method,
              pu.fixed_quota_cents::text, pu.quota_frequency, pu.status, pu.updated_at,
              relations.relations, ${householdAggregate} AS family_members,
              relations.owner_names, relations.occupant_names, relations.pending_relations
         FROM private_units pu
         LEFT JOIN LATERAL (
           SELECT ${relationsAggregate} AS relations,
             COALESCE(array_agg(ur.full_name ORDER BY ur.is_primary DESC, ur.full_name) FILTER (WHERE ur.relation_type IN ('owner','co_owner') AND ur.status = 'active'), '{}'::text[]) AS owner_names,
             COALESCE(array_agg(ur.full_name ORDER BY ur.is_primary DESC, ur.full_name) FILTER (WHERE ur.relation_type IN ('tenant','authorized_resident') AND ur.status = 'active'), '{}'::text[]) AS occupant_names,
             count(*) FILTER (WHERE ur.status = 'pending')::int AS pending_relations
           FROM unit_relations ur
          WHERE ur.community_id = pu.community_id AND ur.unit_id = pu.id AND ${activeRelation}
         ) relations ON true
        WHERE ${where.join(" AND ")}
        ORDER BY ${sort}, pu.id
        LIMIT $${rowParams.length - 1} OFFSET $${rowParams.length}`,
      rowParams
    );
    const summary = summaryResult.rows[0];
    return {
      rows: rowsResult.rows.map((row) => normalizeUnit(row)),
      total: totalResult.rows[0].total,
      page,
      pageSize,
      summary: { total: summary.total, withTenant: summary.with_tenant, pendingRelations: summary.pending_relations, withoutOwner: summary.without_owner },
      filters: filterResult.rows[0]
    };
  });
}

export async function listHomes(context: AuthContext): Promise<PrivateUnit[]> {
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const manager = canManageHomes(context.current.role);
    const params = manager ? [context.current.communityId] : [context.current.communityId, context.user.id];
    const visibility = manager ? "" : `AND EXISTS (
      SELECT 1 FROM unit_relations mine WHERE mine.community_id = pu.community_id AND mine.unit_id = pu.id
       AND mine.user_id = $2 AND mine.status = 'active' AND mine.valid_from <= current_date
       AND (mine.valid_to IS NULL OR mine.valid_to >= current_date))`;
    const relationVisibility = manager || context.current.role === "owner" ? "" : `AND (ur.user_id = $2 OR (ur.relation_type IN ('owner','co_owner') AND ur.is_primary))`;
    const result = await client.query<UnitRow>(
      `SELECT pu.id::text, pu.code, pu.unit_type, pu.site_name, pu.block_name, pu.staircase,
              pu.floor, pu.door, pu.cadastral_reference, pu.built_area_m2::text, pu.usable_area_m2::text,
              pu.bedrooms, pu.bathrooms, pu.participation_coefficient::text, pu.quota_method,
              pu.fixed_quota_cents::text, pu.quota_frequency, pu.status, pu.updated_at,
              ${relationsAggregate} AS relations, ${householdAggregate} AS family_members, NULL::text[] AS owner_names,
              NULL::text[] AS occupant_names, count(*) FILTER (WHERE ur.status = 'pending')::int AS pending_relations
         FROM private_units pu LEFT JOIN unit_relations ur ON ur.unit_id = pu.id AND ur.community_id = pu.community_id
          AND ${activeRelation} ${relationVisibility}
        WHERE pu.community_id = $1 AND pu.status = 'active' ${visibility}
        GROUP BY pu.id ORDER BY pu.site_name, pu.block_name, pu.staircase, pu.floor, pu.door, pu.code`,
      params
    );
    return result.rows.map((row) => normalizeUnit(row, !manager));
  });
}

export async function listHomeChoices(context: AuthContext): Promise<HomeChoice[]> {
  if (!canManageHomes(context.current.role)) throw new ApiError(403, "No tienes permiso para consultar viviendas.", "forbidden");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const result = await client.query<{ id: string; code: string; location_label: string }>(
      `SELECT id::text, code, concat_ws(' · ', site_name, block_name, staircase, floor, door) AS location_label
         FROM private_units WHERE community_id = $1 AND status = 'active'
        ORDER BY site_name, block_name, staircase, floor, door, code`,
      [context.current.communityId]
    );
    return result.rows.map((row) => ({ id: row.id, code: row.code, locationLabel: row.location_label }));
  });
}

export async function createHome(context: AuthContext, input: HomeWriteInput, userAgent?: string | null) {
  if (!canManageHomes(context.current.role)) throw new ApiError(403, "No tienes permiso para crear inmuebles.", "forbidden");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const result = await client.query<{ id: string }>(
      `INSERT INTO private_units
        (community_id, code, unit_type, site_name, block_name, staircase, floor, door,
         cadastral_reference, built_area_m2, usable_area_m2, bedrooms, bathrooms,
         participation_coefficient, quota_method, fixed_quota_cents, quota_frequency, created_by, updated_by)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$18) RETURNING id::text`,
      [context.current.communityId, input.code, input.unitType, input.siteName || null, input.blockName || null,
       input.staircase || null, input.floor || null, input.door || null, input.cadastralReference || null,
       input.builtAreaM2, input.usableAreaM2, input.bedrooms, input.bathrooms, input.participationCoefficient,
       input.quotaMethod, input.fixedQuotaAmount === null ? null : Math.round(input.fixedQuotaAmount * 100),
       input.quotaFrequency, context.user.id]
    );
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "homes.created", resourceType: "private_unit", resourceId: result.rows[0].id, after: input, userAgent });
    return result.rows[0];
  });
}

export async function updateHome(context: AuthContext, id: string, input: HomeWriteInput, userAgent?: string | null) {
  if (!canManageHomes(context.current.role)) throw new ApiError(403, "No tienes permiso para modificar inmuebles.", "forbidden");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const before = await client.query(
      `SELECT code,unit_type,site_name,block_name,staircase,floor,door,cadastral_reference,
              built_area_m2,usable_area_m2,bedrooms,bathrooms,participation_coefficient,
              quota_method,fixed_quota_cents,quota_frequency
         FROM private_units WHERE id=$1 AND community_id=$2 AND status='active'`,
      [id, context.current.communityId]
    );
    if (!before.rowCount) throw new ApiError(404, "El inmueble no existe.", "not_found");
    const result = await client.query<{ id: string }>(
      `UPDATE private_units SET code=$3,unit_type=$4,site_name=$5,block_name=$6,staircase=$7,
        floor=$8,door=$9,cadastral_reference=$10,built_area_m2=$11,usable_area_m2=$12,
        bedrooms=$13,bathrooms=$14,participation_coefficient=$15,quota_method=$16,
        fixed_quota_cents=$17,quota_frequency=$18,updated_by=$19
       WHERE id=$1 AND community_id=$2 AND status='active' RETURNING id::text`,
      [id, context.current.communityId, input.code, input.unitType, input.siteName || null, input.blockName || null,
       input.staircase || null, input.floor || null, input.door || null, input.cadastralReference || null,
       input.builtAreaM2, input.usableAreaM2, input.bedrooms, input.bathrooms, input.participationCoefficient,
       input.quotaMethod, input.fixedQuotaAmount === null ? null : Math.round(input.fixedQuotaAmount * 100),
       input.quotaFrequency, context.user.id]
    );
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "homes.updated", resourceType: "private_unit", resourceId: id, before: before.rows[0], after: input, userAgent });
    return result.rows[0];
  });
}

async function ownsUnit(client: PoolClient, context: AuthContext, unitId: string) {
  const result = await client.query(
    `SELECT 1 FROM unit_relations WHERE community_id=$1 AND unit_id=$2 AND user_id=$3
      AND relation_type IN ('owner','co_owner') AND status='active' AND valid_from <= current_date
      AND (valid_to IS NULL OR valid_to >= current_date) LIMIT 1`,
    [context.current.communityId, unitId, context.user.id]
  );
  return Boolean(result.rowCount);
}

export async function addHomeRelation(
  context: AuthContext,
  input: { unitId: string; fullName: string; email?: string | null; relationType: RelationType; ownershipPercentage?: number | null; isPrimary?: boolean; canVote?: boolean; validFrom: string; notes?: string | null },
  userAgent?: string | null
) {
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const manager = canManageHomes(context.current.role);
    const owner = context.current.role === "owner" && await ownsUnit(client, context, input.unitId);
    if (!manager && !owner) throw new ApiError(403, "No puedes gestionar ocupantes de esta vivienda.", "forbidden");
    if (owner && input.relationType !== "tenant") throw new ApiError(403, "Como propietario puedes comunicar inquilinos. La familia se gestiona en su apartado privado.", "forbidden");
    const unit = await client.query("SELECT 1 FROM private_units WHERE id=$1 AND community_id=$2", [input.unitId, context.current.communityId]);
    if (!unit.rowCount) throw new ApiError(404, "La vivienda no existe.", "not_found");
    const linkedUser = input.email ? await client.query<{ id: string }>(
      `SELECT u.id::text FROM app_users u WHERE u.email=$1 AND EXISTS
        (SELECT 1 FROM memberships m WHERE m.user_id=u.id AND m.community_id=$2 AND m.status='active') LIMIT 1`,
      [input.email, context.current.communityId]
    ) : null;
    const status = manager ? "active" : "pending";
    const ownership = ["owner", "co_owner"].includes(input.relationType) ? input.ownershipPercentage ?? 100 : null;
    const result = await client.query<{ id: string }>(
      `INSERT INTO unit_relations
        (community_id,unit_id,user_id,full_name,email,relation_type,ownership_percentage,is_primary,can_vote,
         valid_from,status,source,declared_by,verified_by,verified_at,notes)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16) RETURNING id::text`,
      [context.current.communityId, input.unitId, linkedUser?.rows[0]?.id ?? null, input.fullName, input.email || null,
       input.relationType, ownership, Boolean(input.isPrimary), Boolean(input.canVote), input.validFrom, status,
       manager ? "administration" : "owner_declaration", context.user.id, manager ? context.user.id : null,
       manager ? new Date() : null, input.notes || null]
    );
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: manager ? "occupancy.created" : "occupancy.declared", resourceType: "unit_relation", resourceId: result.rows[0].id, after: { ...input, status }, userAgent });
    return { ...result.rows[0], status };
  });
}

export async function reviewHomeRelation(context: AuthContext, id: string, status: "active" | "rejected" | "ended", userAgent?: string | null) {
  if (!canManageHomes(context.current.role)) throw new ApiError(403, "No tienes permiso para validar ocupantes.", "forbidden");
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const result = await client.query<{ id: string }>(
      `UPDATE unit_relations SET status=$1,verified_by=$2,verified_at=now(),valid_to=CASE WHEN $1='ended' THEN current_date ELSE valid_to END
       WHERE id=$3 AND community_id=$4 AND status IN ('pending','active') RETURNING id::text`,
      [status, context.user.id, id, context.current.communityId]
    );
    if (!result.rowCount) throw new ApiError(404, "La relación ya no está disponible.", "not_found");
    await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: `occupancy.${status}`, resourceType: "unit_relation", resourceId: id, after: { status }, userAgent });
    return result.rows[0];
  });
}

function csvCell(value: unknown) {
  const text = value === null || value === undefined ? "" : String(value);
  const safe = /^[=+\-@]/.test(text) ? `'${text}` : text;
  return `"${safe.replaceAll('"', '""')}"`;
}

export async function homesDirectoryCsv(context: AuthContext, input: HomeDirectoryInput) {
  const rows: PrivateUnit[] = [];
  let page = 1;
  let total = 0;
  do {
    const result = await listHomeDirectory(context, { ...input, page, pageSize: 100 });
    total = result.total;
    rows.push(...result.rows);
    page += 1;
    if (rows.length >= 50_000) break;
  } while (rows.length < total);
  const headers = ["Referencia","Tipo","Manzana / conjunto","Bloque","Escalera","Planta","Puerta","Referencia catastral","Superficie construida m2","Superficie util m2","Dormitorios","Banos","Propiedad","Ocupantes","Coeficiente","Metodo cuota","Importe fijo","Periodicidad","Pendientes"];
  const lines = rows.map((home) => [home.code,home.unitType,home.siteName,home.blockName,home.staircase,home.floor,home.door,home.cadastralReference,home.builtAreaM2,home.usableAreaM2,home.bedrooms,home.bathrooms,home.ownerNames.join(" | "),home.occupantNames.join(" | "),home.participationCoefficient,home.quotaMethod,home.fixedQuotaAmount,home.quotaFrequency,home.pendingRelations].map(csvCell).join(";"));
  return `\uFEFF${headers.map(csvCell).join(";")}\r\n${lines.join("\r\n")}`;
}
