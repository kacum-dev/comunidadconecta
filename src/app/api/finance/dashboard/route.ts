import { handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { getFinanceDashboard } from "@/lib/finance";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const context = await requireApiContext();
    return noStoreJson(await getFinanceDashboard(context));
  } catch (error) {
    return handleApiError(error);
  }
}
