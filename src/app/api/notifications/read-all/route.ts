import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { markAllNotificationsRead } from "@/lib/operations";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    return noStoreJson(await markAllNotificationsRead(await requireApiContext()));
  } catch (error) {
    return handleApiError(error);
  }
}
