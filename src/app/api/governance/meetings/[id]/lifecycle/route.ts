import type { NextRequest } from "next/server";
import { handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { getMeetingLifecycle } from "@/lib/governance";

export const dynamic = "force-dynamic";

interface Context { params: Promise<{ id: string }> }

export async function GET(_request: NextRequest, routeContext: Context) {
  try {
    const context = await requireApiContext();
    const { id } = await routeContext.params;
    return noStoreJson(await getMeetingLifecycle(context, id));
  } catch (error) {
    return handleApiError(error);
  }
}
