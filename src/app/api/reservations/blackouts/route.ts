import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { createBlackout } from "@/lib/reservations";
export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    return noStoreJson(await createBlackout(await requireApiContext(), await request.json(), request.headers.get("user-agent")), { status: 201 });
  } catch (error) { return handleApiError(error); }
}
