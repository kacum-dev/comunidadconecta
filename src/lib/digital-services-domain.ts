export type DigitalCapabilityKey =
  | "sepa"
  | "payments"
  | "incident_files"
  | "eid"
  | "accounting"
  | "copilot"
  | "imports"
  | "push";

export type DigitalIntegrationKind =
  | "accounting"
  | "banking"
  | "storage"
  | "calendar"
  | "email"
  | "weather"
  | "payments"
  | "signature"
  | "ai"
  | "ocr"
  | "import"
  | "push"
  | "webhook"
  | "other";

export type DigitalCapabilityState = "active" | "ready" | "planned";

export interface DigitalCapabilityDefinition {
  key: DigitalCapabilityKey;
  title: string;
  shortTitle: string;
  summary: string;
  help: string;
  icon: string;
  href: string;
  integrationKinds: readonly DigitalIntegrationKind[];
  features: readonly string[];
  phase: "foundation" | "later";
  native?: boolean;
}

export interface IntegrationStatusLike {
  kind: string;
  status: string;
}

export const digitalCapabilities = [
  {
    key: "sepa",
    title: "SEPA, mandatos y Norma 43",
    shortTitle: "Cobros SEPA",
    summary: "Prepara remesas, conserva mandatos y trae extractos bancarios con trazabilidad.",
    help: "La importación CSV y Norma 43 ya está disponible. Los mandatos y la emisión pain.008 necesitarán la configuración SEPA de la comunidad.",
    icon: "landmark",
    href: "/conexion-bancaria",
    integrationKinds: ["banking"],
    features: ["Mandatos verificables", "Remesas pain.008", "Importación Norma 43"],
    phase: "foundation"
  },
  {
    key: "payments",
    title: "Tarjeta y Bizum",
    shortTitle: "Pago inmediato",
    summary: "Permite pagar un recibo sin salir de la experiencia del propietario.",
    help: "Los cobros se activan únicamente cuando la comunidad conecta un proveedor de pagos autorizado. La app no almacena datos de tarjeta.",
    icon: "wallet",
    href: "/economia",
    integrationKinds: ["payments"],
    features: ["Tarjeta tokenizada", "Bizum", "Idempotencia y devoluciones"],
    phase: "foundation"
  },
  {
    key: "incident_files",
    title: "Fotos y archivos en incidencias",
    shortTitle: "Evidencias",
    summary: "Vincula imágenes, partes y presupuestos a la incidencia y a su seguimiento.",
    help: "Las evidencias reutilizan el archivo documental inmutable, con hash, versión, tamaño y permisos por comunidad.",
    icon: "files",
    href: "/incidencias",
    integrationKinds: [],
    features: ["Imágenes y PDF", "Hash SHA-256", "Visibilidad controlada"],
    phase: "foundation",
    native: true
  },
  {
    key: "eid",
    title: "Firma electrónica eIDAS",
    shortTitle: "Firma eIDAS",
    summary: "Orquesta firmas y conserva la evidencia que permite comprobar cada documento.",
    help: "La validez y el nivel de firma dependen del prestador cualificado contratado. Comunidad Conecta conserva el sobre, el hash y la evidencia.",
    icon: "badge-check",
    href: "/documentos",
    integrationKinds: ["signature"],
    features: ["Firma simple o avanzada", "Sello de tiempo", "Expediente de evidencia"],
    phase: "foundation"
  },
  {
    key: "accounting",
    title: "Contabilidad PGC y OCR",
    shortTitle: "Contabilidad",
    summary: "Convierte facturas revisadas en propuestas de asiento con partida doble.",
    help: "El OCR nunca contabiliza por sí solo: extrae datos y propone cuentas. Una persona debe revisar y aprobar el asiento.",
    icon: "scroll-text",
    href: "/economia",
    integrationKinds: ["accounting", "ocr"],
    features: ["Plan General Contable", "Partida doble", "OCR con revisión humana"],
    phase: "foundation"
  },
  {
    key: "copilot",
    title: "Copilot operativo",
    shortTitle: "Copilot",
    summary: "Propone respuestas y próximos pasos para incidencias, correo, documentos y morosidad.",
    help: "Las sugerencias quedan pendientes de revisión, con contexto mínimo, hash de entrada y registro de aceptación o rechazo.",
    icon: "sparkles",
    href: "/incidencias",
    integrationKinds: ["ai"],
    features: ["Borradores, no decisiones", "Revisión humana", "Trazabilidad del contexto"],
    phase: "foundation"
  },
  {
    key: "imports",
    title: "Importación y migración",
    shortTitle: "Importador",
    summary: "Trae Excel, CSV, Norma 43 y exportaciones de otros programas por lotes reversibles.",
    help: "Cada importación conserva el fichero, su huella, el resultado por fila y el usuario que confirmó los datos.",
    icon: "upload",
    href: "/configuracion?tab=integrations",
    integrationKinds: ["import"],
    features: ["Excel y CSV", "Detección de formato", "Informe de errores por fila"],
    phase: "foundation"
  },
  {
    key: "push",
    title: "Push real y app nativa",
    shortTitle: "Notificaciones",
    summary: "Prepara suscripciones por dispositivo y entregas push; la app nativa queda como siguiente capa.",
    help: "La PWA es el primer canal. iOS y Android reutilizarán el mismo registro de dispositivos, preferencias e idempotencia.",
    icon: "bell",
    href: "/notificaciones",
    integrationKinds: ["push"],
    features: ["PWA primero", "Preferencias por dispositivo", "iOS y Android después"],
    phase: "later"
  }
] as const satisfies readonly DigitalCapabilityDefinition[];

export function resolveCapabilityState(
  capability: DigitalCapabilityDefinition,
  integrations: readonly IntegrationStatusLike[]
): DigitalCapabilityState {
  if (capability.native) return "active";
  if (capability.integrationKinds.some((kind) => integrations.some((item) => item.kind === kind && item.status === "enabled"))) {
    return "active";
  }
  if (capability.phase === "later") return "planned";
  return "ready";
}

export type ImportFormat = "excel" | "csv" | "norma43" | "sepa_xml" | "pragma" | "gesfincas" | "fynkus" | "unknown";

export function detectImportFormat(filename: string, sample = ""): ImportFormat {
  const normalized = filename.trim().toLowerCase();
  if (normalized.includes("pragma")) return "pragma";
  if (normalized.includes("gesfincas")) return "gesfincas";
  if (normalized.includes("fynkus")) return "fynkus";
  if (/\.(xlsx?|ods)$/.test(normalized)) return "excel";
  if (/\.(n43|norma43)$/.test(normalized) || (/\.txt$/.test(normalized) && /^(11|22|23|24|33|88)/m.test(sample))) return "norma43";
  if (/\.xml$/.test(normalized) && /<\?xml|<Document/i.test(sample)) return "sepa_xml";
  if (/\.(csv|tsv)$/.test(normalized)) return "csv";
  return "unknown";
}

export function isValidPgcAccount(code: string) {
  return /^[1-9]\d{2,9}$/.test(code.trim());
}

export function isValidSpanishIban(value: string) {
  const iban = value.replace(/\s+/g, "").toUpperCase();
  if (!/^ES\d{22}$/.test(iban)) return false;
  const rearranged = iban.slice(4) + iban.slice(0, 4);
  let remainder = 0;
  for (const character of rearranged) {
    const fragment = /\d/.test(character) ? character : String(character.charCodeAt(0) - 55);
    for (const digit of fragment) remainder = (remainder * 10 + Number(digit)) % 97;
  }
  return remainder === 1;
}
