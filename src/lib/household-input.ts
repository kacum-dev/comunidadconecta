import { z } from "zod";

export const householdRelationshipTypes = [
  "partner",
  "child",
  "parent",
  "sibling",
  "other_relative",
  "dependent",
  "other"
] as const;

export const householdMemberInputSchema = z.object({
  unitId: z.uuid(),
  fullName: z.string().trim().min(2).max(180),
  relationshipType: z.enum(householdRelationshipTypes),
  sharedWithCommunity: z.boolean().default(false)
});

export const householdMemberUpdateSchema = z.object({
  fullName: z.string().trim().min(2).max(180).optional(),
  relationshipType: z.enum(householdRelationshipTypes).optional(),
  sharedWithCommunity: z.boolean().optional(),
  version: z.number().int().positive()
}).refine(
  (value) => value.fullName !== undefined || value.relationshipType !== undefined || value.sharedWithCommunity !== undefined,
  { message: "Indica al menos un cambio." }
);

export type HouseholdMemberInput = z.infer<typeof householdMemberInputSchema>;
export type HouseholdMemberUpdate = z.infer<typeof householdMemberUpdateSchema>;
