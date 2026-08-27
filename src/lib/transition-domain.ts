export const transitionOrder = ["initiated", "inventory", "delivery", "revocation", "onboarding", "reconciliation", "closed"] as const;

export function nextTransitionStatus(value: string) {
  const index = transitionOrder.indexOf(value as typeof transitionOrder[number]);
  return index < 0 || index === transitionOrder.length - 1 ? null : transitionOrder[index + 1];
}

const itemTransitions: Record<string, readonly string[]> = {
  pending: ["delivered", "reserved"],
  delivered: ["accepted", "reserved"],
  reserved: ["delivered"],
  accepted: [],
};

export function canTransitionItem(from: string, to: string) {
  return itemTransitions[from]?.includes(to) ?? false;
}

export function canCloseTransition(items: Array<{ status: string }>, parties: Array<{ partyType: string; status: string }>) {
  return items.length > 0 && items.every((item) => item.status === "accepted") &&
    ["incoming", "community"].every((type) => parties.some((party) => party.partyType === type && party.status === "accepted"));
}
