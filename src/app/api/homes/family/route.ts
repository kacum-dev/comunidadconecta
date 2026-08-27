import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { createHouseholdMember } from "@/lib/household";
import { householdMemberInputSchema } from "@/lib/household-input";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const parsed = householdMemberInputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, "Revisa los datos del familiar.", "validation_error");
    const member = await createHouseholdMember(context, parsed.data, request.headers.get("user-agent"));
    return noStoreJson({ member }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
