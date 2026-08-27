import { describe, expect, it } from "vitest";
import { homeInputSchema } from "../home-input";

const baseHome = {
  code: "1º A",
  unitType: "home",
  participationCoefficient: 3.25,
  quotaMethod: "participation_coefficient",
  quotaFrequency: "monthly"
};

describe("home input", () => {
  it("keeps surface data and coefficient-based quotas as separate concepts", () => {
    const parsed = homeInputSchema.parse({
      ...baseHome,
      builtAreaM2: "112.40",
      usableAreaM2: "94.20",
      bedrooms: "3",
      bathrooms: "2"
    });

    expect(parsed).toMatchObject({
      builtAreaM2: 112.4,
      usableAreaM2: 94.2,
      bedrooms: 3,
      bathrooms: 2,
      participationCoefficient: 3.25,
      quotaMethod: "participation_coefficient"
    });
    expect(parsed.fixedQuotaAmount).toBeNull();
  });

  it("requires an amount when the ordinary quota is fixed", () => {
    const missingAmount = homeInputSchema.safeParse({ ...baseHome, quotaMethod: "fixed_amount" });
    expect(missingAmount.success).toBe(false);

    const parsed = homeInputSchema.parse({
      ...baseHome,
      quotaMethod: "fixed_amount",
      fixedQuotaAmount: "86.50",
      quotaFrequency: "quarterly"
    });
    expect(parsed.fixedQuotaAmount).toBe(86.5);
  });

  it("rejects a useful area greater than the built area", () => {
    const parsed = homeInputSchema.safeParse({ ...baseHome, builtAreaM2: 80, usableAreaM2: 90 });
    expect(parsed.success).toBe(false);
  });
});
