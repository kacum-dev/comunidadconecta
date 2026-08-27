import type { NextRequest } from "next/server";
import { ApiError, handleApiError, requireApiContext } from "@/lib/api";
import { isModuleKey, moduleDefinitions } from "@/lib/modules";
import { allRecordsForExport, recordsToCsv } from "@/lib/records";

export const dynamic = "force-dynamic";

interface RouteContext {
  params: Promise<{ module: string }>;
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireApiContext();
    const { module } = await routeContext.params;
    if (!isModuleKey(module)) throw new ApiError(404, "El módulo no existe.", "not_found");
    const definition = moduleDefinitions[module];
    const rows = await allRecordsForExport(
      context,
      definition,
      request.nextUrl.searchParams.get("search") || undefined,
      request.nextUrl.searchParams.get("status") || undefined
    );
    const csv = recordsToCsv(definition, rows, {
      locale: context.current.locale,
      timeZone: context.current.timeZone,
      dateFormat: context.current.dateFormat,
      timeFormat: context.current.timeFormat
    });
    return new Response(csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${module}-${new Date().toISOString().slice(0, 10)}.csv"`,
        "Cache-Control": "no-store, max-age=0"
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
