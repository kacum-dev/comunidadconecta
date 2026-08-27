export const communicationChannels = ["app", "email", "phone", "whatsapp", "in_person", "other"] as const;
export const communicationDirections = ["inbound", "outbound", "internal", "system"] as const;
export const communicationStatuses = ["open", "pending", "resolved", "closed"] as const;
export const communicationPriorities = ["low", "normal", "high", "urgent"] as const;

export type CommunicationChannel = (typeof communicationChannels)[number];
export type CommunicationDirection = (typeof communicationDirections)[number];
export type CommunicationStatus = (typeof communicationStatuses)[number];
export type CommunicationPriority = (typeof communicationPriorities)[number];

export const communicationChannelLabels: Record<CommunicationChannel, string> = {
  app: "Aplicación",
  email: "Correo",
  phone: "Teléfono",
  whatsapp: "WhatsApp",
  in_person: "Presencial",
  other: "Otro"
};

export const communicationDirectionLabels: Record<CommunicationDirection, string> = {
  inbound: "Entrante",
  outbound: "Saliente",
  internal: "Nota interna",
  system: "Sistema"
};

export const communicationStatusLabels: Record<CommunicationStatus, string> = {
  open: "Abierta",
  pending: "Pendiente",
  resolved: "Resuelta",
  closed: "Cerrada"
};

export const communicationPriorityLabels: Record<CommunicationPriority, string> = {
  low: "Baja",
  normal: "Normal",
  high: "Alta",
  urgent: "Urgente"
};

function includes<T extends readonly string[]>(values: T, value: unknown): value is T[number] {
  return typeof value === "string" && (values as readonly string[]).includes(value);
}

export function isCommunicationChannel(value: unknown): value is CommunicationChannel {
  return includes(communicationChannels, value);
}

export function isCommunicationDirection(value: unknown): value is CommunicationDirection {
  return includes(communicationDirections, value);
}

export function isCommunicationStatus(value: unknown): value is CommunicationStatus {
  return includes(communicationStatuses, value);
}

export function isCommunicationPriority(value: unknown): value is CommunicationPriority {
  return includes(communicationPriorities, value);
}

export function parseOccurredAt(value: unknown): string {
  if (typeof value !== "string" || !value.trim()) return new Date().toISOString();
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? new Date().toISOString() : parsed.toISOString();
}

export function communicationTimelineLabel(channel: CommunicationChannel, direction: CommunicationDirection) {
  return `${communicationChannelLabels[channel]} · ${communicationDirectionLabels[direction]}`;
}
