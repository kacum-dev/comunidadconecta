import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { updateMeetingLegalProfile } from "@/lib/governance";

interface Context { params: Promise<{ id: string }> }

export async function PATCH(request: NextRequest, routeContext: Context) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const { id } = await routeContext.params;
    const body = await request.json();
    return noStoreJson(await updateMeetingLegalProfile(context, id, body, request.headers.get("user-agent")));
  } catch (error) {
    return handleApiError(error);
  }
}
