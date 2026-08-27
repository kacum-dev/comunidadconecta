import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { acceptTransitionParty } from "@/lib/transition";

interface Context { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    return noStoreJson(await acceptTransitionParty(await requireApiContext(), id, request.headers.get("user-agent")));
  } catch (error) {
    return handleApiError(error);
  }
}
