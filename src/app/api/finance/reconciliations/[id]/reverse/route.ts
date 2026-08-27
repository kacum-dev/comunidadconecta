import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { reverseReconciliation } from "@/lib/finance";

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const { id } = await routeContext.params;
    return noStoreJson(await reverseReconciliation(context, id, request.headers.get("user-agent")));
  } catch (error) {
    return handleApiError(error);
  }
}
