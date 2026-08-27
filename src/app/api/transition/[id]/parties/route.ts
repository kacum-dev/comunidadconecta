import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { upsertTransitionParty } from "@/lib/transition";

interface Context { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    return noStoreJson(await upsertTransitionParty(await requireApiContext(), id, await request.json(), request.headers.get("user-agent")), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
