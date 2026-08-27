import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { homeInputSchema } from "@/lib/home-input";
import { updateHome } from "@/lib/homes";

export async function PATCH(request: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const { id } = await routeContext.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Identificador no válido.", "validation_error");
    const parsed = homeInputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message || "Revisa los datos del inmueble.", "validation_error");
    return noStoreJson({ home: await updateHome(context, id, parsed.data, request.headers.get("user-agent")) });
  } catch (error) { return handleApiError(error); }
}
