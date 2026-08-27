import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { createIntegration } from "@/lib/settings";
import { integrationInputSchema } from "@/lib/settings-input";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const parsed = integrationInputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message || "Revisa la conexión.", "validation_error");
    return noStoreJson({ integration: await createIntegration(context, parsed.data, request.headers.get("user-agent")) }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
