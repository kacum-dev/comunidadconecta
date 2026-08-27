export type TimeFormat = "24h" | "12h";
export type DateFormat = "DD/MM/YYYY" | "YYYY-MM-DD";
export type BackupProvider = "hosting" | "s3" | "disabled";
export type BackupFrequency = "daily" | "weekly" | "monthly";
export type IntegrationKind = "accounting" | "banking" | "storage" | "calendar" | "email" | "weather" | "payments" | "signature" | "ai" | "ocr" | "import" | "push" | "webhook" | "other";
export type IntegrationStatus = "draft" | "enabled" | "paused";

export interface CommunitySettingsData {
  name: string;
  taxId: string;
  address: string;
  postalCode: string;
  city: string;
  province: string;
  countryCode: string;
  phone: string;
  contactEmail: string;
  websiteUrl: string;
  timezone: string;
  locale: string;
  legalProfile: string;
}

export interface OperationalSettingsData {
  officeHours: string;
  timeFormat: TimeFormat;
  dateFormat: DateFormat;
  currencyCode: string;
  fiscalYearStartMonth: number;
  defaultDueDay: number;
  notificationsEmail: boolean;
  notificationsPush: boolean;
  accountingEnabled: boolean;
  accountingEnabledAt: string | null;
  automaticAccountingEntries: number;
  backupProvider: BackupProvider;
  backupFrequency: BackupFrequency;
  backupTime: string;
  backupRetentionDays: number;
  backupNotificationEmail: string;
}

export interface IntegrationData {
  id: string;
  name: string;
  kind: IntegrationKind;
  provider: string;
  endpointUrl: string;
  accountReference: string;
  status: IntegrationStatus;
  credentialConfigured: boolean;
  credentialHint: string;
  updatedAt: string;
}

export interface SettingsDTO {
  community: CommunitySettingsData;
  preferences: OperationalSettingsData;
  integrations: IntegrationData[];
  secretStorageReady: boolean;
}
