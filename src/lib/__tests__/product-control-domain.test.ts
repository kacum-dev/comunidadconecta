import { describe, expect, it } from "vitest";
import { aggregateRange, safeAppVersion } from "../product-control-domain";

describe("product control privacy domain", () => {
  it("only exposes coarse aggregate ranges", () => {
    expect(aggregateRange(0)).toBe("0");
    expect(aggregateRange(7)).toBe("1-10");
    expect(aggregateRange(37)).toBe("26-50");
    expect(aggregateRange(730)).toBe("500+");
  });

  it("does not propagate arbitrary version text", () => {
    expect(safeAppVersion("1.2.3")).toBe("1.2.3");
    expect(safeAppVersion("secret or hostname")).toBe("1.0.0");
  });
});
