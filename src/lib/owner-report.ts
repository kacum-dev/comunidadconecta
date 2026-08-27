import "server-only";

import PDFDocument from "pdfkit";
import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { withTenant } from "./db";
import { formatBusinessMoment, formatDateTime, temporalZoneNote, type TemporalPreferences, type TemporalPrecision } from "./temporal";

type FinancialRow = { title: string; code: string | null; kind: string; status: string; amount_cents: string; event_at: Date | null; due_at: Date | null; event_time_precision: TemporalPrecision | null; due_time_precision: TemporalPrecision | null; due_inclusive: boolean; paid_at: Date | null; paid_time_precision: "minute"|"second"|null };
type ReservationRow = { resource_name: string; title: string; status: string; starts_at: Date; ends_at: Date; deposit_status: string };
type TicketRow = { title: string; code: string | null; status: string; priority: string; event_at: Date | null; event_time_precision: TemporalPrecision | null };

type OwnerReportData = {
  generatedAt: Date;
  temporal: TemporalPreferences;
  community: { name: string; address: string; postalCode: string | null; city: string | null; province: string | null; phone: string | null; contactEmail: string | null };
  owner: { fullName: string; email: string };
  home: {
    id: string; code: string; unitType: string; siteName: string | null; blockName: string | null; staircase: string | null;
    floor: string | null; door: string | null; builtAreaM2: number | null; usableAreaM2: number | null;
    participationCoefficient: number; quotaMethod: string; fixedQuotaAmount: number | null; quotaFrequency: string;
  };
  financial: FinancialRow[];
  reservations: ReservationRow[];
  tickets: TicketRow[];
};

const colors = {
  ink: "#201A32",
  muted: "#6F6A7D",
  primary: "#6C4CF6",
  primaryDark: "#4C30C7",
  primarySoft: "#F0ECFF",
  blueSoft: "#EBF5FF",
  green: "#16856B",
  greenSoft: "#E7F8F2",
  orange: "#B56819",
  orangeSoft: "#FFF3E4",
  line: "#DED9E8",
  surface: "#F8F7FB",
  white: "#FFFFFF"
};

const money = new Intl.NumberFormat("es-ES", { style: "currency", currency: "EUR" });

const financialStatus: Record<string, string> = {
  draft: "Borrador", pending: "Pendiente", approved: "Aprobado", issued: "Emitido", paid: "Pagado", returned: "Devuelto"
};
const reservationStatus: Record<string, string> = {
  requested: "Solicitada", confirmed: "Confirmada", rejected: "Rechazada", cancelled: "Cancelada", completed: "Completada"
};
const ticketStatus: Record<string, string> = {
  received: "Recibida", triaged: "Revisada", assigned: "Asignada", in_progress: "En curso", resolved: "Resuelta", closed: "Cerrada"
};

function euros(cents: string | number) {
  return money.format(Number(cents) / 100);
}

function locationLabel(home: OwnerReportData["home"]) {
  return [home.siteName, home.blockName, home.staircase, home.floor && `Planta ${home.floor}`, home.door && `Puerta ${home.door}`].filter(Boolean).join(" · ") || "Ubicación pendiente";
}

function quotaLabel(home: OwnerReportData["home"]) {
  const frequency: Record<string, string> = { monthly: "mes", quarterly: "trimestre", semiannual: "semestre", annual: "año" };
  return home.quotaMethod === "fixed_amount"
    ? home.fixedQuotaAmount === null ? "Importe fijo pendiente" : `${money.format(home.fixedQuotaAmount)} / ${frequency[home.quotaFrequency] ?? "periodo"}`
    : `${home.participationCoefficient.toLocaleString("es-ES", { maximumFractionDigits: 6 })} % del gasto repartido`;
}

async function loadOwnerReportData(context: AuthContext, unitId: string): Promise<OwnerReportData> {
  if (context.current.role !== "owner") throw new ApiError(403, "Solo el propietario puede descargar este informe.", "forbidden");

  return withTenant(context.current.communityId, context.user.id, async (client) => {
    const homeResult = await client.query<{
      id: string; code: string; unit_type: string; site_name: string | null; block_name: string | null; staircase: string | null;
      floor: string | null; door: string | null; built_area_m2: string | null; usable_area_m2: string | null;
      participation_coefficient: string; quota_method: string; fixed_quota_cents: string | null; quota_frequency: string;
    }>(
      `SELECT pu.id::text,pu.code,pu.unit_type,pu.site_name,pu.block_name,pu.staircase,pu.floor,pu.door,
              pu.built_area_m2::text,pu.usable_area_m2::text,pu.participation_coefficient::text,
              pu.quota_method,pu.fixed_quota_cents::text,pu.quota_frequency
         FROM private_units pu
         JOIN unit_relations relation ON relation.unit_id=pu.id AND relation.community_id=pu.community_id
        WHERE pu.id=$1 AND pu.community_id=$2 AND pu.status='active'
          AND relation.user_id=$3 AND relation.relation_type IN ('owner','co_owner')
          AND relation.status='active' AND relation.valid_from <= current_date
          AND (relation.valid_to IS NULL OR relation.valid_to >= current_date)
        LIMIT 1`,
      [unitId, context.current.communityId, context.user.id]
    );
    if (!homeResult.rowCount) throw new ApiError(404, "La vivienda no está vinculada a tu propiedad.", "not_found");

    const communityResult = await client.query<{ name: string; address: string; postal_code: string | null; city: string | null; province: string | null; phone: string | null; contact_email: string | null }>(
      `SELECT name,address,postal_code,city,province,phone,contact_email::text FROM communities WHERE id=$1`,
      [context.current.communityId]
    );
    const financialResult = await client.query<FinancialRow>(
      `SELECT title,code,kind,status,amount_cents::text,event_at,due_at,event_time_precision,due_time_precision,due_inclusive,paid_at,paid_time_precision
         FROM financial_records
        WHERE community_id=$1 AND private_unit_id=$2 AND archived_at IS NULL
        ORDER BY COALESCE(event_at,due_at,created_at) DESC,created_at DESC
        LIMIT 1000`,
      [context.current.communityId, unitId]
    );
    const reservationResult = await client.query<ReservationRow>(
      `SELECT resource.name AS resource_name,booking.title,booking.status,booking.starts_at,booking.ends_at,booking.deposit_status
         FROM reservation_bookings booking
         JOIN reservation_resources resource ON resource.id=booking.resource_id AND resource.community_id=booking.community_id
        WHERE booking.community_id=$1 AND booking.user_id=$2
        ORDER BY booking.starts_at DESC
        LIMIT 1000`,
      [context.current.communityId, context.user.id]
    );
    const ticketResult = await client.query<TicketRow>(
      `SELECT title,code,status,priority,event_at,event_time_precision
         FROM tickets
        WHERE community_id=$1 AND private_unit_id=$2 AND archived_at IS NULL
        ORDER BY event_at DESC NULLS LAST,created_at DESC
        LIMIT 1000`,
      [context.current.communityId, unitId]
    );

    const row = homeResult.rows[0];
    return {
      generatedAt: new Date(),
      temporal: { locale: context.current.locale, timeZone: context.current.timeZone, dateFormat: context.current.dateFormat, timeFormat: context.current.timeFormat },
      community: {
        name: communityResult.rows[0].name,
        address: communityResult.rows[0].address,
        postalCode: communityResult.rows[0].postal_code,
        city: communityResult.rows[0].city,
        province: communityResult.rows[0].province,
        phone: communityResult.rows[0].phone,
        contactEmail: communityResult.rows[0].contact_email
      },
      owner: { fullName: context.user.fullName, email: context.user.email },
      home: {
        id: row.id, code: row.code, unitType: row.unit_type, siteName: row.site_name, blockName: row.block_name,
        staircase: row.staircase, floor: row.floor, door: row.door,
        builtAreaM2: row.built_area_m2 === null ? null : Number(row.built_area_m2),
        usableAreaM2: row.usable_area_m2 === null ? null : Number(row.usable_area_m2),
        participationCoefficient: Number(row.participation_coefficient), quotaMethod: row.quota_method,
        fixedQuotaAmount: row.fixed_quota_cents === null ? null : Number(row.fixed_quota_cents) / 100,
        quotaFrequency: row.quota_frequency
      },
      financial: financialResult.rows,
      reservations: reservationResult.rows,
      tickets: ticketResult.rows
    };
  });
}

function generatePdf(data: OwnerReportData): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ size: "A4", margins: { top: 42, right: 42, bottom: 0, left: 42 }, bufferPages: true, info: { Title: `Informe de vivienda ${data.home.code}`, Author: "Comunidad Conecta", Subject: "Resumen de vivienda para el propietario" } });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("error", reject);
    doc.on("end", () => resolve(Buffer.concat(chunks)));

    const pageWidth = doc.page.width;
    const contentWidth = pageWidth - 84;
    const bottom = doc.page.height - 64;

    const addPage = () => {
      doc.addPage();
      doc.fillColor(colors.muted).font("Helvetica-Bold").fontSize(8).text(data.community.name.toUpperCase(), 42, 26, { width: contentWidth, characterSpacing: 0.7 });
      doc.moveTo(42, 39).lineTo(pageWidth - 42, 39).strokeColor(colors.line).lineWidth(0.7).stroke();
      doc.x = 42;
      doc.y = 54;
    };
    const ensure = (height: number) => { if (doc.y + height > bottom) addPage(); };
    const sectionTitle = (title: string, subtitle: string) => {
      ensure(124);
      const y = doc.y + 6;
      doc.fillColor(colors.primary).font("Helvetica-Bold").fontSize(9).text(title.toUpperCase(), 42, y, { width: contentWidth, characterSpacing: 1.1 });
      doc.fillColor(colors.ink).font("Helvetica-Bold").fontSize(17).text(subtitle, 42, y + 15, { width: contentWidth, lineGap: 2 });
      doc.x = 42;
      doc.y = y + 43;
    };
    const empty = (message: string) => {
      ensure(48);
      const y = doc.y;
      doc.roundedRect(42, y, contentWidth, 42, 10).fill(colors.surface);
      doc.fillColor(colors.muted).font("Helvetica").fontSize(10).text(message, 56, y + 15, { width: contentWidth - 28 });
      doc.y = y + 50;
    };
    const table = (headers: string[], widths: number[], rows: string[][]) => {
      const headerHeight = 28;
      const rowHeight = 44;
      const drawHeader = () => {
        ensure(headerHeight + rowHeight);
        const y = doc.y;
        doc.roundedRect(42, y, contentWidth, headerHeight, 7).fill(colors.primarySoft);
        let x = 42;
        headers.forEach((header, index) => {
          doc.fillColor(colors.primaryDark).font("Helvetica-Bold").fontSize(8).text(header.toUpperCase(), x + 8, y + 10, { width: widths[index] - 16, ellipsis: true, lineBreak: false });
          x += widths[index];
        });
        doc.y = y + headerHeight;
      };
      drawHeader();
      rows.forEach((row, rowIndex) => {
        if (doc.y + rowHeight > bottom) { addPage(); drawHeader(); }
        const y = doc.y;
        if (rowIndex % 2 === 1) doc.rect(42, y, contentWidth, rowHeight).fill(colors.surface);
        let x = 42;
        row.forEach((cell, index) => {
          doc.fillColor(index === 0 ? colors.ink : colors.muted).font(index === 0 ? "Helvetica-Bold" : "Helvetica").fontSize(8).text(cell, x + 8, y + 8, { width: widths[index] - 16, height: rowHeight - 13, ellipsis: true, lineGap: 1 });
          x += widths[index];
        });
        doc.moveTo(42, y + rowHeight).lineTo(42 + contentWidth, y + rowHeight).strokeColor(colors.line).lineWidth(0.45).stroke();
        doc.y = y + rowHeight;
      });
      doc.x = 42;
      doc.y += 8;
    };

    // Portada ejecutiva
    doc.rect(0, 0, pageWidth, 236).fill(colors.primary);
    doc.circle(pageWidth - 28, 40, 132).fill("#8068F8");
    doc.circle(pageWidth - 40, 188, 82).fill("#5D42D8");
    doc.fillColor(colors.white).font("Helvetica-Bold").fontSize(10).text("COMUNIDAD CONECTA", 42, 42, { characterSpacing: 1.4 });
    doc.font("Helvetica-Bold").fontSize(29).text("Informe de vivienda", 42, 82, { width: 350 });
    doc.font("Helvetica").fontSize(12).fillColor("#E8E2FF").text("Pagos, reservas e incidencias en un documento claro y verificable.", 42, 121, { width: 360, lineGap: 4 });
    doc.roundedRect(42, 169, 96, 34, 17).fill(colors.white);
    doc.fillColor(colors.primaryDark).font("Helvetica-Bold").fontSize(14).text(data.home.code, 42, 179, { width: 96, align: "center" });
    doc.fillColor(colors.white).font("Helvetica-Bold").fontSize(11).text(data.community.name, 152, 171, { width: 310 });
    doc.fillColor("#E8E2FF").font("Helvetica").fontSize(9).text(locationLabel(data.home), 152, 188, { width: 310, ellipsis: true, lineBreak: false });

    doc.y = 262;
    const pending = data.financial.filter((item) => !["paid", "returned"].includes(item.status)).reduce((sum, item) => sum + Number(item.amount_cents), 0);
    const paid = data.financial.filter((item) => item.status === "paid").reduce((sum, item) => sum + Number(item.amount_cents), 0);
    const upcoming = data.reservations.filter((item) => ["requested", "confirmed"].includes(item.status) && item.starts_at > data.generatedAt).length;
    const openTickets = data.tickets.filter((item) => !["resolved", "closed"].includes(item.status)).length;
    const cards = [
      { label: "PAGADO", value: euros(paid), fill: colors.greenSoft, color: colors.green },
      { label: "PENDIENTE", value: euros(pending), fill: colors.orangeSoft, color: colors.orange },
      { label: "PRÓXIMAS RESERVAS", value: String(upcoming), fill: colors.blueSoft, color: colors.primaryDark },
      { label: "INCIDENCIAS ABIERTAS", value: String(openTickets), fill: colors.primarySoft, color: colors.primaryDark }
    ];
    const cardGap = 9;
    const cardWidth = (contentWidth - cardGap * 3) / 4;
    cards.forEach((card, index) => {
      const x = 42 + index * (cardWidth + cardGap);
      doc.roundedRect(x, 262, cardWidth, 72, 11).fill(card.fill);
      doc.fillColor(card.color).font("Helvetica-Bold").fontSize(7).text(card.label, x + 10, 277, { width: cardWidth - 20, characterSpacing: 0.5 });
      doc.fillColor(colors.ink).font("Helvetica-Bold").fontSize(16).text(card.value, x + 10, 298, { width: cardWidth - 20, ellipsis: true, lineBreak: false });
    });
    doc.y = 359;

    sectionTitle("La vivienda", "Datos esenciales");
    const detailY = doc.y;
    doc.roundedRect(42, detailY, contentWidth, 118, 13).fill(colors.surface);
    const details = [
      ["Titular", data.owner.fullName],
      ["Ubicación", locationLabel(data.home)],
      ["Superficie", `${data.home.builtAreaM2?.toLocaleString("es-ES") ?? "-"} m² construidos · ${data.home.usableAreaM2?.toLocaleString("es-ES") ?? "-"} m² útiles`],
      ["Cuota ordinaria", quotaLabel(data.home)]
    ];
    details.forEach(([label, value], index) => {
      const y = detailY + 13 + index * 25;
      doc.fillColor(colors.muted).font("Helvetica").fontSize(8).text(label.toUpperCase(), 56, y, { width: 105, characterSpacing: 0.5 });
      doc.fillColor(colors.ink).font("Helvetica-Bold").fontSize(10).text(value, 166, y - 1, { width: contentWidth - 138, ellipsis: true, lineBreak: false });
    });
    doc.y = detailY + 135;

    sectionTitle("Economía", "Pagos y recibos");
    doc.fillColor(colors.muted).font("Helvetica").fontSize(8).text(`${temporalZoneNote(data.temporal)}. Los vencimientos indicados son inclusivos.`,42,doc.y,{width:contentWidth});
    doc.y += 18;
    if (data.financial.length) table(
      ["Concepto / estado", "Emisión", "Vence (incl.)", "Pago", "Importe"],
      [140, 105, 105, 105, contentWidth - 455],
      data.financial.map((item) => [
        `${item.title}\n${financialStatus[item.status] ?? item.status}`,
        item.event_at ? formatBusinessMoment(item.event_at.toISOString(),item.event_time_precision,data.temporal) : "No registrada",
        item.due_at ? formatBusinessMoment(item.due_at.toISOString(),item.due_time_precision,data.temporal,{deadline:true,inclusive:item.due_inclusive}) : "Sin vencimiento",
        item.status !== "paid" ? "—" : item.paid_at ? formatDateTime(item.paid_at,data.temporal,item.paid_time_precision==="second") : "Fecha y hora no registradas",
        euros(item.amount_cents)
      ])
    ); else empty("No hay pagos ni recibos asociados a esta vivienda.");

    sectionTitle("Reservas", "Uso de espacios comunes");
    doc.fillColor(colors.muted).font("Helvetica").fontSize(9).text("Reservas realizadas por el titular de este informe.", 42, doc.y, { width: contentWidth, lineGap: 2 });
    doc.x = 42;
    doc.y += 20;
    if (data.reservations.length) table(
      ["Espacio", "Inicio (incl.)", "Fin (excl.)", "Estado", "Solicitud"],
      [125, 112, 112, 72, contentWidth - 421],
      data.reservations.map((item) => [item.resource_name, formatDateTime(item.starts_at,data.temporal), formatDateTime(item.ends_at,data.temporal), reservationStatus[item.status] ?? item.status, item.title])
    ); else empty("No hay reservas realizadas por el titular.");

    sectionTitle("Seguimiento", "Incidencias de la vivienda");
    if (data.tickets.length) table(
      ["Incidencia", "Referencia", "Estado", "Comunicada el"],
      [222, 96, 96, contentWidth - 414],
      data.tickets.map((item) => [item.title, item.code || "Sin referencia", ticketStatus[item.status] ?? item.status, item.event_at ? formatBusinessMoment(item.event_at.toISOString(),item.event_time_precision,data.temporal) : "Fecha y hora no registradas"])
    ); else empty("No hay incidencias asociadas a esta vivienda.");

    ensure(92);
    const noteY = doc.y + 8;
    doc.roundedRect(42, noteY, contentWidth, 70, 12).fill(colors.primarySoft);
    doc.fillColor(colors.primaryDark).font("Helvetica-Bold").fontSize(10).text("Sobre este informe", 56, noteY + 14);
    doc.fillColor(colors.muted).font("Helvetica").fontSize(8.7).text("Documento informativo generado con los datos disponibles en Comunidad Conecta. No sustituye justificantes bancarios, certificados de deuda ni documentos emitidos por la administración.", 56, noteY + 31, { width: contentWidth - 28, lineGap: 3 });

    const pages = doc.bufferedPageRange();
    for (let index = pages.start; index < pages.start + pages.count; index += 1) {
      doc.switchToPage(index);
      const footerLineY = doc.page.height - 70;
      const footerTextY = doc.page.height - 61;
      doc.moveTo(42, footerLineY).lineTo(doc.page.width - 42, footerLineY).strokeColor(colors.line).lineWidth(0.6).stroke();
      doc.fillColor(colors.muted).font("Helvetica").fontSize(7.5).text(`Generado el ${formatDateTime(data.generatedAt,data.temporal)} · ${data.temporal.timeZone} · ${data.owner.email}`, 42, footerTextY, { width: contentWidth - 80, ellipsis: true, lineBreak: false });
      doc.font("Helvetica-Bold").text(`${index - pages.start + 1} / ${pages.count}`, doc.page.width - 82, footerTextY, { width: 40, align: "right", lineBreak: false });
    }
    doc.end();
  });
}

export async function buildOwnerReport(context: AuthContext, unitId: string, userAgent?: string | null) {
  const data = await loadOwnerReportData(context, unitId);
  const buffer = await generatePdf(data);
  await withTenant(context.current.communityId, context.user.id, (client) => writeAudit(client, {
    communityId: context.current.communityId,
    userId: context.user.id,
    action: "owner_report.exported",
    resourceType: "private_unit",
    resourceId: unitId,
    after: { financialRecords: data.financial.length, reservations: data.reservations.length, tickets: data.tickets.length, generatedAt: data.generatedAt.toISOString(), timeZone: data.temporal.timeZone },
    userAgent
  }));
  const safeCode = data.home.code.normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/[^a-zA-Z0-9_-]+/g, "-").replace(/^-+|-+$/g, "") || "vivienda";
  return { buffer, filename: `informe-vivienda-${safeCode}.pdf` };
}
