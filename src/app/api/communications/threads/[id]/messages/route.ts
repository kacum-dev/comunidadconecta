import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { assertCommunicationFeatureEnabled } from "@/lib/communication-feature";
import { addCommunicationMessage } from "@/lib/communications";

interface Context { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request);
    const authContext = await requireApiContext();
    await assertCommunicationFeatureEnabled(authContext);
    const { id } = await context.params;
    return noStoreJson(await addCommunicationMessage(authContext, id, await request.json(), request.headers.get("user-agent")), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
