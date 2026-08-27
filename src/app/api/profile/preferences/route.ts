import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { updateSimpleMode } from "@/lib/resident-privacy";

const preferencesSchema = z.object({ simpleMode: z.boolean() }).strict();

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const parsed = preferencesSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, "La preferencia no es válida.", "validation_error");
    const context = await requireApiContext();
    return noStoreJson(await updateSimpleMode(context, parsed.data.simpleMode, request.headers.get("user-agent")));
  } catch (error) {
    return handleApiError(error);
  }
}
