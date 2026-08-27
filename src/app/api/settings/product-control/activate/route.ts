import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { activateCommercialLicense } from "@/lib/product-control";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const body = await request.json() as { licenseKey?: unknown };
    const licenseKey = String(body.licenseKey ?? "").trim();
    if (licenseKey.length < 20 || licenseKey.length > 180) {
      return noStoreJson({ error: "Introduce una clave comercial válida.", code: "validation_error" }, { status: 400 });
    }
    return noStoreJson(await activateCommercialLicense(
      await requireApiContext(),
      licenseKey,
      request.headers.get("user-agent")
    ));
  } catch (error) {
    return handleApiError(error);
  }
}
