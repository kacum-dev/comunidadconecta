import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/permissions";
import { MAX_DOCUMENT_BYTES, UnsupportedDocumentFileError, validateDocumentFile } from "@/lib/file-validation";

export const runtime = "nodejs";

interface RouteContext { params: Promise<{ id: string }> }

export async function POST(request: NextRequest, routeContext: RouteContext) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    if (!can(context.current.role, "documentos", "write")) throw new ApiError(403, "No puedes versionar documentos.", "forbidden");
    const { id } = await routeContext.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400, "Identificador no válido.", "validation_error");
    const form = await request.formData();
    const file = form.get("file");
    if (!(file instanceof File) || file.size < 1) throw new ApiError(400, "Selecciona un archivo.", "validation_error");
    if (file.size > MAX_DOCUMENT_BYTES) throw new ApiError(413, "El archivo supera el límite de 10 MB.", "file_too_large");
    const bytes = Buffer.from(await file.arrayBuffer());
    let mimeType: string;
    try {
      mimeType = validateDocumentFile(file.name, bytes).mimeType;
    } catch (error) {
      if (error instanceof UnsupportedDocumentFileError) {
        throw new ApiError(415, error.message, "unsupported_file");
      }
      throw error;
    }
    const checksum = createHash("sha256").update(bytes).digest("hex");
    const version = await withTenant(context.current.communityId, context.user.id, async (client) => {
      const document = await client.query("SELECT 1 FROM documents WHERE id = $1 AND community_id = $2 AND archived_at IS NULL FOR UPDATE", [id, context.current.communityId]);
      if (!document.rowCount) throw new ApiError(404, "El documento no existe.", "not_found");
      const next = await client.query<{ version_number: number }>(
        `SELECT COALESCE(max(version_number), 0)::int + 1 AS version_number
           FROM document_versions WHERE community_id = $1 AND document_id = $2`,
        [context.current.communityId, id]
      );
      const versionNumber = next.rows[0].version_number;
      await client.query(
        `INSERT INTO document_versions
          (community_id, document_id, version_number, original_name, mime_type, size_bytes, sha256, content, created_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
        [context.current.communityId, id, versionNumber, file.name.slice(0, 240), mimeType, file.size, checksum, bytes, context.user.id]
      );
      await client.query("UPDATE documents SET version = version + 1, updated_by = $3 WHERE id = $1 AND community_id = $2", [id, context.current.communityId, context.user.id]);
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "documentos.version_created", resourceType: "documentos", resourceId: id, after: { versionNumber, checksum, size: file.size }, userAgent: request.headers.get("user-agent") });
      return versionNumber;
    });
    return noStoreJson({ version }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}
