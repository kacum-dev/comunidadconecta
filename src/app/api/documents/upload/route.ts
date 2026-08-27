import { createHash } from "node:crypto";
import type { NextRequest } from "next/server";
import { ApiError, assertSameOrigin, handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { withTenant } from "@/lib/db";
import { can } from "@/lib/permissions";
import { MAX_DOCUMENT_BYTES, UnsupportedDocumentFileError, validateDocumentFile } from "@/lib/file-validation";
import { precisionForLocalDateTime, zonedLocalDateTimeToIso } from "@/lib/temporal";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";


export async function POST(request: NextRequest) {
  try {
    assertSameOrigin(request);
    const context = await requireApiContext();
    if (!can(context.current.role, "documentos", "write")) throw new ApiError(403, "No puedes subir documentos.", "forbidden");
    const form = await request.formData();
    const file = form.get("file");
    const title = String(form.get("title") || "").trim();
    const kind = String(form.get("kind") || "other");
    const status = String(form.get("status") || "current");
    const eventInput = String(form.get("eventDate") || "").trim();
    const eventAt = eventInput ? zonedLocalDateTimeToIso(eventInput, context.current.timeZone) : new Date().toISOString();
    const eventPrecision = eventInput ? precisionForLocalDateTime(eventInput) : "second";
    if (!(file instanceof File) || file.size < 1) throw new ApiError(400, "Selecciona un archivo.", "validation_error");
    if (file.size > MAX_DOCUMENT_BYTES) throw new ApiError(413, "El archivo supera el límite de 10 MB.", "file_too_large");
    if (!title || title.length > 200) throw new ApiError(400, "Escribe un título válido.", "validation_error");
    if (!eventAt) throw new ApiError(400, "La fecha y hora de emisión no son válidas para la zona horaria de la comunidad.", "validation_error");

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
    const row = await withTenant(context.current.communityId, context.user.id, async (client) => {
      const document = await client.query<{ id: string }>(
        `INSERT INTO documents
          (community_id, title, code, description, status, kind, event_at, event_time_precision, contact, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $10)
         RETURNING id::text`,
        [
          context.current.communityId,
          title,
          String(form.get("code") || "").trim() || null,
          String(form.get("description") || "").trim() || null,
          status,
          kind,
          eventAt,
          eventPrecision,
          String(form.get("contact") || "").trim() || null,
          context.user.id
        ]
      );
      const documentId = document.rows[0].id;
      await client.query(
        `INSERT INTO document_versions
          (community_id, document_id, version_number, original_name, mime_type, size_bytes, sha256, content, created_by)
         VALUES ($1, $2, 1, $3, $4, $5, $6, $7, $8)`,
        [context.current.communityId, documentId, file.name.slice(0, 240), mimeType, file.size, checksum, bytes, context.user.id]
      );
      await writeAudit(client, { communityId: context.current.communityId, userId: context.user.id, action: "documentos.uploaded", resourceType: "documentos", resourceId: documentId, after: { title, kind, checksum, size: file.size }, userAgent: request.headers.get("user-agent") });
      return documentId;
    });
    return noStoreJson({ id: row }, { status: 201 });
  } catch (error) {
    return handleApiError(error);
  }
}

