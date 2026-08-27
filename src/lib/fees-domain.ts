export interface FeeUnit { id: string; code: string; coefficient: number; fixedCents: number | null }
export interface FeeAllocation extends FeeUnit { amountCents: number; explanation: string }
export type FeeFrequency = "monthly" | "quarterly" | "yearly";
export interface FeeOccurrencePlan { number: number; dueLocal: string; issueLocal: string }

const localDateTime = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})(?::(\d{2}))?$/;

function localParts(value: string) {
  const match = value.match(localDateTime);
  if (!match) throw new Error("La primera fecha de vencimiento no es válida.");
  const parts = {
    year: Number(match[1]), month: Number(match[2]), day: Number(match[3]),
    hour: Number(match[4]), minute: Number(match[5]), second: Number(match[6] ?? "0")
  };
  const check = new Date(Date.UTC(parts.year, parts.month - 1, parts.day, parts.hour, parts.minute, parts.second));
  if (check.getUTCFullYear() !== parts.year || check.getUTCMonth() !== parts.month - 1 || check.getUTCDate() !== parts.day || parts.hour > 23 || parts.minute > 59 || parts.second > 59) {
    throw new Error("La primera fecha de vencimiento no es válida.");
  }
  return parts;
}

function pad(value: number) { return String(value).padStart(2, "0"); }
function localString(date: Date) {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}T${pad(date.getUTCHours())}:${pad(date.getUTCMinutes())}:${pad(date.getUTCSeconds())}`;
}

export function buildFeeOccurrencePlan(
  firstDueLocal: string,
  frequency: FeeFrequency,
  issueLeadDays: number,
  endsOn: string | null,
  maxOccurrences = 24
): FeeOccurrencePlan[] {
  const first = localParts(firstDueLocal);
  if (!Number.isInteger(issueLeadDays) || issueLeadDays < 0 || issueLeadDays > 90) throw new Error("La antelación debe estar entre 0 y 90 días.");
  if (!Number.isInteger(maxOccurrences) || maxOccurrences < 1 || maxOccurrences > 120) throw new Error("El número de cuotas previstas no es válido.");
  if (endsOn && !/^\d{4}-\d{2}-\d{2}$/.test(endsOn)) throw new Error("La fecha final de la serie no es válida.");
  const monthStep = frequency === "monthly" ? 1 : frequency === "quarterly" ? 3 : 12;
  const result: FeeOccurrencePlan[] = [];
  for (let index = 0; index < maxOccurrences; index += 1) {
    const absoluteMonth = first.month - 1 + index * monthStep;
    const year = first.year + Math.floor(absoluteMonth / 12);
    const monthIndex = ((absoluteMonth % 12) + 12) % 12;
    const lastDay = new Date(Date.UTC(year, monthIndex + 1, 0)).getUTCDate();
    const due = new Date(Date.UTC(year, monthIndex, Math.min(first.day, lastDay), first.hour, first.minute, first.second));
    const dueDate = localString(due).slice(0, 10);
    if (endsOn && dueDate > endsOn) break;
    const issue = new Date(due.getTime());
    issue.setUTCDate(issue.getUTCDate() - issueLeadDays);
    result.push({ number: index + 1, dueLocal: localString(due), issueLocal: localString(issue) });
  }
  return result;
}

function distribute(totalCents: number, units: FeeUnit[], weights: number[]) {
  const weightTotal = weights.reduce((sum, weight) => sum + weight, 0);
  if (weightTotal <= 0) throw new Error("Las unidades no tienen coeficientes configurados.");
  const raw = weights.map((weight) => totalCents * weight / weightTotal);
  const cents = raw.map(Math.floor);
  let remainder = totalCents - cents.reduce((sum, amount) => sum + amount, 0);
  raw.map((amount, index) => ({ index, fraction: amount - Math.floor(amount) }))
    .sort((a, b) => b.fraction - a.fraction || units[a.index].code.localeCompare(units[b.index].code))
    .forEach(({ index }) => {
      if (remainder > 0) {
        cents[index] += 1;
        remainder -= 1;
      }
    });
  return { cents, weightTotal };
}

export function allocateFees(totalCents: number, units: FeeUnit[], method: "unit_settings" | "coefficient" | "equal"): FeeAllocation[] {
  if (!Number.isSafeInteger(totalCents) || totalCents <= 0 || units.length === 0) throw new Error("Datos de reparto no válidos.");
  if (units.some((unit) => !Number.isFinite(unit.coefficient) || unit.coefficient < 0 ||
    (unit.fixedCents !== null && (!Number.isSafeInteger(unit.fixedCents) || unit.fixedCents < 0)))) {
    throw new Error("Hay coeficientes o cuotas fijas no válidos.");
  }

  if (method === "unit_settings") {
    const fixedTotal = units.reduce((sum, unit) => sum + (unit.fixedCents ?? 0), 0);
    if (fixedTotal > totalCents) throw new Error("Las cuotas fijas superan el total de la emisión.");
    const variableUnits = units.filter((unit) => unit.fixedCents === null);
    const remaining = totalCents - fixedTotal;
    if (variableUnits.length === 0 && remaining !== 0) throw new Error("Las cuotas fijas no cubren exactamente el total de la emisión.");
    const variableDistribution = variableUnits.length && remaining > 0
      ? distribute(remaining, variableUnits, variableUnits.map((unit) => unit.coefficient))
      : { cents: variableUnits.map(() => 0), weightTotal: variableUnits.reduce((sum, unit) => sum + unit.coefficient, 0) };
    const variableAmounts = new Map(variableUnits.map((unit, index) => [unit.id, variableDistribution.cents[index]]));
    return units.map((unit) => ({
      ...unit,
      amountCents: unit.fixedCents ?? variableAmounts.get(unit.id) ?? 0,
      explanation: unit.fixedCents !== null
        ? `Cuota fija configurada: ${unit.fixedCents} céntimos`
        : `Parte variable por coeficiente ${unit.coefficient}% sobre ${remaining} céntimos`,
    }));
  }

  const weights = method === "equal" ? units.map(() => 1) : units.map((unit) => unit.coefficient);
  const { cents, weightTotal } = distribute(totalCents, units, weights);
  return units.map((unit, index) => ({
    ...unit,
    amountCents: cents[index],
    explanation: method === "equal" ? `1 de ${units.length} partes` : `Coeficiente ${unit.coefficient}% / total ${weightTotal}%`,
  }));
}
