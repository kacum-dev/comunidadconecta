import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { saveManualBankConnection } from "@/lib/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const body = await request.json();
    const bankName = String(body.bankName ?? "").trim();
    const accountReference = String(body.accountReference ?? "").trim();
    if (bankName.length < 2 || bankName.length > 120 || accountReference.length > 160) {
      throw new ApiError(400, "Revisa el nombre del banco y la referencia de la cuenta.", "validation_error");
    }
    const connection = await saveManualBankConnection(context, { bankName, accountReference }, request.headers.get("user-agent"));
    return noStoreJson({ connection }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
