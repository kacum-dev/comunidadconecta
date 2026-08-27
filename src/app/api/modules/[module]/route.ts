import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, ApiError, requireApiContext } from "@/lib/api";
import { isModuleKey, moduleDefinitions } from "@/lib/modules";
import { createRecord, listRecords } from "@/lib/records";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ module: string }>;
}

async function definitionFrom(context: RouteContext) {
  const { module } = await context.params;
  if (!isModuleKey(module)) throw new ApiError(404, "El módulo no existe.", "not_found");
  return moduleDefinitions[module];
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireApiContext();
    const definition = await definitionFrom(routeContext);
    const params = request.nextUrl.searchParams;
    const result = await listRecords(context, definition, {
      search: params.get("search") || undefined,
      status: params.get("status") || undefined,
      page: Number(params.get("page") || 1),
      pageSize: Number(params.get("pageSize") || 25),
      sort: (params.get("sort") || "updatedAt") as "title" | "status" | "updatedAt" | "eventDate" | "amount",
      direction: params.get("direction") === "asc" ? "asc" : "desc"
    });
    return noStoreJson(result);
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const definition = await definitionFrom(routeContext);
    const body = await request.json();
    const row = await createRecord(context, definition, body, request.headers.get("user-agent"));
    return noStoreJson({ row }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

