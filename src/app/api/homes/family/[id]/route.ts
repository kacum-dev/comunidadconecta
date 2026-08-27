import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { removeHouseholdMember, updateHouseholdMember } from "@/lib/household";
import { householdMemberUpdateSchema } from "@/lib/household-input";

export async function PATCH(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiContext();
    const parsed = householdMemberUpdateSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, "Revisa los cambios del familiar.", "validation_error");
    const { id } = await context.params;
    const member = await updateHouseholdMember(auth, id, parsed.data, request.headers.get("user-agent"));
    return noStoreJson({ member });
  } catch (error) {
    return handleApiError(error);
  }
}

const removeSchema = z.object({ version: z.number().int().positive() });

export async function DELETE(request: NextRequest, context: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const auth = await requireApiContext();
    const parsed = removeSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, "No se ha podido identificar la versi\u00f3n del familiar.", "validation_error");
    const { id } = await context.params;
    const member = await removeHouseholdMember(auth, id, parsed.data.version, request.headers.get("user-agent"));
    return noStoreJson({ member });
  } catch (error) {
    return handleApiError(error);
  }
}
