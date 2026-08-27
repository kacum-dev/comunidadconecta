export function rightsDeadline(receivedAt: Date, extensionMonths = 0) {
  if (Number.isNaN(receivedAt.getTime()) || !Number.isInteger(extensionMonths) || extensionMonths < 0 || extensionMonths > 2) throw new Error("Plazo no válido.");
  const originalDay = receivedAt.getUTCDate();
  const due = new Date(receivedAt);
  due.setUTCDate(1);
  due.setUTCMonth(due.getUTCMonth() + 1 + extensionMonths);
  const lastDay = new Date(Date.UTC(due.getUTCFullYear(), due.getUTCMonth() + 1, 0)).getUTCDate();
  due.setUTCDate(Math.min(originalDay, lastDay));
  return due;
}
export function breachDeadline(discoveredAt: Date) {
  return new Date(discoveredAt.getTime() + 72 * 3_600_000);
}
export function breachRequiresAuthority(risk: string) { return risk === "risk" || risk === "high_risk"; }
export function breachRequiresSubjects(risk: string) { return risk === "high_risk"; }
