import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { getSettings, updateSettings } from "@/lib/settings";
import { settingsUpdateSchema } from "@/lib/settings-input";

export async function GET() {
  try {
    return noStoreJson(await getSettings(await requireApiContext()));
  } catch (error) { return handleApiError(error); }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const parsed = settingsUpdateSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, parsed.error.issues[0]?.message || "Revisa la configuración.", "validation_error");
    return noStoreJson(await updateSettings(context, parsed.data, request.headers.get("user-agent")));
  } catch (error) { return handleApiError(error); }
}
