import type { NextRequest } from "next/server";
import { z } from "zod";
import { revokeAccess } from "@/lib/access";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";

export async function DELETE(request: NextRequest, routeContext: { params: Promise<{ id: string }> }) { try { assertSameOrigin(request); const context = await requireApiContext(); const { id } = await routeContext.params; if (!z.uuid().safeParse(id).success) throw new ApiError(400,"Identificador no válido.","validation_error"); return noStoreJson({ access: await revokeAccess(context,id) }); } catch (error) { return handleApiError(error); } }
