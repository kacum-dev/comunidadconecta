import type { NextRequest } from "next/server";
import { ApiError, handleApiError, requireApiContext } from "@/lib/api";
import { writeAudit } from "@/lib/audit";
import { withTenant } from "@/lib/db";
import { can, isResidentRole } from "@/lib/permissions";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

interface RouteContext { params: Promise<{ id: string }> }

function safeFilename(value: string) {
  return value.replace(/[\r\n"\\/]/g, "_").slice(0, 180) || "documento";
}

export async function GET(request: NextRequest, routeContext: RouteContext) {
  try {
    const context = await requireApiContext();
    if (!can(context.current.role, "documentos", "read")) throw new ApiError(403, "No puedes descargar este documento.", "forbidden");
    const { id } = await routeContext.params;
    if (!/^[0-9a-f-]{36}$/i.test(id)) throw new ApiError(400, "Identificador no válido.", "validation_error");
    const file = await withTenant(context.current.communityId, context.user.id, async (client) => {
      const result = await client.query<{ original_name: string; mime_type: string; content: Buffer; sha256: string }>(
        `SELECT v.original_name, v.mime_type, v.content, v.sha256
           FROM document_versions v
           JOIN documents d ON d.id = v.document_id AND d.community_id = v.community_id
          WHERE v.community_id = $1 AND v.document_id = $2 AND d.archived_at IS NULL
            AND ($3::boolean = false OR EXISTS (
              SELECT 1 FROM unit_relations ur WHERE ur.community_id = d.community_id
                AND ur.user_id = $4 AND ur.unit_id = d.private_unit_id AND ur.status = 'active'
                AND ur.valid_from <= current_date AND (ur.valid_to IS NULL OR ur.valid_to >= current_date)
            ) OR (d.private_unit_id IS NULL AND d.data->>'ticketId' IS NOT NULL AND EXISTS (
              SELECT 1 FROM tickets t WHERE t.id::text=d.data->>'ticketId' AND t.community_id=d.community_id
                AND (t.created_by=$4 OR EXISTS (SELECT 1 FROM unit_relations ur WHERE ur.community_id=t.community_id
                  AND ur.user_id=$4 AND ur.unit_id=t.private_unit_id AND ur.status='active'))
            )) OR (d.private_unit_id IS NULL AND d.data->>'ticketId' IS NULL
              AND COALESCE(d.data->>'audience','community') = ANY($5::text[])))
          ORDER BY v.version_number DESC LIMIT 1`,
        [context.current.communityId, id, isResidentRole(context.current.role), context.user.id,
         context.current.role === "owner" ? ["community","owners","residents"] : ["community","residents"]]
      );
      if (!result.rowCount) throw new ApiError(404, "Este documento todavía no tiene un archivo descargable.", "not_found");
      const downloaded = result.rows[0];
      await writeAudit(client, {
        communityId: context.current.communityId,
        userId: context.user.id,
        action: "documentos.downloaded",
        resourceType: "documentos",
        resourceId: id,
        after: { sha256: downloaded.sha256, mimeType: downloaded.mime_type, size: downloaded.content.length },
        userAgent: request.headers.get("user-agent")
      });
      return downloaded;
    });
    return new Response(new Uint8Array(file.content), {
      headers: {
        "Content-Type": file.mime_type,
        "Content-Disposition": `attachment; filename="${safeFilename(file.original_name)}"`,
        "Content-Length": String(file.content.length),
        "Cache-Control": "private, no-store, max-age=0",
        "X-Content-SHA256": file.sha256
      }
    });
  } catch (error) {
    return handleApiError(error);
  }
}
