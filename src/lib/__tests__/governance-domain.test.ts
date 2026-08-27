import { describe, expect, it } from "vitest";
import { calculateVoteResult, quorum } from "../governance-domain";

describe("governance calculations",()=>{
  it("requires majority in units and coefficients",()=>{
    expect(calculateVoteResult([
      {choice:"yes",coefficient:30},{choice:"yes",coefficient:5},{choice:"no",coefficient:25}
    ],"simple_majority").status).toBe("approved");
    expect(calculateVoteResult([
      {choice:"yes",coefficient:20},{choice:"yes",coefficient:5},{choice:"no",coefficient:30}
    ],"simple_majority").status).toBe("rejected");
  });
  it("detects tied simple-majority votes",()=>{
    expect(calculateVoteResult([
      {choice:"yes",coefficient:25},{choice:"no",coefficient:25}
    ],"simple_majority").status).toBe("tied");
  });
  it("applies the qualified threshold to both dimensions",()=>{
    expect(calculateVoteResult([
      {choice:"yes",coefficient:60},{choice:"yes",coefficient:10},{choice:"yes",coefficient:5},{choice:"no",coefficient:25}
    ],"qualified_majority",66.67).status).toBe("approved");
  });
  it("requires no opposing vote for unanimity",()=>{
    expect(calculateVoteResult([{choice:"yes",coefficient:40},{choice:"abstain",coefficient:10}],"unanimity").status).toBe("approved");
    expect(calculateVoteResult([{choice:"yes",coefficient:40},{choice:"no",coefficient:1}],"unanimity").status).toBe("rejected");
  });
  it("calculates represented quorum from immutable snapshots",()=>{
    expect(quorum([{attendanceType:"present",coefficient:20},{attendanceType:"represented",coefficient:15},{attendanceType:"absent",coefficient:10}])).toEqual({units:2,coefficient:35});
  });
});
