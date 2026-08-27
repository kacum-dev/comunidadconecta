import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { getDemoAdminSettings, updateDemoSettings } from "@/lib/demo";
import { demoSettingsInputSchema } from "@/lib/demo-input";

export async function GET() {
  try {
    return noStoreJson(await getDemoAdminSettings(await requireApiContext()));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const parsed = demoSettingsInputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, "Revisa la configuración del modo demo.", "validation_error");
    return noStoreJson(await updateDemoSettings(context, parsed.data, request.headers.get("user-agent")));
  } catch (error) {
    return handleApiError(error);
  }
}
