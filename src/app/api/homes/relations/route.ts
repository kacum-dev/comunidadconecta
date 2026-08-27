import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { addHomeRelation } from "@/lib/homes";

const relationSchema = z.object({
  unitId: z.uuid(),
  fullName: z.string().trim().min(2).max(180),
  email: z.union([z.email().max(254), z.literal("")]).optional().transform((value) => value || null),
  relationType: z.enum(["owner", "co_owner", "tenant", "authorized_resident"]),
  ownershipPercentage: z.coerce.number().positive().max(100).optional().nullable(),
  isPrimary: z.boolean().optional(),
  canVote: z.boolean().optional(),
  validFrom: z.iso.date(),
  notes: z.string().trim().max(1000).optional().nullable()
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const parsed = relationSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, "Revisa los datos de la persona.", "validation_error");
    const relation = await addHomeRelation(context, parsed.data, request.headers.get("user-agent"));
    return noStoreJson({ relation }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
