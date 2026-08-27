import type { NextRequest } from "next/server";
import { z } from "zod";
import { ApiError, handleApiError, requireApiContext } from "@/lib/api";
import { buildOwnerReport } from "@/lib/owner-report";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext();
    const parsed = z.uuid().safeParse(request.nextUrl.searchParams.get("unitId"));
    if (!parsed.success) throw new ApiError(400, "Selecciona una vivienda válida.", "validation_error");
    const report = await buildOwnerReport(context, parsed.data, request.headers.get("user-agent"));
    return new Response(new Uint8Array(report.buffer), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `attachment; filename="${report.filename}"; filename*=UTF-8''${encodeURIComponent(report.filename)}`,
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-Type-Options": "nosniff"
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
