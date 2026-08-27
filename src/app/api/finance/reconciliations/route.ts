import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { reconcileTransaction } from "@/lib/finance";

export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const body = await request.json();
    return noStoreJson(await reconcileTransaction(context, body, request.headers.get("user-agent")), { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
