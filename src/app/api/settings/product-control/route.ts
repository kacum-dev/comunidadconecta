import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { getProductControlState, updateProductControl } from "@/lib/product-control";
import type { ProductUsageType, TelemetryLevel } from "@/lib/product-control-domain";

const usageTypes = new Set<ProductUsageType>(["community", "nonprofit", "demo", "development", "commercial"]);
const telemetryLevels = new Set<TelemetryLevel>(["disabled", "basic", "product"]);

export async function GET() {
  try {
    await requireApiContext();
    return noStoreJson(await getProductControlState());
  } catch (error) {
    return handleApiError(error);
  }
}

export async function PATCH(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const body = await request.json() as { usageType?: ProductUsageType; telemetryLevel?: TelemetryLevel };
    if (!body.usageType || !usageTypes.has(body.usageType) || !body.telemetryLevel || !telemetryLevels.has(body.telemetryLevel)) {
      return noStoreJson({ error: "Configuración de licencia o telemetría no válida.", code: "validation_error" }, { status: 400 });
    }
    return noStoreJson(await updateProductControl(context, {
      usageType: body.usageType,
      telemetryLevel: body.telemetryLevel
    }, request.headers.get("user-agent")));
  } catch (error) {
    return handleApiError(error);
  }
}
