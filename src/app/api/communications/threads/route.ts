import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { assertCommunicationFeatureEnabled } from "@/lib/communication-feature";
import { createCommunicationThread } from "@/lib/communications";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    await assertCommunicationFeatureEnabled(context);
    return noStoreJson(await createCommunicationThread(context, await request.json(), request.headers.get("user-agent")), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
