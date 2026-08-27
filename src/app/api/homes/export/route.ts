import type { NextRequest } from "next/server";
import { handleApiError, requireApiContext } from "@/lib/api";
import { homesDirectoryCsv, type HomeOccupancyFilter } from "@/lib/homes";

export const runtime = "nodejs";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext();
    const params = request.nextUrl.searchParams;
    const occupancy = params.get("occupancy");
    const csv = await homesDirectoryCsv(context, {
      search: params.get("search") || undefined,
      siteName: params.get("siteName") || undefined,
      blockName: params.get("blockName") || undefined,
      staircase: params.get("staircase") || undefined,
      floor: params.get("floor") || undefined,
      unitType: params.get("unitType") || undefined,
      occupancy: (["rented","no_tenant","pending","no_owner"].includes(occupancy || "") ? occupancy : undefined) as HomeOccupancyFilter | undefined,
      sort: (params.get("sort") || "location") as "location" | "code" | "coefficient" | "updatedAt",
      direction: params.get("direction") === "desc" ? "desc" : "asc"
    });
    return new Response(csv, { headers: { "Content-Type": "text/csv; charset=utf-8", "Content-Disposition": `attachment; filename="viviendas-${new Date().toISOString().slice(0,10)}.csv"`, "Cache-Control": "private, no-store" } });
  } catch (error) { return handleApiError(error); }
}
