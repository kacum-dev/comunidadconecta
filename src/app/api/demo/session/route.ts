import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { ApiError, assertSameOrigin, handleApiError } from "@/lib/api";
import { startDemoSession } from "@/lib/demo";
import { demoSessionInputSchema } from "@/lib/demo-input";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const parsed = demoSessionInputSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, "Selecciona un perfil demo válido.", "validation_error");
    const response = NextResponse.json({ ok: true });
    const session = await startDemoSession(parsed.data.role, parsed.data.accessCode, request, response);
    response.headers.set("Cache-Control", "no-store, max-age=0");
    response.headers.set("X-Demo-Expires-At", session.expiresAt);
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
