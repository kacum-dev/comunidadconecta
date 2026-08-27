import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { z } from "zod";
import { ApiError, assertSameOrigin, handleApiError } from "@/lib/api";
import { createSession } from "@/lib/auth";
import { query } from "@/lib/db";
import { verifyPassword, type PasswordParams } from "@/lib/password";

export const dynamic = "force-dynamic";

const loginSchema = z.object({
  email: z.email().max(254).transform((value) => value.trim().toLowerCase()),
  password: z.string().min(1).max(256)
});

const dummyParams: PasswordParams = { N: 32768, r: 8, p: 1, keyLength: 64 };

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const parsed = loginSchema.safeParse(await request.json());
    if (!parsed.success) throw new ApiError(400, "Revisa el correo y la contraseña.", "validation_error");

    const { email, password } = parsed.data;
    const emailHash = createHash("sha256").update(email).digest("hex");
    const recentFailures = await query<{ failures: number }>(
      `SELECT count(*)::int AS failures FROM auth_attempts
        WHERE email_hash = $1 AND succeeded = false AND attempted_at > now() - interval '15 minutes'`,
      [emailHash]
    );
    if (recentFailures.rows[0].failures >= 8) {
      throw new ApiError(429, "Demasiados intentos. Espera 15 minutos antes de volver a probar.", "rate_limited");
    }

    const userResult = await query<{
      id: string;
      password_hash: string;
      password_salt: string;
      password_params: PasswordParams;
    }>(
      `SELECT id, password_hash, password_salt, password_params
         FROM app_users WHERE email = $1 AND status = 'active' LIMIT 1`,
      [email]
    );

    const user = userResult.rows[0];
    const valid = user
      ? await verifyPassword(password, user.password_salt, user.password_hash, user.password_params)
      : await verifyPassword(password, "00000000000000000000000000000000", "00".repeat(64), dummyParams).then(() => false);

    await query("INSERT INTO auth_attempts (email_hash, succeeded) VALUES ($1, $2)", [emailHash, valid]);
    if (!valid || !user) throw new ApiError(401, "El correo o la contraseña no son correctos.", "invalid_credentials");

    const membership = await query<{ community_id: string }>(
      `SELECT community_id FROM memberships
        WHERE user_id = $1 AND status = 'active'
          AND valid_from <= now() AND (valid_to IS NULL OR valid_to > now())
        ORDER BY created_at LIMIT 1`,
      [user.id]
    );
    if (!membership.rowCount) throw new ApiError(403, "Tu cuenta no tiene acceso activo a ninguna comunidad.", "no_membership");

    await query("UPDATE app_users SET last_login_at = now() WHERE id = $1", [user.id]);
    const response = NextResponse.json({ ok: true });
    await createSession(user.id, request, response);
    response.cookies.set("cc_community", membership.rows[0].community_id, {
      httpOnly: true,
      sameSite: "strict",
      secure: process.env.SESSION_COOKIE_SECURE === "true",
      path: "/",
      maxAge: 60 * 60 * 12
    });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  } catch (error) {
    return handleApiError(error);
  }
}

