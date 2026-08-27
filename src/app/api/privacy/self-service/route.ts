import type { NextRequest } from "next/server";
import { assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { createResidentPrivacyRequest, getResidentPrivacy } from "@/lib/resident-privacy";

export const dynamic = "force-dynamic";

export async function GET() {
  try {
    return noStoreJson(await getResidentPrivacy(await requireApiContext()));
  } catch (error) {
    return handleApiError(error);
  }
}

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    return noStoreJson(
      await createResidentPrivacyRequest(context, await request.json(), request.headers.get("user-agent")),
      { status: 201 }
    );
  } catch (error) {
    return handleApiError(error);
  }
}
