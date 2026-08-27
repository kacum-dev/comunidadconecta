import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, assertSameOrigin, handleApiError, requireApiContext } from "@/lib/api";
import { ROLE_COOKIE } from "@/lib/auth";

const schema = z.object({
  role: z.enum([
    "owner", "resident", "president", "vice_president", "secretary", "treasurer",
    "administrator", "supplier", "auditor", "support", "platform_admin"
  ])
});

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, "El perfil seleccionado no es válido.", "validation_error");
    if (!context.current.roles.includes(parsed.data.role)) {
      throw new ApiError(403, "No tienes asignado ese perfil en esta comunidad.", "forbidden");
    }
    const response = NextResponse.json({ ok: true });
    response.cookies.set(ROLE_COOKIE, parsed.data.role, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.SESSION_COOKIE_SECURE === "true",
      path: "/",
      maxAge: 60 * 60 * 12
    });
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}
