import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { isModuleKey, moduleDefinitions } from "@/lib/modules";
import { archiveRecord, updateRecord } from "@/lib/records";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ module: string; id: string }>;
}

async function routeValues(routeContext: RouteContext) {
  const { module, id } = await routeContext.params;
  if (!isModuleKey(module)) throw new ApiError(404, "El módulo no existe.", "not_found");
  return { definition: moduleDefinitions[module], id };
}

export async function PATCH(request: NextRequest, routeContext: RouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const { definition, id } = await routeValues(routeContext);
    const body = await request.json();
    const row = await updateRecord(context, definition, id, body, request.headers.get("user-agent"));
    return noStoreJson({ row });
  } catch (error) {
    return handleApiError(error);
  }
}

export async function DELETE(request: NextRequest, routeContext: RouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const { definition, id } = await routeValues(routeContext);
    const body = await request.json().catch(() => ({})) as { version?: number };
    const row = await archiveRecord(context, definition, id, Number(body.version), request.headers.get("user-agent"));
    return noStoreJson({ row });
  } catch (error) {
    return handleApiError(error);
  }
}

