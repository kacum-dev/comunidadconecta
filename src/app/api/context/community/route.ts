import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, assertSameOrigin, handleApiError, requireApiContext } from "@/lib/api";
import { COMMUNITY_COOKIE, ROLE_COOKIE } from "@/lib/auth";

const schema = z.object({ communityId: z.uuid() });

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, "La comunidad indicada no es válida.", "validation_error");
    if (!context.communities.some((item) => item.communityId === parsed.data.communityId)) {
      throw new ApiError(403, "No tienes acceso a esa comunidad.", "forbidden");
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(COMMUNITY_COOKIE, parsed.data.communityId, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.SESSION_COOKIE_SECURE === "true",
      path: "/",
      maxAge: 60 * 60 * 12
    });
    response.cookies.set(ROLE_COOKIE, "", { httpOnly: true, sameSite: "strict", path: "/", maxAge: 0 });
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
