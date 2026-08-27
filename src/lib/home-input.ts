import { z } from "zod";

const optionalDecimal = (minimum: number, maximum: number) => z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.coerce.number().min(minimum).max(maximum).nullable()
);

const optionalInteger = z.preprocess(
  (value) => value === "" || value === undefined ? null : value,
  z.coerce.number().int().min(0).max(99).nullable()
);

export const homeInputSchema = z.object({
  code: z.string().trim().min(1).max(80),
  unitType: z.enum(["home", "commercial", "office", "garage", "storage", "other"]),
  siteName: z.string().trim().max(120).optional().nullable(),
  blockName: z.string().trim().max(120).optional().nullable(),
  staircase: z.string().trim().max(120).optional().nullable(),
  floor: z.string().trim().max(40).optional().nullable(),
  door: z.string().trim().max(40).optional().nullable(),
  cadastralReference: z.string().trim().max(80).optional().nullable(),
  builtAreaM2: optionalDecimal(0.01, 1_000_000),
  usableAreaM2: optionalDecimal(0.01, 1_000_000),
  bedrooms: optionalInteger,
  bathrooms: optionalInteger,
  participationCoefficient: z.coerce.number().min(0).max(100),
  quotaMethod: z.enum(["fixed_amount", "participation_coefficient"]),
  fixedQuotaAmount: optionalDecimal(0, 999_999_999),
  quotaFrequency: z.enum(["monthly", "quarterly", "semiannual", "annual"])
}).superRefine((value, context) => {
  if (value.builtAreaM2 !== null && value.usableAreaM2 !== null && value.usableAreaM2 > value.builtAreaM2) {
    context.addIssue({
      code: "custom",
      path: ["usableAreaM2"],
      message: "La superficie útil no puede superar la construida."
    });
  }
  if (value.quotaMethod === "fixed_amount" && value.fixedQuotaAmount === null) {
    context.addIssue({
      code: "custom",
      path: ["fixedQuotaAmount"],
      message: "Indica el importe fijo de la cuota."
    });
  }
});

export type HomeWriteInput = z.infer<typeof homeInputSchema>;
