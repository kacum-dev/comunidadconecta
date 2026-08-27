import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { archiveIntegration, updateIntegration } from "@/lib/settings";
import { integrationInputSchema } from "@/lib/settings-input";

export async function PATCH(request: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const { id } = await routeContext.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Identificador no válido.", "validation_error");
    const parsed = integrationInputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message || "Revisa la conexión.", "validation_error");
    return noStoreJson({ integration: await updateIntegration(context, id, parsed.data, request.headers.get("user-agent")) });
  } catch (error) { return handleApiError(error); }
}

export async function DELETE(request: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const { id } = await routeContext.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Identificador no válido.", "validation_error");
    return noStoreJson({ integration: await archiveIntegration(context, id, request.headers.get("user-agent")) });
  } catch (error) { return handleApiError(error); }
}
