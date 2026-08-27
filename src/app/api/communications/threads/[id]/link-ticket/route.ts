import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { assertCommunicationFeatureEnabled } from "@/lib/communication-feature";
import { linkCommunicationToTicket } from "@/lib/communications";

interface Context { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request);
    const authContext = await requireApiContext();
    await assertCommunicationFeatureEnabled(authContext);
    const { id } = await context.params;
    return noStoreJson(await linkCommunicationToTicket(authContext, id, await request.json(), request.headers.get("user-agent")));
  } catch (error) {
    return handleApiError(error);
  }
}
