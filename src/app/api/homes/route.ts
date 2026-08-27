import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { homeInputSchema } from "@/lib/home-input";
import { createHome, listHomeDirectory, listHomes, type HomeOccupancyFilter } from "@/lib/homes";
import { canManageHomes } from "@/lib/permissions";

export async function GET(request: NextRequest) {
  try {
    const context = await requireApiContext();
    if (canManageHomes(context.current.role)) {
      const params = request.nextUrl.searchParams;
      const occupancy = params.get("occupancy");
      return noStoreJson(await listHomeDirectory(context, {
        search: params.get("search") || undefined,
        siteName: params.get("siteName") || undefined,
        blockName: params.get("blockName") || undefined,
        staircase: params.get("staircase") || undefined,
        floor: params.get("floor") || undefined,
        unitType: params.get("unitType") || undefined,
        occupancy: (["rented","no_tenant","pending","no_owner"].includes(occupancy || "") ? occupancy : undefined) as HomeOccupancyFilter | undefined,
        page: Number(params.get("page") || 1),
        pageSize: Number(params.get("pageSize") || 25),
        sort: (params.get("sort") || "location") as "location" | "code" | "coefficient" | "updatedAt",
        direction: params.get("direction") === "desc" ? "desc" : "asc"
      }));
    }
    return noStoreJson({ homes: await listHomes(context) });
  } catch (error) { return handleApiError(error); }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const parsed = homeInputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message || "Revisa los datos del inmueble.", "validation_error");
    const home = await createHome(context, parsed.data, request.headers.get("user-agent"));
    return noStoreJson({ home }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
