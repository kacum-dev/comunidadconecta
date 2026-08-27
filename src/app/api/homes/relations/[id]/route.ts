import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { reviewHomeRelation } from "@/lib/homes";

const schema = z.object({ status: z.enum(["active", "rejected", "ended"]) });

export async function PATCH(request: NextRequest, routeContext: { params: Promise<{ id: string }> }) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const { id } = await routeContext.params;
    if (!z.uuid().safeParse(id).success) throw new ApiError(400, "Identificador no válido.", "validation_error");
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, "Acción no válida.", "validation_error");
    const relation = await reviewHomeRelation(context, id, parsed.data.status, request.headers.get("user-agent"));
    return noStoreJson({ relation });
  } catch (error) { return handleApiError(error); }
}
