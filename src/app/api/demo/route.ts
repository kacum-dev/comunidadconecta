import { handleApiError, noStoreJson } from "@/lib/api";
import { getPublicDemoConfig } from "@/lib/demo";
import { isDemoInstance } from "@/lib/instance-mode";

export async function GET() {
  try {
    if (!isDemoInstance()) return noStoreJson({ demo: null });
    return noStoreJson({ demo: await getPublicDemoConfig() });
  } catch (error) {
    return handleApiError(error);
  }
}
