import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { getCommunicationFeature, updateCommunicationFeature } from "@/lib/communication-feature";

export async function GET() {
  try {
    return noStoreJson(await getCommunicationFeature(await requireApiContext()));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const input = await request.json() as { enabled?: unknown };
    if (typeof input.enabled !== "boolean") {
      return noStoreJson({ error: "Indica si el módulo debe estar activo.", code: "validation_error" }, { status: 400 });
    }
    return noStoreJson(await updateCommunicationFeature(
      await requireApiContext(),
      input.enabled,
      request.headers.get("user-agent")
    ));
  } catch (error) {
    return handleApiError(error);
  }
}
