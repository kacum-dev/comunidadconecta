import { handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { getCommunityWeather } from "@/lib/weather";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return noStoreJson(await getCommunityWeather(await requireApiContext()));
  } catch (error) {
    return handleApiError(error);
  }
}
