import type { ModuleKey } from "./modules";

export type Role =
  | "owner"
  | "resident"
  | "president"
  | "vice_president"
  | "secretary"
  | "treasurer"
  | "administrator"
  | "supplier"
  | "auditor"
  | "support"
  | "platform_admin";

export type Action = "read" | "write" | "archive" | "export" | "approve";

export const roleLabels: Record<Role, string> = {
  owner: "Propietario/a",
  resident: "Ocupante",
  president: "Presidencia",
  vice_president: "Vicepresidencia",
  secretary: "Secretaría",
  treasurer: "Tesorería",
  administrator: "Administración",
  supplier: "Proveedor",
  auditor: "Auditoría",
  support: "Soporte temporal",
  platform_admin: "Plataforma"
};

const ownerRead: ModuleKey[] = ["economia", "juntas", "avisos", "incidencias", "documentos", "reservas", "activos"];
const residentRead: ModuleKey[] = ["avisos", "incidencias", "documentos", "reservas", "activos"];
const residentUnitScopedRecords: ModuleKey[] = ["economia", "incidencias", "documentos", "reservas"];
const secretaryWrite: ModuleKey[] = ["juntas", "avisos", "documentos", "incidencias"];
const treasurerRead: ModuleKey[] = ["estructura", "censo", "economia", "bancos", "proveedores", "documentos", "aprobaciones", "auditoria", "configuracion"];
const treasurerWrite: ModuleKey[] = ["economia", "bancos", "proveedores", "documentos", "aprobaciones"];
const administratorWrite: ModuleKey[] = [
  "estructura", "censo", "economia", "bancos", "juntas", "avisos", "incidencias",
  "proveedores", "documentos", "aprobaciones", "activos", "reservas", "transicion",
  "privacidad", "configuracion"
];
const presidentWrite: ModuleKey[] = ["estructura", "censo", "juntas", "avisos", "incidencias", "proveedores", "documentos", "aprobaciones", "activos", "reservas", "transicion", "configuracion"];

export function can(role: Role, module: ModuleKey, action: Action): boolean {
  if (role === "platform_admin") {
    return module === "auditoria" ? action === "read" || action === "export" : true;
  }

  if (role === "administrator") {
    if (action === "read" || action === "export") return true;
    if (action === "approve") return false;
    return module !== "auditoria" && administratorWrite.includes(module);
  }

  if (role === "president") {
    if (action === "read" || action === "export") return true;
    if (action === "approve") return module === "aprobaciones";
    return module !== "auditoria" && presidentWrite.includes(module);
  }

  if (role === "vice_president") {
    if (action === "read" || action === "export") return true;
    if (action === "approve") return false;
    return module !== "auditoria" && presidentWrite.includes(module);
  }

  if (role === "secretary") {
    if (action === "read") return module !== "bancos" && module !== "privacidad";
    if (action === "export") return module !== "privacidad" && module !== "censo";
    return secretaryWrite.includes(module) && action !== "approve";
  }

  if (role === "treasurer") {
    if (action === "read" || action === "export") return treasurerRead.includes(module);
    if (action === "approve") return false;
    return treasurerWrite.includes(module);
  }

  if (role === "owner") {
    if (action === "read") return ownerRead.includes(module);
    if (action === "write") return module === "incidencias" || module === "reservas";
    return false;
  }

  if (role === "resident") {
    if (action === "read") return residentRead.includes(module);
    if (action === "write") return module === "incidencias" || module === "reservas";
    return false;
  }

  if (role === "supplier") {
    return module === "incidencias" && (action === "read" || action === "write");
  }

  if (role === "auditor") {
    return action === "read" || action === "export";
  }

  if (role === "support") {
    return action === "read" && module !== "economia" && module !== "bancos" && module !== "censo";
  }

  return false;
}

export function canManageHomes(role: Role) {
  return ["president", "vice_president", "secretary", "administrator", "platform_admin"].includes(role);
}

export function canManageAccess(role: Role) {
  return ["president", "administrator", "platform_admin"].includes(role);
}

export function canManageSettings(role: Role) {
  return role === "administrator" || role === "platform_admin";
}

export function canUseAccounting(role: Role) {
  return ["president", "vice_president", "secretary", "treasurer", "administrator", "auditor", "platform_admin"].includes(role);
}

export function isResidentRole(role: Role) {
  return role === "owner" || role === "resident";
}

export function needsResidentUnitScope(role: Role, module: ModuleKey) {
  return isResidentRole(role) && residentUnitScopedRecords.includes(module);
}

export function isGovernanceRole(role: Role) {
  return ["president", "vice_president", "secretary", "treasurer"].includes(role);
}

export const rolePriority: Role[] = [
  "platform_admin", "administrator", "president", "vice_president", "secretary", "treasurer",
  "owner", "resident", "auditor", "supplier", "support"
];
