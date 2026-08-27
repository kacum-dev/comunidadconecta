import type { NextRequest } from "next/server";
import { handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { getReservationDashboard } from "@/lib/reservations";
export async function GET(request: NextRequest) {
  try {
    return noStoreJson(await getReservationDashboard(await requireApiContext(), request.nextUrl.searchParams.get("from") || undefined, request.nextUrl.searchParams.get("to") || undefined));
  } catch (error) { return handleApiError(error); }
}
