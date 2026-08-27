import { handleApiError, noStoreJson } from "@/lib/api";
import { getPublicDemoConfig } from "@/lib/demo";

export async function GET() {
  try {
    return noStoreJson({ demo: await getPublicDemoConfig() });
  } catch (error) {
    return handleApiError(error);
  }
}
