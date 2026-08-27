import { NextResponse } from "next/server";
import { query } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const startedAt = performance.now();
  try {
    await query("SELECT 1");
    const response = NextResponse.json({
      ok: true,
      service: "comunidad-conecta",
      database: "ok",
      responseTimeMs: Math.round(performance.now() - startedAt)
    });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  } catch (error) {
    console.error("Healthcheck de PostgreSQL fallido:", error instanceof Error ? error.message : "error desconocido");
    const response = NextResponse.json({
      ok: false,
      service: "comunidad-conecta",
      database: "unavailable"
    }, { status: 503 });
    response.headers.set("Cache-Control", "no-store, max-age=0");
    return response;
  }
}
