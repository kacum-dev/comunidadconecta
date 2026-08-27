import type { NextRequest } from "next/server";
import { handleApiError, noStoreJson } from "@/lib/api";
import { assertExternalCommunicationFeatureEnabled } from "@/lib/communication-feature";
import { ingestInboundEmail } from "@/lib/communications";

export async function POST(request: NextRequest) {
  try {
    const secret = request.headers.get("x-cc-ingest-secret") ?? "";
    const input = await request.json() as { communitySlug?: unknown };
    await assertExternalCommunicationFeatureEnabled(input.communitySlug, secret);
    return noStoreJson(await ingestInboundEmail(input, secret), { status: 202 });
  } catch (error) {
    return handleApiError(error);
  }
}
