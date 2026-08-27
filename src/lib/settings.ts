import "server-only";

import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { PoolClient } from "pg";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { withTenant } from "./db";
import type { IntegrationInput, SettingsUpdateInput } from "./settings-input";
import type { IntegrationData, IntegrationKind, IntegrationStatus, SettingsDTO } from "./settings-types";
import { canManageSettings } from "./permissions";

type SettingsRow = {
  name: string;
  tax_id: string | null;
  address: string;
  postal_code: string | null;
  city: string | null;
  province: string | null;
  country_code: string;
  phone: string | null;
  contact_email: string | null;
  website_url: string | null;
  timezone: string;
  locale: string;
  legal_profile: string;
  office_hours: string | null;
  time_format: "24h" | "12h";
  date_format: "DD/MM/YYYY" | "YYYY-MM-DD";
  currency_code: string;
  fiscal_year_start_month: number;
  default_due_day: number;
  notifications_email: boolean;
  notifications_push: boolean;
  accounting_enabled: boolean;
  accounting_enabled_at: Date | null;
  automatic_accounting_entries: number;
  backup_provider: "hosting" | "s3" | "disabled";
  backup_frequency: "daily" | "weekly" | "monthly";
  backup_time: string;
  backup_retention_days: number;
  backup_notification_email: string | null;
};

type IntegrationRow = {
  id: string;
  name: string;
  kind: IntegrationKind;
  provider: string;
  endpoint_url: string | null;
  account_reference: string | null;
  status: IntegrationStatus;
  credential_configured: boolean;
  credential_hint: string | null;
  updated_at: Date;
};

function assertSettingsAccess(context: AuthContext) {
  if (!canManageSettings(context.current.role) || context.isDemo) {
    throw new ApiError(403, "Solo la administración puede cambiar la configuración de la comunidad.", "forbidden");
  }
}

function encryptionSecret() {
  const secret = process.env.SETTINGS_ENCRYPTION_KEY?.trim() ?? "";
  return secret.length >= 32 ? secret : null;
}

export function secretStorageReady() {
  return Boolean(encryptionSecret());
}

function encryptCredential(value: string) {
  const secret = encryptionSecret();
  if (!secret) {
    throw new ApiError(503, "El servidor debe configurar SETTINGS_ENCRYPTION_KEY antes de guardar credenciales.", "secret_storage_unavailable");
  }
  const key = createHash("sha256").update(secret, "utf8").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const ciphertext = Buffer.concat([cipher.update(value, "utf8"), cipher.final()]);
  return { ciphertext, iv, tag: cipher.getAuthTag(), hint: `••••${value.slice(-4)}` };
}

function decryptCredential(ciphertext: Buffer, iv: Buffer, tag: Buffer) {
  const secret = encryptionSecret();
  if (!secret) return null;
  const key = createHash("sha256").update(secret, "utf8").digest();
  const decipher = createDecipheriv("aes-256-gcm", key, iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString("utf8");
}

function normalizeIntegration(row: IntegrationRow): IntegrationData {
  return {
    id: row.id,
    name: row.name,
    kind: row.kind,
    provider: row.provider,
    endpointUrl: row.endpoint_url ?? "",
    accountReference: row.account_reference ?? "",
    status: row.status,
    credentialConfigured: row.credential_configured,
    credentialHint: row.credential_hint ?? "",
    updatedAt: row.updated_at.toISOString()
  };
}

async function ensureSettings(client: PoolClient, context: AuthContext) {
  await client.query(
    `INSERT INTO community_app_settings (community_id, created_by, updated_by)
     VALUES ($1, $2, $2)
     ON CONFLICT (community_id) DO NOTHING`,
    [context.current.communityId, context.user.id]
  );
}

async function readSettings(client: PoolClient, context: AuthContext): Promise<SettingsDTO> {
  await ensureSettings(client, context);
  const settings = await client.query<SettingsRow>(
    `SELECT c.name,c.tax_id,c.address,c.postal_code,c.city,c.province,c.country_code,c.phone,
            c.contact_email::text,c.website_url,c.timezone,c.locale,c.legal_profile,
            s.office_hours,s.time_format,s.date_format,s.currency_code,s.fiscal_year_start_month,
            s.default_due_day,s.notifications_email,s.notifications_push,s.accounting_enabled,
            s.accounting_enabled_at,
            (SELECT count(*)::int FROM accounting_entries entry
              WHERE entry.community_id=c.id AND entry.source_type LIKE 'financial_record.%') AS automatic_accounting_entries,
            s.backup_provider,
            s.backup_frequency,to_char(s.backup_time,'HH24:MI') AS backup_time,
            s.backup_retention_days,s.backup_notification_email::text
       FROM communities c
       JOIN community_app_settings s ON s.community_id=c.id
      WHERE c.id=$1`,
    [context.current.communityId]
  );
  if (!settings.rowCount) throw new ApiError(404, "La comunidad no está disponible.", "not_found");
  const row = settings.rows[0];
  const integrations = await client.query<IntegrationRow>(
    `SELECT id::text,name,kind,provider,endpoint_url,account_reference,status,
            (credential_ciphertext IS NOT NULL) AS credential_configured,credential_hint,updated_at
       FROM community_integrations
      WHERE community_id=$1 AND archived_at IS NULL
      ORDER BY status='enabled' DESC,name,id`,
    [context.current.communityId]
  );
  return {
    community: {
      name: row.name, taxId: row.tax_id ?? "", address: row.address, postalCode: row.postal_code ?? "",
      city: row.city ?? "", province: row.province ?? "", countryCode: row.country_code.trim(),
      phone: row.phone ?? "", contactEmail: row.contact_email ?? "", websiteUrl: row.website_url ?? "",
      timezone: row.timezone, locale: row.locale, legalProfile: row.legal_profile
    },
    preferences: {
      officeHours: row.office_hours ?? "", timeFormat: row.time_format, dateFormat: row.date_format,
      currencyCode: row.currency_code.trim(), fiscalYearStartMonth: row.fiscal_year_start_month,
      defaultDueDay: row.default_due_day, notificationsEmail: row.notifications_email,
      notificationsPush: row.notifications_push, accountingEnabled: row.accounting_enabled,
      accountingEnabledAt: row.accounting_enabled_at?.toISOString() ?? null,
      automaticAccountingEntries: row.automatic_accounting_entries,
      backupProvider: row.backup_provider,
      backupFrequency: row.backup_frequency, backupTime: row.backup_time,
      backupRetentionDays: row.backup_retention_days, backupNotificationEmail: row.backup_notification_email ?? ""
    },
    integrations: integrations.rows.map(normalizeIntegration),
    secretStorageReady: secretStorageReady()
  };
}

export async function getSettings(context: AuthContext): Promise<SettingsDTO> {
  assertSettingsAccess(context);
  return withTenant(context.current.communityId, context.user.id, (client) => readSettings(client, context));
}

export async function getEnabledIntegrationCredential(context: AuthContext, kind: IntegrationKind, provider: string) {
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const result = await client.query<{
      credential_ciphertext: Buffer | null;
      credential_iv: Buffer | null;
      credential_tag: Buffer | null;
    }>(
      `SELECT credential_ciphertext, credential_iv, credential_tag
         FROM community_integrations
        WHERE community_id=$1 AND kind=$2 AND lower(provider)=lower($3)
          AND status='enabled' AND archived_at IS NULL
        ORDER BY updated_at DESC
        LIMIT 1`,
      [context.current.communityId, kind, provider]
    );
    const row = result.rows[0];
    if (!row?.credential_ciphertext || !row.credential_iv || !row.credential_tag) return null;
    return decryptCredential(row.credential_ciphertext, row.credential_iv, row.credential_tag);
  });
}

export async function updateSettings(context: AuthContext, input: SettingsUpdateInput, userAgent?: string | null) {
  assertSettingsAccess(context);
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const before = await readSettings(client, context);
    const community = input.community;
    const preferences = input.preferences;
    await client.query(
      `SELECT update_current_community_profile($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)`,
      [community.name, community.taxId, community.address, community.postalCode, community.city,
       community.province, community.countryCode, community.phone, community.contactEmail,
       community.websiteUrl, community.timezone, community.locale, community.legalProfile]
    );
    await client.query(
      `UPDATE community_app_settings
          SET office_hours=$2,time_format=$3,date_format=$4,currency_code=$5,
              fiscal_year_start_month=$6,default_due_day=$7,notifications_email=$8,
              notifications_push=$9,accounting_enabled=$10,
              accounting_enabled_at=CASE WHEN $10 AND NOT accounting_enabled THEN now() WHEN NOT $10 THEN NULL ELSE accounting_enabled_at END,
              accounting_enabled_by=CASE WHEN $10 AND NOT accounting_enabled THEN $16 WHEN NOT $10 THEN NULL ELSE accounting_enabled_by END,
              backup_provider=$11,backup_frequency=$12,
              backup_time=$13::time,backup_retention_days=$14,backup_notification_email=nullif($15,''),
              updated_by=$16
        WHERE community_id=$1`,
      [context.current.communityId, preferences.officeHours || null, preferences.timeFormat,
       preferences.dateFormat, preferences.currencyCode, preferences.fiscalYearStartMonth,
       preferences.defaultDueDay, preferences.notificationsEmail, preferences.notificationsPush,
       preferences.accountingEnabled, preferences.backupProvider, preferences.backupFrequency,
       preferences.backupTime, preferences.backupRetentionDays, preferences.backupNotificationEmail,
       context.user.id]
    );
    const after = await readSettings(client, context);
    await writeAudit(client, {
      communityId: context.current.communityId, userId: context.user.id, action: "settings.updated",
      resourceType: "community_settings", resourceId: context.current.communityId,
      before: { community: before.community, preferences: before.preferences },
      after: { community: after.community, preferences: after.preferences }, userAgent
    });
    return after;
  });
}

function safeIntegrationAudit(input: IntegrationInput, credentialConfigured: boolean) {
  return {
    name: input.name, kind: input.kind, provider: input.provider, endpointUrl: input.endpointUrl,
    accountReference: input.accountReference, status: input.status, credentialConfigured
  };
}

export async function createIntegration(context: AuthContext, input: IntegrationInput, userAgent?: string | null) {
  assertSettingsAccess(context);
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const encrypted = input.credential ? encryptCredential(input.credential) : null;
    const result = await client.query<IntegrationRow>(
      `INSERT INTO community_integrations
        (community_id,name,kind,provider,endpoint_url,account_reference,status,
         credential_ciphertext,credential_iv,credential_tag,credential_hint,created_by,updated_by)
       VALUES ($1,$2,$3,$4,nullif($5,''),nullif($6,''),$7,$8,$9,$10,$11,$12,$12)
       RETURNING id::text,name,kind,provider,endpoint_url,account_reference,status,
         (credential_ciphertext IS NOT NULL) AS credential_configured,credential_hint,updated_at`,
      [context.current.communityId, input.name, input.kind, input.provider, input.endpointUrl,
       input.accountReference, input.status, encrypted?.ciphertext ?? null, encrypted?.iv ?? null,
       encrypted?.tag ?? null, encrypted?.hint ?? null, context.user.id]
    );
    const integration = normalizeIntegration(result.rows[0]);
    await writeAudit(client, {
      communityId: context.current.communityId, userId: context.user.id, action: "integration.created",
      resourceType: "community_integration", resourceId: integration.id,
      after: safeIntegrationAudit(input, integration.credentialConfigured), userAgent
    });
    return integration;
  });
}

export async function updateIntegration(context: AuthContext, id: string, input: IntegrationInput, userAgent?: string | null) {
  assertSettingsAccess(context);
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const before = await client.query<IntegrationRow>(
      `SELECT id::text,name,kind,provider,endpoint_url,account_reference,status,
              (credential_ciphertext IS NOT NULL) AS credential_configured,credential_hint,updated_at
         FROM community_integrations
        WHERE id=$1 AND community_id=$2 AND archived_at IS NULL FOR UPDATE`,
      [id, context.current.communityId]
    );
    if (!before.rowCount) throw new ApiError(404, "La conexión no existe.", "not_found");
    const encrypted = input.credential ? encryptCredential(input.credential) : null;
    const result = await client.query<IntegrationRow>(
      `UPDATE community_integrations
          SET name=$3,kind=$4,provider=$5,endpoint_url=nullif($6,''),account_reference=nullif($7,''),
              status=$8,credential_ciphertext=COALESCE($9,credential_ciphertext),
              credential_iv=COALESCE($10,credential_iv),credential_tag=COALESCE($11,credential_tag),
              credential_hint=COALESCE($12,credential_hint),updated_by=$13
        WHERE id=$1 AND community_id=$2 AND archived_at IS NULL
        RETURNING id::text,name,kind,provider,endpoint_url,account_reference,status,
          (credential_ciphertext IS NOT NULL) AS credential_configured,credential_hint,updated_at`,
      [id, context.current.communityId, input.name, input.kind, input.provider, input.endpointUrl,
       input.accountReference, input.status, encrypted?.ciphertext ?? null, encrypted?.iv ?? null,
       encrypted?.tag ?? null, encrypted?.hint ?? null, context.user.id]
    );
    const integration = normalizeIntegration(result.rows[0]);
    await writeAudit(client, {
      communityId: context.current.communityId, userId: context.user.id, action: "integration.updated",
      resourceType: "community_integration", resourceId: integration.id,
      before: normalizeIntegration(before.rows[0]), after: safeIntegrationAudit(input, integration.credentialConfigured), userAgent
    });
    return integration;
  });
}

export async function archiveIntegration(context: AuthContext, id: string, userAgent?: string | null) {
  assertSettingsAccess(context);
  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const before = await client.query<IntegrationRow>(
      `SELECT id::text,name,kind,provider,endpoint_url,account_reference,status,
              (credential_ciphertext IS NOT NULL) AS credential_configured,credential_hint,updated_at
         FROM community_integrations
        WHERE id=$1 AND community_id=$2 AND archived_at IS NULL FOR UPDATE`,
      [id, context.current.communityId]
    );
    if (!before.rowCount) throw new ApiError(404, "La conexión no existe.", "not_found");
    await client.query(
      `UPDATE community_integrations SET archived_at=now(),updated_by=$3
        WHERE id=$1 AND community_id=$2 AND archived_at IS NULL`,
      [id, context.current.communityId, context.user.id]
    );
    await writeAudit(client, {
      communityId: context.current.communityId, userId: context.user.id, action: "integration.archived",
      resourceType: "community_integration", resourceId: id,
      before: normalizeIntegration(before.rows[0]), after: { archived: true }, userAgent
    });
    return { id };
  });
}
