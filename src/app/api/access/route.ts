import type { NextRequest } from "next/server";
import { z } from "zod";
import { createAccess, listAccess } from "@/lib/access";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";

const schema = z.object({
  fullName: z.string().trim().min(2).max(180), email: z.email().max(254).transform((v) => v.toLowerCase()),
  role: z.enum(["owner","resident","president","vice_president","secretary","treasurer","administrator","supplier","auditor","support","platform_admin"]),
  temporaryPassword: z.string().max(256).optional().nullable(), unitId: z.union([z.uuid(), z.literal(""), z.null()]).optional().transform((v) => v || null),
  relationType: z.enum(["owner","co_owner","tenant","authorized_resident"]).optional().nullable()
});

export async function GET() { try { const context = await requireApiContext(); return noStoreJson({ access: await listAccess(context) }); } catch (error) { return handleApiError(error); } }
export async function POST(request: NextRequest) { try { assertSameOrigin(request); const context = await requireApiContext(); const parsed = schema.safeParse(await request.json()); if (!parsed.success) throw new ApiError(400,"Revisa los datos del acceso.","validation_error"); return noStoreJson({ access: await createAccess(context, parsed.data) }, { status: 201 }); } catch (error) { return handleApiError(error); } }
