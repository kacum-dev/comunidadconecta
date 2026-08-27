import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { createTicketAttachment } from "@/lib/operations";
import { MAX_DOCUMENT_BYTES } from "@/lib/file-validation";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const { id } = await routeContext.params;
    const form = await request.formData();
    const file = form.get("file");
    const caption = String(form.get("caption") ?? "");
    if (!(file instanceof File) || !file.size) throw new ApiError(400, "Selecciona una foto o archivo.", "validation_error");
    if (file.size > MAX_DOCUMENT_BYTES) throw new ApiError(413, "El archivo supera el límite de 10 MB.", "file_too_large");
    const attachment = await createTicketAttachment(context, id, {
      fileName: file.name,
      bytes: new Uint8Array(await file.arrayBuffer()),
      caption
    }, request.headers.get("user-agent"));
    return noStoreJson({ attachment }, { status: 201 });
  } catch (error) { return handleApiError(error); }
}
