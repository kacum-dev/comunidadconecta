import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { confirmMeetingMilestone } from "@/lib/governance";

interface Context { params: Promise<{ id: string; key: string }> }

export async function PUT(request: NextRequest, routeContext: Context) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const { id, key } = await routeContext.params;
    const body = await request.json();
    return noStoreJson(await confirmMeetingMilestone(context, id, key, body, request.headers.get("user-agent")));
  } catch (error) {
    return handleApiError(error);
  }
}
