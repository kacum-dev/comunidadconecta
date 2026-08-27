export type VoteChoice = "yes" | "no" | "abstain";
export type VotingRule = "simple_majority" | "qualified_majority" | "unanimity";

export interface WeightedVote { choice: VoteChoice; coefficient: number }

export function calculateVoteResult(votes: WeightedVote[], rule: VotingRule, threshold = 60) {
  const totals = votes.reduce((result, vote) => {
    if (!Number.isFinite(vote.coefficient) || vote.coefficient < 0) throw new Error("Coeficiente no válido.");
    result[vote.choice].units += 1;
    result[vote.choice].coefficient += vote.coefficient;
    return result;
  }, {
    yes: { units: 0, coefficient: 0 },
    no: { units: 0, coefficient: 0 },
    abstain: { units: 0, coefficient: 0 }
  });
  const decisiveUnits = totals.yes.units + totals.no.units;
  const decisiveCoefficient = totals.yes.coefficient + totals.no.coefficient;
  let approved = false;
  if (rule === "simple_majority") {
    approved = totals.yes.units > totals.no.units && totals.yes.coefficient > totals.no.coefficient;
  } else if (rule === "qualified_majority") {
    const unitPercent = decisiveUnits ? totals.yes.units / decisiveUnits * 100 : 0;
    const coefficientPercent = decisiveCoefficient ? totals.yes.coefficient / decisiveCoefficient * 100 : 0;
    approved = unitPercent >= threshold && coefficientPercent >= threshold;
  } else {
    approved = decisiveUnits > 0 && totals.no.units === 0 && totals.yes.units === decisiveUnits;
  }
  const tied = rule === "simple_majority" && decisiveUnits > 0 &&
    (totals.yes.units === totals.no.units || totals.yes.coefficient === totals.no.coefficient);
  return {
    totals,
    decisiveUnits,
    decisiveCoefficient,
    status: tied ? "tied" as const : approved ? "approved" as const : "rejected" as const
  };
}

export function quorum(attendance: Array<{ attendanceType: string; coefficient: number }>) {
  const represented = attendance.filter(item => item.attendanceType !== "absent");
  return {
    units: represented.length,
    coefficient: represented.reduce((sum,item)=>sum+item.coefficient,0)
  };
}
