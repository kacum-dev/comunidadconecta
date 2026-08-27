"use client";

import { useState, type FormEvent } from "react";
import type { AccessEntry } from "@/lib/access";
import type { HomeChoice } from "@/lib/homes";
import { roleLabels, type Role } from "@/lib/permissions";
import { formatDateTime } from "@/lib/temporal";
import { Icon } from "./Icon";
import { useTemporalPreferences } from "./TemporalContext";

const roleDescriptions: Partial<Record<Role, string>> = {
  president: "Supervisión y decisiones reservadas", vice_president: "Apoyo al gobierno, sin aprobación final",
  secretary: "Juntas, actas y comunicaciones", treasurer: "Economía y conciliación",
  administrator: "Gestión diaria sin aprobar sus propias propuestas", owner: "Información económica de su vivienda",
  resident: "Avisos, incidencias y reservas", supplier: "Solo trabajos asignados", auditor: "Consulta y exportación"
};

export function AccessView({ initialAccess, homes, assignableRoles }: { initialAccess: AccessEntry[]; homes: HomeChoice[]; assignableRoles: Role[] }) {
  const preferences = useTemporalPreferences();
  const [entries, setEntries] = useState(initialAccess);
  const [open, setOpen] = useState(false);
  const [selectedRole, setSelectedRole] = useState<Role>(assignableRoles[0] ?? "owner");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const needsUnit = selectedRole === "owner" || selectedRole === "resident";

  async function refresh() { const response = await fetch("/api/access", { cache: "no-store" }); if (response.ok) setEntries((await response.json()).access); }
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); setBusy(true); setError(""); const form = new FormData(event.currentTarget);
    const relationType = selectedRole === "owner" ? "owner" : selectedRole === "resident" ? "tenant" : null;
    const response = await fetch("/api/access", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ fullName: form.get("fullName"), email: form.get("email"), role: selectedRole, temporaryPassword: form.get("temporaryPassword"), unitId: needsUnit ? form.get("unitId") : null, relationType }) });
    const body = await response.json();
    if (!response.ok) setError(body.error || "No se ha podido crear el acceso.");
    else { setOpen(false); setToast("Acceso preparado correctamente"); await refresh(); }
    setBusy(false);
  }
  async function revoke(entry: AccessEntry) {
    if (!confirm(`¿Retirar el perfil ${roleLabels[entry.role]} de ${entry.fullName}?`)) return;
    setBusy(true); setError(""); const response = await fetch(`/api/access/${entry.membershipId}`, { method: "DELETE" }); const body = await response.json();
    if (!response.ok) setError(body.error || "No se ha podido retirar el acceso."); else { setToast("Acceso retirado"); await refresh(); }
    setBusy(false);
  }

  const people = new Set(entries.map((entry) => entry.userId)).size;
  const governance = entries.filter((entry) => ["president","vice_president","secretary","treasurer"].includes(entry.role)).length;
  return <div className="page access-page">
    <div className="page-heading"><div><span className="eyebrow">SEGURIDAD Y RESPONSABILIDADES</span><h1>Accesos y cargos</h1><p>Cada persona entra con su propio usuario y solo ve las funciones de su perfil. Los cambios quedan registrados.</p></div><div className="heading-actions"><button className="button button-primary" onClick={() => { setError(""); setOpen(true); }}><Icon name="plus" size={18} /> Dar acceso</button></div></div>
    {error && <div className="form-alert homes-alert">{error}</div>}
    <section className="home-summary-grid"><div><span className="summary-icon purple"><Icon name="users" /></span><span><strong>{people}</strong><small>Personas con acceso</small></span></div><div><span className="summary-icon green"><Icon name="shield-check" /></span><span><strong>{governance}</strong><small>Cargos de gobierno</small></span></div><div><span className="summary-icon orange"><Icon name="home" /></span><span><strong>{entries.filter((entry) => entry.unitCode).length}</strong><small>Perfiles vinculados a vivienda</small></span></div></section>
    <section className="data-card access-card"><div className="access-table-head"><span>Persona</span><span>Perfil y alcance</span><span>Vivienda</span><span>Último acceso</span><span /></div>{entries.map((entry) => <div className="access-row" key={entry.membershipId}><span className="access-person"><span className="person-avatar">{entry.fullName.split(/\s+/).slice(0,2).map((p) => p[0]).join("")}</span><span><strong>{entry.fullName}</strong><small>{entry.email}</small></span></span><span className="access-role"><strong>{roleLabels[entry.role]}</strong><small>{roleDescriptions[entry.role] || "Acceso específico"}</small></span><span><b>{entry.unitCode || "Toda la comunidad"}</b></span><span><small>{entry.lastLoginAt ? formatDateTime(entry.lastLoginAt, preferences) : "Todavía no ha entrado"}</small></span><span><button className="button button-danger-ghost" disabled={busy} onClick={() => revoke(entry)}>Retirar</button></span></div>)}</section>
    <section className="permission-note"><span><Icon name="shield-check" /></span><div><strong>Permisos con separación de funciones</strong><p>Administración puede preparar y gestionar, pero no aprobar sus propias propuestas. Tesorería controla la economía sin administrar usuarios. Propietarios e inquilinos quedan limitados a la vivienda vinculada.</p></div></section>
    {open && <div className="modal-backdrop" role="presentation"><section className="record-dialog" role="dialog" aria-modal="true"><header className="dialog-header"><div><span className="eyebrow">NUEVO ACCESO</span><h2>Dar acceso a una persona</h2><p>Si el correo ya existe, se añadirá el perfil sin cambiar su contraseña.</p></div><button className="icon-button" onClick={() => setOpen(false)}><Icon name="close" /></button></header><form className="dialog-form" onSubmit={submit}><div className="dialog-scroll"><div className="form-grid"><label className="field-group"><span>Nombre completo *</span><input name="fullName" required maxLength={180} /></label><label className="field-group"><span>Correo electrónico *</span><input name="email" required type="email" maxLength={254} /></label><label className="field-group"><span>Perfil *</span><select name="role" value={selectedRole} onChange={(event) => setSelectedRole(event.target.value as Role)}>{assignableRoles.map((role) => <option value={role} key={role}>{roleLabels[role]}</option>)}</select><small className="field-hint">{roleDescriptions[selectedRole]}</small></label>{needsUnit && <label className="field-group"><span>Vivienda *</span><select name="unitId" required><option value="">Selecciona una vivienda</option>{homes.map((home) => <option value={home.id} key={home.id}>{home.code}</option>)}</select></label>}<label className="field-group field-wide"><span>Contraseña temporal (solo cuentas nuevas)</span><input name="temporaryPassword" type="password" minLength={12} maxLength={256} autoComplete="new-password" placeholder="Mínimo 12 caracteres" /><small className="field-hint">Entrégala por un canal seguro. Si la cuenta ya existe, déjalo vacío.</small></label></div></div><footer className="dialog-footer"><div><button className="button button-secondary" type="button" disabled={busy} onClick={() => setOpen(false)}>Cancelar</button></div><div className="dialog-footer-actions"><button className="button button-primary" disabled={busy} type="submit">{busy && <span className="spinner" />} Crear acceso</button></div></footer></form></section></div>}
    {toast && <div className="toast" role="status"><Icon name="badge-check" size={17} /> {toast}<button aria-label="Cerrar" onClick={() => setToast("")}><Icon name="close" size={14} /></button></div>}
  </div>;
}
