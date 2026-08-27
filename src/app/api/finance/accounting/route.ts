import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { executeAccountingCommand, exportAccountingCsv, getAccountingDashboard } from "@/lib/accounting";

export const dynamic = "force-dynamic";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext();
    const periodId = request.nextUrl.searchParams.get("periodId");
    if (request.nextUrl.searchParams.get("format") === "csv") {
      const csv = await exportAccountingCsv(context, periodId);
      return new Response(csv, {
        headers: {
          "Content-Type": "text/csv; charset=utf-8",
          "Content-Disposition": `attachment; filename="balance-sumas-saldos-${periodId ?? "actual"}.csv"`,
          "Cache-Control": "no-store, max-age=0",
        },
      });
    }
    return noStoreJson(await getAccountingDashboard(context, periodId));
  }
  catch (error) { return handleApiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    return noStoreJson(await executeAccountingCommand(context, await request.json()));
  } catch (error) { return handleApiError(error); }
}
