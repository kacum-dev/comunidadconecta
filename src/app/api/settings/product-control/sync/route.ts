import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { canManageSettings } from "@/lib/permissions";
import { syncProductControl } from "@/lib/product-control";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const body = await request.json().catch(() => ({})) as { force?: boolean };
    const force = body.force === true;
    if (force && (context.isDemo || !canManageSettings(context.current.role))) {
      throw new ApiError(403, "Solo la administración puede forzar una sincronización.", "forbidden");
    }
    return noStoreJson(await syncProductControl(force));
  } catch (error) {
    return handleApiError(error);
  }
}
