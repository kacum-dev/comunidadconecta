import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { cancelBooking } from "@/lib/reservations";
interface Context { params: Promise<{ id: string }> }
export async function POST(request: NextRequest, context: Context) {
  try {
    assertSameOrigin(request);
    const { id } = await context.params;
    return noStoreJson(await cancelBooking(await requireApiContext(), id, request.headers.get("user-agent")));
  } catch (error) { return handleApiError(error); }
}
