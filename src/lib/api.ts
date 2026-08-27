import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { getAuthContext, type AuthContext } from "./auth";

export class ApiError extends Error {
  constructor(
    public status: number,
    message: string,
    public code = "request_error"
  ) {
    super(message);
  }
}

export async function requireApiContext(): Promise<AuthContext> {
  const context = await getAuthContext();
  if (!context) throw new ApiError(401, "Tu sesión no es válida o ha caducado.", "unauthorized");
  return context;
}

export function assertSameOrigin(request: NextRequest) {
  const origin = request.headers.get("origin");
  const fetchSite = request.headers.get("sec-fetch-site");

  if (!origin) {
    if (fetchSite && fetchSite !== "same-origin" && fetchSite !== "none") {
      throw new ApiError(403, "La solicitud no procede de este sitio.", "origin_mismatch");
    }
    return;
  }

  const requestUrl = new URL(request.url);
  const forwardedHost = request.headers.get("x-forwarded-host")?.split(",")[0].trim();
  const expectedHost = forwardedHost || request.headers.get("host") || requestUrl.host;
  try {
    if (new URL(origin).host !== expectedHost) {
      throw new ApiError(403, "La solicitud no procede de este sitio.", "origin_mismatch");
    }
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError(403, "El origen de la solicitud no es válido.", "origin_mismatch");
  }
}

export function handleApiError(error: unknown) {
  if (error instanceof ApiError) {
    return NextResponse.json({ error: error.message, code: error.code }, { status: error.status });
  }

  const databaseError = error as { code?: string };
  if (databaseError?.code === "23505") {
    return NextResponse.json({ error: "Ya existe un registro con esa referencia.", code: "duplicate" }, { status: 409 });
  }
  if (databaseError?.code === "23503") {
    return NextResponse.json({ error: "El registro está relacionado con otros datos y no puede modificarse así.", code: "related_record" }, { status: 409 });
  }

  console.error(error);
  return NextResponse.json({ error: "No se ha podido completar la operación.", code: "internal_error" }, { status: 500 });
}

export function noStoreJson(body: unknown, init?: ResponseInit) {
  const response = NextResponse.json(body, init);
  response.headers.set("Cache-Control", "no-store, max-age=0");
  return response;
}

