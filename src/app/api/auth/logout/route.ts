import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { assertSameOrigin, handleApiError, requireApiContext } from "@/lib/api";
import { clearSessionCookies } from "@/lib/auth";
import { query } from "@/lib/db";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    await query(
      "UPDATE user_sessions SET revoked_at = now(), revoke_reason = 'logout' WHERE id = $1 AND revoked_at IS NULL",
      [context.sessionId]
    );
    const response = NextResponse.json({ ok: true });
    clearSessionCookies(response);
    return response;
  } catch (error) {
    const response = handleApiError(error);
    if (response.status === 401) clearSessionCookies(response);
    return response;
  }
}

