import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { importBankStatement } from "@/lib/finance";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || !file.size) throw new ApiError(400, "Selecciona un extracto bancario.", "validation_error");
    if (file.size > 5_000_000) throw new ApiError(413, "El extracto supera el límite de 5 MB.", "file_too_large");
    if (!/\.(csv|n43|norma43|txt)$/i.test(file.name)) throw new ApiError(415, "Usa un archivo CSV o Norma 43.", "unsupported_file");
    const result = await importBankStatement(context, file.name, await file.text(), request.headers.get("user-agent"));
    return noStoreJson(result, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
