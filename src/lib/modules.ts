export type ModuleKey =
  | "estructura"
  | "censo"
  | "economia"
  | "bancos"
  | "juntas"
  | "avisos"
  | "incidencias"
  | "proveedores"
  | "documentos"
  | "aprobaciones"
  | "activos"
  | "reservas"
  | "transicion"
  | "privacidad"
  | "auditoria"
  | "configuracion";

export type FieldKey =
  | "title"
  | "code"
  | "description"
  | "status"
  | "kind"
  | "amount"
  | "eventDate"
  | "dueDate"
  | "contact"
  | "location"
  | "priority"
  | "assignedTo";

export type FieldType = "text" | "textarea" | "select" | "date" | "datetime" | "currency" | "email";

export interface FieldOption {
  value: string;
  label: string;
}

export interface FieldDefinition {
  key: FieldKey;
  label: string;
  type: FieldType;
  required?: boolean;
  placeholder?: string;
  options?: FieldOption[];
  list?: boolean;
  deadline?: boolean;
  inclusive?: boolean;
}

export interface ModuleDefinition {
  key: ModuleKey;
  table: string;
  title: string;
  singular: string;
  eyebrow: string;
  description: string;
  icon: string;
  createLabel: string;
  fields: FieldDefinition[];
  statusOptions: FieldOption[];
  readOnly?: boolean;
  sensitive?: boolean;
}

const option = (value: string, label: string): FieldOption => ({ value, label });

const activeStatuses = [option("active", "Activo"), option("inactive", "Inactivo"), option("review", "En revisión")];
const priorityOptions = [
  option("low", "Baja"),
  option("normal", "Normal"),
  option("high", "Alta"),
  option("urgent", "Urgente")
];

const baseFields = (statusOptions: FieldOption[], kindOptions: FieldOption[]): FieldDefinition[] => [
  { key: "title", label: "Título", type: "text", required: true, list: true },
  { key: "code", label: "Referencia", type: "text", list: true },
  { key: "kind", label: "Tipo", type: "select", required: true, options: kindOptions, list: true },
  { key: "status", label: "Estado", type: "select", required: true, options: statusOptions, list: true },
  { key: "description", label: "Descripción", type: "textarea", list: true }
];

export const moduleDefinitions: Record<ModuleKey, ModuleDefinition> = {
  estructura: {
    key: "estructura",
    table: "structure_nodes",
    title: "Comunidad y estructura",
    singular: "elemento",
    eyebrow: "ORGANIZACIÓN",
    description: "Bloques, portales, zonas comunes, unidades y anexos de la comunidad.",
    icon: "building",
    createLabel: "Nuevo elemento",
    statusOptions: activeStatuses,
    fields: [
      ...baseFields(activeStatuses, [option("site", "Manzana / conjunto"), option("building", "Edificio"), option("subcommunity", "Subcomunidad"), option("block", "Bloque"), option("entrance", "Portal"), option("staircase", "Escalera"), option("private_unit", "Unidad"), option("common_area", "Zona común")]),
      { key: "location", label: "Ubicación", type: "text", list: true },
      { key: "eventDate", label: "Fecha y hora de alta", type: "datetime" }
    ]
  },
  censo: {
    key: "censo",
    table: "people_relations",
    title: "Censo y relaciones",
    singular: "persona",
    eyebrow: "COMUNIDAD",
    description: "Propiedad, ocupación, cargos y relaciones vigentes con cada unidad.",
    icon: "users",
    createLabel: "Añadir persona",
    statusOptions: [option("invited", "Invitada"), option("active", "Activa"), option("pending", "Pendiente"), option("ended", "Finalizada")],
    sensitive: true,
    fields: [
      ...baseFields([option("invited", "Invitada"), option("active", "Activa"), option("pending", "Pendiente"), option("ended", "Finalizada")], [option("owner", "Propietario/a"), option("co_owner", "Copropietario/a"), option("resident", "Ocupante"), option("president", "Presidencia"), option("secretary", "Secretaría")]),
      { key: "contact", label: "Contacto", type: "email", list: true },
      { key: "location", label: "Unidad / ámbito", type: "text", list: true },
      { key: "eventDate", label: "Vigente desde", type: "datetime" },
      { key: "dueDate", label: "Vigente hasta (incluido)", type: "datetime", deadline: true }
    ]
  },
  economia: {
    key: "economia",
    table: "financial_records",
    title: "Economía",
    singular: "registro económico",
    eyebrow: "GESTIÓN",
    description: "Presupuestos, cuotas, derramas, recibos, facturas y saldos explicables.",
    icon: "wallet",
    createLabel: "Nuevo registro",
    statusOptions: [option("draft", "Borrador"), option("pending", "Pendiente"), option("approved", "Aprobado"), option("issued", "Emitido"), option("paid", "Pagado"), option("returned", "Devuelto")],
    sensitive: true,
    fields: [
      ...baseFields([option("draft", "Borrador"), option("pending", "Pendiente"), option("approved", "Aprobado"), option("issued", "Emitido"), option("paid", "Pagado"), option("returned", "Devuelto")], [option("budget", "Presupuesto"), option("charge", "Cuota"), option("assessment", "Derrama"), option("receipt", "Recibo"), option("invoice", "Factura"), option("ledger", "Asiento")]),
      { key: "amount", label: "Importe", type: "currency", required: true, list: true },
      { key: "eventDate", label: "Fecha y hora de emisión", type: "datetime", list: true },
      { key: "dueDate", label: "Vence el (incluido)", type: "datetime", list: true, deadline: true },
      { key: "contact", label: "Persona / proveedor", type: "text" },
      { key: "location", label: "Unidad / partida", type: "text" }
    ]
  },
  bancos: {
    key: "bancos",
    table: "bank_transactions",
    title: "Bancos y conciliación",
    singular: "movimiento",
    eyebrow: "TESORERÍA",
    description: "Movimientos importados, coincidencias, diferencias y trazabilidad de conciliación.",
    icon: "landmark",
    createLabel: "Importar movimiento",
    statusOptions: [option("unmatched", "Sin conciliar"), option("suggested", "Coincidencia sugerida"), option("matched", "Conciliado"), option("ignored", "Ignorado")],
    sensitive: true,
    fields: [
      ...baseFields([option("unmatched", "Sin conciliar"), option("suggested", "Coincidencia sugerida"), option("matched", "Conciliado"), option("ignored", "Ignorado")], [option("credit", "Ingreso"), option("debit", "Cargo")]),
      { key: "amount", label: "Importe", type: "currency", required: true, list: true },
      { key: "eventDate", label: "Fecha y hora de valor", type: "datetime", required: true, list: true },
      { key: "contact", label: "Ordenante / beneficiario", type: "text", list: true },
      { key: "assignedTo", label: "Conciliado con", type: "text" }
    ]
  },
  juntas: {
    key: "juntas",
    table: "meetings",
    title: "Juntas y acuerdos",
    singular: "Junta",
    eyebrow: "GOBIERNO",
    description: "Convocatorias, asistencia, representaciones, votaciones, acuerdos y actas.",
    icon: "vote",
    createLabel: "Nueva Junta",
    statusOptions: [option("draft", "Borrador"), option("called", "Convocada"), option("in_progress", "En curso"), option("review", "Acta en revisión"), option("closed", "Cerrada"), option("challenged", "Impugnada")],
    fields: [
      ...baseFields([option("draft", "Borrador"), option("called", "Convocada"), option("in_progress", "En curso"), option("review", "Acta en revisión"), option("closed", "Cerrada"), option("challenged", "Impugnada")], [option("ordinary", "Ordinaria"), option("extraordinary", "Extraordinaria"), option("informative", "Informativa")]),
      { key: "eventDate", label: "Fecha y hora de celebración", type: "datetime", required: true, list: true },
      { key: "dueDate", label: "Delegaciones hasta (incluido)", type: "datetime", deadline: true },
      { key: "location", label: "Lugar / modalidad", type: "text", list: true },
      { key: "assignedTo", label: "Responsable", type: "text" }
    ]
  },
  avisos: {
    key: "avisos",
    table: "communications",
    title: "Avisos y comunicaciones",
    singular: "aviso",
    eyebrow: "COMUNICACIÓN",
    description: "Comunicaciones segmentadas, notificaciones formales, emergencias y evidencias de entrega.",
    icon: "megaphone",
    createLabel: "Nuevo aviso",
    statusOptions: [option("draft", "Borrador"), option("scheduled", "Programado"), option("published", "Publicado"), option("expired", "Finalizado")],
    fields: [
      ...baseFields([option("draft", "Borrador"), option("scheduled", "Programado"), option("published", "Publicado"), option("expired", "Finalizado")], [option("operational", "Operativo"), option("formal", "Notificación formal"), option("institutional", "Institucional"), option("emergency", "Emergencia"), option("survey", "Encuesta")]),
      { key: "eventDate", label: "Fecha y hora de comunicación", type: "datetime", list: true },
      { key: "dueDate", label: "Visible hasta (incluido)", type: "datetime", deadline: true },
      { key: "location", label: "Destinatarios / ámbito", type: "text", list: true },
      { key: "priority", label: "Prioridad", type: "select", options: priorityOptions, list: true },
      { key: "assignedTo", label: "Emisor", type: "text" }
    ]
  },
  incidencias: {
    key: "incidencias",
    table: "tickets",
    title: "Incidencias",
    singular: "incidencia",
    eyebrow: "OPERACIONES",
    description: "Averías, seguimiento, asignación, SLA, partes y validación del cierre.",
    icon: "wrench",
    createLabel: "Comunicar incidencia",
    statusOptions: [option("received", "Recibida"), option("triage", "En clasificación"), option("assigned", "Asignada"), option("scheduled", "Programada"), option("in_progress", "En curso"), option("blocked", "Bloqueada"), option("resolved", "Resuelta"), option("validated", "Validada"), option("closed", "Cerrada")],
    fields: [
      ...baseFields([option("received", "Recibida"), option("triage", "En clasificación"), option("assigned", "Asignada"), option("scheduled", "Programada"), option("in_progress", "En curso"), option("blocked", "Bloqueada"), option("resolved", "Resuelta"), option("validated", "Validada"), option("closed", "Cerrada")], [option("maintenance", "Mantenimiento"), option("water", "Agua / humedad"), option("electricity", "Electricidad"), option("elevator", "Ascensor"), option("cleaning", "Limpieza"), option("security", "Seguridad"), option("other", "Otra")]),
      { key: "location", label: "¿Dónde ocurre?", type: "text", required: true, list: true },
      { key: "priority", label: "Urgencia", type: "select", options: priorityOptions, required: true, list: true },
      { key: "eventDate", label: "Comunicada el", type: "datetime", list: true },
      { key: "dueDate", label: "Resolver antes de (incluido)", type: "datetime", deadline: true },
      { key: "contact", label: "Contacto", type: "text" },
      { key: "assignedTo", label: "Asignada a", type: "text", list: true }
    ]
  },
  proveedores: {
    key: "proveedores",
    table: "suppliers",
    title: "Proveedores",
    singular: "proveedor",
    eyebrow: "COMPRAS",
    description: "Contratos, seguros, vencimientos, presupuestos, facturas y evaluación.",
    icon: "briefcase",
    createLabel: "Nuevo proveedor",
    statusOptions: [option("candidate", "Candidato"), option("active", "Activo"), option("review", "En revisión"), option("blocked", "Bloqueado"), option("ended", "Finalizado")],
    sensitive: true,
    fields: [
      ...baseFields([option("candidate", "Candidato"), option("active", "Activo"), option("review", "En revisión"), option("blocked", "Bloqueado"), option("ended", "Finalizado")], [option("maintenance", "Mantenimiento"), option("elevators", "Ascensores"), option("cleaning", "Limpieza"), option("insurance", "Seguros"), option("legal", "Legal"), option("technical", "Técnico")]),
      { key: "contact", label: "Contacto", type: "text", list: true },
      { key: "location", label: "Localidad", type: "text" },
      { key: "eventDate", label: "Inicio del contrato", type: "datetime" },
      { key: "dueDate", label: "Finaliza el (incluido)", type: "datetime", list: true, deadline: true },
      { key: "amount", label: "Coste de referencia", type: "currency" },
      { key: "assignedTo", label: "Responsable", type: "text" }
    ]
  },
  documentos: {
    key: "documentos",
    table: "documents",
    title: "Documentos",
    singular: "documento",
    eyebrow: "MEMORIA",
    description: "Archivo institucional con versiones inmutables, clasificación, permisos y trazabilidad.",
    icon: "files",
    createLabel: "Subir documento",
    statusOptions: [option("draft", "Borrador"), option("current", "Vigente"), option("superseded", "Sustituido"), option("retained", "Bloqueado por retención")],
    sensitive: true,
    fields: [
      ...baseFields([option("draft", "Borrador"), option("current", "Vigente"), option("superseded", "Sustituido"), option("retained", "Bloqueado por retención")], [option("governance", "Gobierno"), option("minutes", "Acta"), option("finance", "Economía"), option("invoice", "Factura"), option("property", "Inmueble"), option("insurance", "Seguro"), option("privacy", "Privacidad"), option("other", "Otro")]),
      { key: "eventDate", label: "Fecha y hora de emisión", type: "datetime", list: true },
      { key: "dueDate", label: "Revisar antes de (incluido)", type: "datetime", deadline: true },
      { key: "contact", label: "Emisor", type: "text" }
    ]
  },
  aprobaciones: {
    key: "aprobaciones",
    table: "approvals",
    title: "Aprobaciones",
    singular: "aprobación",
    eyebrow: "DOBLE CONTROL",
    description: "Decisiones sensibles con proponente, responsable distinto, motivo y evidencia.",
    icon: "badge-check",
    createLabel: "Solicitar aprobación",
    statusOptions: [option("pending", "Pendiente"), option("approved", "Aprobada"), option("rejected", "Rechazada"), option("expired", "Caducada")],
    sensitive: true,
    fields: [
      ...baseFields([option("pending", "Pendiente"), option("approved", "Aprobada"), option("rejected", "Rechazada"), option("expired", "Caducada")], [option("general", "General"), option("supplier_quote", "Presupuesto"), option("bank_change", "Cambio bancario"), option("payment", "Pago"), option("bulk_export", "Exportación total"), option("administrator", "Administrador")]),
      { key: "amount", label: "Importe afectado", type: "currency", list: true },
      { key: "dueDate", label: "Resolver antes de (incluido)", type: "datetime", list: true, deadline: true },
      { key: "contact", label: "Tercero afectado", type: "text" },
      { key: "priority", label: "Prioridad", type: "select", options: priorityOptions, list: true },
      { key: "assignedTo", label: "Responsable", type: "text" }
    ]
  },
  activos: {
    key: "activos",
    table: "assets",
    title: "Activos y mantenimiento",
    singular: "activo",
    eyebrow: "INMUEBLE",
    description: "Instalaciones comunes, garantías, inspecciones y mantenimiento preventivo.",
    icon: "hard-hat",
    createLabel: "Nuevo activo",
    statusOptions: [option("active", "Operativo"), option("maintenance_due", "Revisión pendiente"), option("out_of_service", "Fuera de servicio"), option("retired", "Retirado")],
    fields: [
      ...baseFields([option("active", "Operativo"), option("maintenance_due", "Revisión pendiente"), option("out_of_service", "Fuera de servicio"), option("retired", "Retirado")], [option("common_element", "Elemento común"), option("elevator", "Ascensor"), option("water_pump", "Grupo de presión"), option("fire", "Protección contra incendios"), option("pool", "Piscina"), option("roof", "Cubierta")]),
      { key: "location", label: "Ubicación", type: "text", required: true, list: true },
      { key: "eventDate", label: "Puesta en servicio", type: "datetime" },
      { key: "dueDate", label: "Próxima revisión", type: "datetime", list: true, deadline: true },
      { key: "contact", label: "Mantenedor", type: "text" },
      { key: "assignedTo", label: "Responsable", type: "text" }
    ]
  },
  reservas: {
    key: "reservas",
    table: "reservations",
    title: "Reservas",
    singular: "reserva",
    eyebrow: "SERVICIOS",
    description: "Recursos comunes, franjas, aforo, depósitos y reglas aprobadas.",
    icon: "calendar-check",
    createLabel: "Nueva reserva",
    statusOptions: [option("requested", "Solicitada"), option("confirmed", "Confirmada"), option("cancelled", "Cancelada"), option("completed", "Disfrutada")],
    fields: [
      ...baseFields([option("requested", "Solicitada"), option("confirmed", "Confirmada"), option("cancelled", "Cancelada"), option("completed", "Disfrutada")], [option("resource", "Recurso"), option("community_room", "Sala comunitaria"), option("pool", "Piscina"), option("sports", "Pista deportiva"), option("moving", "Mudanza")]),
      { key: "eventDate", label: "Comienza el", type: "datetime", required: true, list: true },
      { key: "dueDate", label: "Finaliza el (excluido)", type: "datetime", deadline: true, inclusive: false },
      { key: "contact", label: "Solicitante", type: "text", list: true },
      { key: "location", label: "Recurso", type: "text" },
      { key: "amount", label: "Depósito", type: "currency" }
    ]
  },
  transicion: {
    key: "transicion",
    table: "transitions",
    title: "Cambio de administrador",
    singular: "transición",
    eyebrow: "CONTINUIDAD",
    description: "Inventario, entrega, revocación, incorporación, conciliación y cierre sin migrar de app.",
    icon: "refresh-cw",
    createLabel: "Iniciar transición",
    statusOptions: [option("initiated", "Iniciada"), option("inventory", "Inventario"), option("delivery", "Entrega"), option("revocation", "Revocación"), option("onboarding", "Incorporación"), option("reconciliation", "Conciliación"), option("closed", "Cerrada")],
    sensitive: true,
    fields: [
      ...baseFields([option("initiated", "Iniciada"), option("inventory", "Inventario"), option("delivery", "Entrega"), option("revocation", "Revocación"), option("onboarding", "Incorporación"), option("reconciliation", "Conciliación"), option("closed", "Cerrada")], [option("administrator_change", "Cambio de administrador")]),
      { key: "eventDate", label: "Efectiva desde", type: "datetime", required: true, list: true },
      { key: "dueDate", label: "Cierre previsto (incluido)", type: "datetime", deadline: true },
      { key: "contact", label: "Administrador entrante", type: "text" },
      { key: "assignedTo", label: "Responsable interno", type: "text", list: true },
      { key: "priority", label: "Riesgo", type: "select", options: priorityOptions }
    ]
  },
  privacidad: {
    key: "privacidad",
    table: "privacy_cases",
    title: "Privacidad y cumplimiento",
    singular: "expediente",
    eyebrow: "RGPD",
    description: "Derechos, tratamientos, retención, encargados, riesgos y brechas documentadas.",
    icon: "shield-check",
    createLabel: "Nuevo expediente",
    statusOptions: [option("received", "Recibido"), option("identity_check", "Verificar identidad"), option("in_progress", "En tramitación"), option("waiting", "Pendiente de información"), option("answered", "Respondido"), option("closed", "Cerrado")],
    sensitive: true,
    fields: [
      ...baseFields([option("received", "Recibido"), option("identity_check", "Verificar identidad"), option("in_progress", "En tramitación"), option("waiting", "Pendiente de información"), option("answered", "Respondido"), option("closed", "Cerrado")], [option("access", "Acceso"), option("rectification", "Rectificación"), option("erasure", "Supresión"), option("opposition", "Oposición"), option("restriction", "Limitación"), option("portability", "Portabilidad"), option("processing", "Tratamiento"), option("breach", "Brecha")]),
      { key: "eventDate", label: "Recibida el", type: "datetime", required: true, list: true },
      { key: "dueDate", label: "Plazo hasta (incluido)", type: "datetime", required: true, list: true, deadline: true },
      { key: "contact", label: "Solicitante / encargado", type: "text" },
      { key: "assignedTo", label: "Responsable", type: "text", list: true },
      { key: "priority", label: "Riesgo", type: "select", options: priorityOptions }
    ]
  },
  auditoria: {
    key: "auditoria",
    table: "audit_events",
    title: "Auditoría",
    singular: "evento",
    eyebrow: "TRAZABILIDAD",
    description: "Registro inmutable de accesos, cambios, decisiones y resultados relevantes.",
    icon: "scroll-text",
    createLabel: "",
    readOnly: true,
    sensitive: true,
    statusOptions: [option("success", "Correcto"), option("denied", "Denegado"), option("error", "Error")],
    fields: []
  },
  configuracion: {
    key: "configuracion",
    table: "configuration_records",
    title: "Configuración",
    singular: "configuración",
    eyebrow: "COMUNIDAD",
    description: "Ejercicios, reglas jurídicas, canales, conservación e integraciones de la comunidad.",
    icon: "settings",
    createLabel: "Nueva configuración",
    statusOptions: activeStatuses,
    sensitive: true,
    fields: [
      ...baseFields(activeStatuses, [option("general", "General"), option("fiscal_period", "Ejercicio"), option("legal_profile", "Perfil jurídico"), option("notification", "Canal"), option("retention", "Conservación"), option("integration", "Integración")]),
      { key: "eventDate", label: "Vigente desde", type: "datetime" },
      { key: "dueDate", label: "Vigente hasta (incluido)", type: "datetime", deadline: true },
      { key: "contact", label: "Responsable", type: "text" }
    ]
  }
};

export const moduleKeys = Object.keys(moduleDefinitions) as ModuleKey[];

export function isModuleKey(value: string): value is ModuleKey {
  return Object.prototype.hasOwnProperty.call(moduleDefinitions, value);
}

export function fieldByKey(definition: ModuleDefinition, key: FieldKey) {
  return definition.fields.find((field) => field.key === key);
}

export function optionLabel(options: FieldOption[] | undefined, value: string | null | undefined) {
  if (!value) return "—";
  return options?.find((item) => item.value === value)?.label ?? value;
}
