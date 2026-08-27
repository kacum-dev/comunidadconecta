import type { Role } from "./permissions";

export const DEMO_ROLE_KEYS = [
  "president",
  "vice_president",
  "secretary",
  "treasurer",
  "administrator",
  "owner",
  "resident"
] as const satisfies readonly Role[];

export type DemoRole = (typeof DEMO_ROLE_KEYS)[number];

export interface DemoProfileDTO {
  role: DemoRole;
  label: string;
  description: string;
  icon: string;
}

export interface PublicDemoConfig {
  title: string;
  description: string;
  communityName: string;
  requiresAccessCode: boolean;
  expiresAt: string | null;
  profiles: DemoProfileDTO[];
}

export interface DemoAdminSettingsDTO extends PublicDemoConfig {
  eligible: boolean;
  enabled: boolean;
  sessionDurationMinutes: number;
  enabledRoles: DemoRole[];
  hasAccessCode: boolean;
  availableProfiles: DemoProfileDTO[];
  activeSessions: number;
}

export const DEMO_PROFILE_COPY: Record<DemoRole, Omit<DemoProfileDTO, "role">> = {
  president: { label: "Presidencia", description: "Gobierno, acuerdos, avisos y seguimiento general.", icon: "badge-check" },
  vice_president: { label: "Vicepresidencia", description: "Apoyo a presidencia y visión transversal de la comunidad.", icon: "users" },
  secretary: { label: "Secretaría", description: "Convocatorias, actas, documentos y comunicaciones.", icon: "files" },
  treasurer: { label: "Tesorería", description: "Presupuestos, recibos, bancos y control económico.", icon: "wallet" },
  administrator: { label: "Administración de fincas", description: "Operativa completa, incidencias y gestión diaria.", icon: "briefcase" },
  owner: { label: "Propietario/a", description: "Vivienda, recibos, juntas, reservas y avisos.", icon: "home" },
  resident: { label: "Inquilino/a", description: "Vivienda ocupada, emergencias, avisos, incidencias y reservas.", icon: "users" }
};

export function demoProfiles(roles: readonly DemoRole[] = DEMO_ROLE_KEYS): DemoProfileDTO[] {
  return DEMO_ROLE_KEYS.filter((role) => roles.includes(role)).map((role) => ({ role, ...DEMO_PROFILE_COPY[role] }));
}
