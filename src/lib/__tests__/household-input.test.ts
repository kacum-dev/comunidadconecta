import { describe, expect, it } from "vitest";
import { householdMemberInputSchema, householdMemberUpdateSchema } from "../household-input";

describe("household member input", () => {
  it("keeps family private unless the user explicitly shares it", () => {
    const parsed = householdMemberInputSchema.parse({
      unitId: "0b73cb71-fde6-4cf6-a313-9b39627fe30c",
      fullName: "  Mar\u00eda S\u00e1nchez  ",
      relationshipType: "partner"
    });

    expect(parsed.fullName).toBe("Mar\u00eda S\u00e1nchez");
    expect(parsed.sharedWithCommunity).toBe(false);
  });

  it("requires optimistic concurrency when family visibility changes", () => {
    expect(householdMemberUpdateSchema.safeParse({ sharedWithCommunity: true }).success).toBe(false);
    expect(householdMemberUpdateSchema.safeParse({ sharedWithCommunity: true, version: 2 }).success).toBe(true);
  });
});
