import { createHash } from "node:crypto";
import { createPool } from "./db-config.mjs";
import { createPasswordHash } from "./password.mjs";

const email = (process.env.SEED_ADMIN_EMAIL || "admin@comunidadconecta.local").trim().toLowerCase();
const password = process.env.SEED_ADMIN_PASSWORD;
const demoPassword = process.env.SEED_DEMO_PASSWORD || password;

if (!password || password.length < 12) {
  throw new Error("SEED_ADMIN_PASSWORD debe contener al menos 12 caracteres");
}
if (!demoPassword || demoPassword.length < 12) {
  throw new Error("SEED_DEMO_PASSWORD debe contener al menos 12 caracteres");
}

const pool = createPool();
const client = await pool.connect();

const sampleRows = {
  structure_nodes: [
    ["Edificio principal", "ED-01", "Bloque residencial de seis plantas", "active", "building", null, null, null, null, "C/ del Olivo, 24", null, null],
    ["Garaje comunitario", "GAR-01", "Dos sótanos y 36 plazas", "active", "subcommunity", null, null, null, null, "Planta -1 y -2", null, null],
    ["Piscina y zona común", "ZC-01", "Recinto comunitario con control de aforo", "active", "common_area", null, null, null, null, "Patio interior", null, null]
  ],
  people_relations: [
    ["Ana Torres", "1º A", "Propietaria · coeficiente 3,25 %", "active", "owner", null, null, null, "ana.torres@example.test", "Bloque A", null, null],
    ["Miguel Ruiz", "2º B", "Propietario y presidente en ejercicio", "active", "president", null, null, null, "miguel.ruiz@example.test", "Bloque A", null, null],
    ["Laura Vidal", "3º C", "Ocupante autorizada para avisos e incidencias", "active", "resident", null, null, null, "laura.vidal@example.test", "Bloque A", null, null]
  ],
  financial_records: [
    ["Cuota ordinaria · agosto", "REC-2026-081", "Mantenimiento general y fondo de reserva", "paid", "charge", 8650, "2026-08-01", "2026-08-10", "Ana Torres", "1º A", null, null],
    ["Derrama reparación de cubierta", "DER-2026-02", "Segunda fracción aprobada en Junta", "pending", "assessment", 14500, "2026-08-05", "2026-08-25", "Miguel Ruiz", "2º B", "high", null],
    ["Factura mantenimiento ascensor", "FAC-2026-118", "Revisión mensual y línea de emergencia", "approved", "invoice", 28930, "2026-08-07", "2026-09-06", "Elevadores Sureste S.L.", "Ascensor principal", null, null]
  ],
  bank_transactions: [
    ["Ingreso recibo 1º A", "BANK-260812-001", "Transferencia identificada automáticamente", "matched", "credit", 8650, "2026-08-10", null, "Ana Torres", null, null, "REC-2026-081"],
    ["Pago electricidad zonas comunes", "BANK-260812-002", "Pendiente de vincular con factura", "unmatched", "debit", -17642, "2026-08-11", null, "Energía Mediterránea", null, "normal", null]
  ],
  meetings: [
    ["Junta general ordinaria 2026", "JGO-2026", "Aprobación de cuentas, presupuesto y renovación de cargos", "called", "ordinary", null, "2026-09-18", "2026-09-10", null, "Sala comunitaria", "high", "Secretaría"],
    ["Junta extraordinaria · cubierta", "JGE-2026-01", "Acuerdo de reparación urgente y derrama", "closed", "extraordinary", null, "2026-06-20", null, null, "Sala comunitaria", null, "Secretaría"]
  ],
  communications: [
    ["Corte temporal de agua", "AVI-2026-034", "El jueves de 09:00 a 12:00 por trabajos en el grupo de presión.", "published", "operational", null, "2026-08-14", "2026-08-14", null, "Todo el edificio", "high", "Administración"],
    ["Convocatoria Junta ordinaria", "NOT-2026-012", "Documentación y orden del día disponibles en el expediente.", "scheduled", "formal", null, "2026-08-20", "2026-09-18", null, "Propietarios", "normal", "Secretaría"]
  ],
  tickets: [
    ["Luz fundida en el portal", "INC-2026-041", "La luminaria junto al ascensor no enciende.", "assigned", "maintenance", null, "2026-08-11", "2026-08-14", "Ana Torres", "Portal principal", "normal", "Mantenimientos Levante"],
    ["Humedad en rellano de la quinta planta", "INC-2026-042", "Mancha creciente junto al bajante comunitario.", "triage", "water", null, "2026-08-12", "2026-08-13", "Laura Vidal", "5ª planta", "urgent", "Administración"]
  ],
  suppliers: [
    ["Elevadores Sureste S.L.", "B73911220", "Mantenimiento integral de ascensores", "active", "elevators", 28930, "2026-01-01", "2026-12-31", "soporte@example.test", "Murcia", null, "María Gil"],
    ["Mantenimientos Levante", "B30445566", "Electricidad, fontanería y pequeñas reparaciones", "active", "maintenance", null, "2026-02-01", "2027-01-31", "partes@example.test", "Murcia", null, "José López"]
  ],
  documents: [
    ["Acta Junta extraordinaria · junio 2026", "DOC-ACT-2026-06", "Versión firmada y cerrada", "current", "minutes", null, "2026-06-22", null, "Secretaría", null, null, null],
    ["Póliza multirriesgo 2026", "DOC-SEG-2026", "Coberturas y condiciones particulares", "current", "insurance", null, "2026-01-01", "2026-12-31", "Seguros Ejemplo", null, null, null]
  ],
  transitions: [
    ["Cambio de administración 2026", "TRA-2026-01", "Expediente de continuidad institucional y revisión de saldos", "inventory", "administrator_change", null, "2026-08-01", "2026-08-31", "Presidencia", null, "high", "Comisión de transición"]
  ],
  privacy_cases: [
    ["Solicitud de acceso a datos personales", "RGPD-2026-004", "Pendiente de verificar identidad y delimitar el alcance.", "identity_check", "access", null, "2026-08-09", "2026-09-08", "Solicitante protegido", null, "normal", "DPO"]
  ],
  approvals: [
    ["Aprobar presupuesto reparación de bajante", "APR-2026-018", "Presupuesto de Fontanería Segura por 1.240,00 €", "pending", "supplier_quote", 124000, "2026-08-12", "2026-08-15", "Fontanería Segura", "5ª planta", "high", "Presidencia"]
  ],
  assets: [
    ["Ascensor principal", "ACT-ASC-01", "Otis Gen2 · n.º serie CC-2841", "active", "elevator", null, "2017-04-18", "2026-09-15", "Elevadores Sureste S.L.", "Portal principal", "high", "Administración"],
    ["Grupo de presión", "ACT-GP-01", "Equipo doble con alternancia automática", "maintenance_due", "water_pump", null, "2019-11-03", "2026-08-14", "Mantenimientos Levante", "Cuarto técnico", "high", "Administración"]
  ],
  reservations: [
    ["Sala comunitaria · reunión familiar", "RES-2026-031", "Reserva de 18:00 a 22:00", "confirmed", "community_room", 5000, "2026-08-22", "2026-08-22", "Ana Torres", "Sala comunitaria", null, null]
  ],
  configuration_records: [
    ["Ejercicio económico 2026", "CFG-FY-2026", "Del 1 de enero al 31 de diciembre", "active", "fiscal_period", null, "2026-01-01", "2026-12-31", null, null, null, null],
    ["Perfil jurídico estatal LPH", "CFG-LPH-01", "Reglas generales; excepciones requieren revisión profesional", "active", "legal_profile", null, null, null, null, null, null, null]
  ]
};

try {
  await client.query("BEGIN");
  const passwordData = await createPasswordHash(password);

  const userResult = await client.query(
    `INSERT INTO app_users (email, full_name, password_hash, password_salt, password_params, status, is_demo)
     VALUES ($1, 'Pepe Sánchez', $2, $3, $4::jsonb, 'active', false)
     ON CONFLICT (email) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       password_hash = EXCLUDED.password_hash,
       password_salt = EXCLUDED.password_salt,
       password_params = EXCLUDED.password_params,
       status = 'active',
       is_demo = false
     RETURNING id`,
    [email, passwordData.hash, passwordData.salt, JSON.stringify(passwordData.params)]
  );
  const userId = userResult.rows[0].id;
  await client.query("DELETE FROM auth_attempts WHERE email_hash = $1 AND succeeded = false", [createHash("sha256").update(email).digest("hex")]);

  const communityResult = await client.query(
    `INSERT INTO communities (name, slug, tax_id, address, postal_code, city, province, phone, contact_email, website_url, status, is_demo)
     VALUES ('Residencial Mirador del Segura', 'mirador-del-segura', 'H73900128', 'Calle del Olivo, 24', '30008', 'Murcia', 'Murcia', '+34 968 000 024', 'administracion@mirador.example.test', 'https://mirador.example.test', 'active', true)
     ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name,
       phone = COALESCE(communities.phone, EXCLUDED.phone),
       contact_email = COALESCE(communities.contact_email, EXCLUDED.contact_email),
       website_url = COALESCE(communities.website_url, EXCLUDED.website_url),
       is_demo = true,
       updated_at = now()
     RETURNING id`,
  );
  const communityId = communityResult.rows[0].id;

  await client.query(
    `INSERT INTO community_app_settings
      (community_id, office_hours, time_format, date_format, currency_code, fiscal_year_start_month,
       default_due_day, notifications_email, notifications_push, backup_provider, backup_frequency,
       backup_time, backup_retention_days, backup_notification_email, accounting_enabled,
       accounting_enabled_at, accounting_enabled_by, created_by, updated_by)
     VALUES ($1, 'Lunes a viernes, de 09:00 a 14:00', '24h', 'DD/MM/YYYY', 'EUR', 1,
       10, true, true, 'hosting', 'daily', '02:00', 30, $2, true, now(), $3, $3, $3)
     ON CONFLICT (community_id) DO UPDATE SET
       office_hours = COALESCE(community_app_settings.office_hours, EXCLUDED.office_hours),
       backup_notification_email = COALESCE(community_app_settings.backup_notification_email, EXCLUDED.backup_notification_email),
       accounting_enabled = true,
       accounting_enabled_at = COALESCE(community_app_settings.accounting_enabled_at, now()),
       accounting_enabled_by = COALESCE(community_app_settings.accounting_enabled_by, EXCLUDED.accounting_enabled_by)`,
    [communityId, 'administracion@mirador.example.test', userId]
  );

  await client.query(
    `INSERT INTO memberships (community_id, user_id, role, status)
     VALUES ($1, $2, 'administrator', 'active')
     ON CONFLICT (community_id, user_id, role) DO UPDATE SET status = 'active', valid_to = NULL`,
    [communityId, userId]
  );
  await client.query(
    `INSERT INTO memberships (community_id, user_id, role, status)
     VALUES ($1, $2, 'platform_admin', 'active')
     ON CONFLICT (community_id, user_id, role) DO UPDATE SET status = 'active', valid_to = NULL`,
    [communityId, userId]
  );

  const demoAccounts = [
    ["miguel.ruiz@demo.comunidadconecta.local", "Miguel Ruiz", "president"],
    ["carolina.mora@demo.comunidadconecta.local", "Carolina Mora", "vice_president"],
    ["elena.soler@demo.comunidadconecta.local", "Elena Soler", "secretary"],
    ["diego.navarro@demo.comunidadconecta.local", "Diego Navarro", "treasurer"],
    ["sara.martin@demo.comunidadconecta.local", "Sara Martín", "administrator"],
    ["ana.torres@demo.comunidadconecta.local", "Ana Torres", "owner"],
    ["laura.vidal@demo.comunidadconecta.local", "Laura Vidal", "resident"]
  ];
  const demoUsers = new Map();
  for (const [demoEmail, fullName, role] of demoAccounts) {
    const demoPasswordData = await createPasswordHash(demoPassword);
    const demoUser = await client.query(
      `INSERT INTO app_users (email, full_name, password_hash, password_salt, password_params, status, is_demo)
       VALUES ($1,$2,$3,$4,$5::jsonb,'active',true)
       ON CONFLICT (email) DO UPDATE SET full_name=EXCLUDED.full_name,password_hash=EXCLUDED.password_hash,
         password_salt=EXCLUDED.password_salt,password_params=EXCLUDED.password_params,status='active',is_demo=true
       RETURNING id`,
      [demoEmail, fullName, demoPasswordData.hash, demoPasswordData.salt, JSON.stringify(demoPasswordData.params)]
    );
    demoUsers.set(demoEmail, demoUser.rows[0].id);
    await client.query("DELETE FROM auth_attempts WHERE email_hash = $1 AND succeeded = false", [createHash("sha256").update(demoEmail).digest("hex")]);
    await client.query(
      `INSERT INTO memberships (community_id,user_id,role,status) VALUES ($1,$2,$3,'active')
       ON CONFLICT (community_id,user_id,role) DO UPDATE SET status='active',valid_to=NULL`,
      [communityId, demoUser.rows[0].id, role]
    );
  }

  await client.query(
    `INSERT INTO community_demo_settings
      (community_id, enabled, public_title, public_description, enabled_roles,
       session_duration_minutes, created_by, updated_by)
     VALUES ($1, false, 'Explora Comunidad Conecta',
       'Entra con el perfil que prefieras y descubre cómo se gestiona una comunidad de principio a fin.',
       $2::text[], 60, $3, $3)
     ON CONFLICT (community_id) DO NOTHING`,
    [communityId, ["president", "vice_president", "secretary", "treasurer", "administrator", "owner", "resident"], userId]
  );

  const unitSpecs = [
    ["1º A", "1", "A", 3.25, 112.4, 94.2, 3, 2, "fixed_amount", 8650, "1234567XH6013S0001AB"],
    ["2º B", "2", "B", 3.4, 118.8, 99.1, 3, 2, "participation_coefficient", null, "1234567XH6013S0002ZX"],
    ["3º C", "3", "C", 3.15, 106.2, 88.6, 3, 2, "participation_coefficient", null, "1234567XH6013S0003KM"],
    ["4º A", "4", "A", 3.25, 112.4, 94.2, 3, 2, "fixed_amount", 8650, "1234567XH6013S0004QW"],
    ["4º B", "4", "B", 3.4, 118.8, 99.1, 3, 2, "participation_coefficient", null, "1234567XH6013S0005ER"],
    ["5º C", "5", "C", 3.15, 106.2, 88.6, 3, 2, "participation_coefficient", null, "1234567XH6013S0006TY"]
  ];
  const units = new Map();
  for (const [code, floor, door, coefficient, builtArea, usableArea, bedrooms, bathrooms, quotaMethod, fixedQuotaCents, cadastralReference] of unitSpecs) {
    const unit = await client.query(
      `INSERT INTO private_units
        (community_id,code,unit_type,floor,door,participation_coefficient,built_area_m2,usable_area_m2,
         bedrooms,bathrooms,quota_method,fixed_quota_cents,quota_frequency,cadastral_reference,created_by,updated_by)
       VALUES ($1,$2,'home',$3,$4,$5,$6,$7,$8,$9,$10,$11,'monthly',$12,$13,$13)
       ON CONFLICT (community_id,code) DO UPDATE SET floor=EXCLUDED.floor,door=EXCLUDED.door,
         participation_coefficient=EXCLUDED.participation_coefficient,built_area_m2=EXCLUDED.built_area_m2,
         usable_area_m2=EXCLUDED.usable_area_m2,bedrooms=EXCLUDED.bedrooms,bathrooms=EXCLUDED.bathrooms,
         quota_method=EXCLUDED.quota_method,fixed_quota_cents=EXCLUDED.fixed_quota_cents,
         quota_frequency=EXCLUDED.quota_frequency,cadastral_reference=EXCLUDED.cadastral_reference,
         updated_by=EXCLUDED.updated_by
       RETURNING id`,
      [communityId, code, floor, door, coefficient, builtArea, usableArea, bedrooms, bathrooms,
       quotaMethod, fixedQuotaCents, cadastralReference, userId]
    );
    units.set(code, unit.rows[0].id);
  }
  await client.query(
    `UPDATE private_units
        SET site_name = CASE WHEN code IN ('1º A','2º B','3º C') THEN 'Manzana Norte' ELSE 'Manzana Sur' END,
            block_name = CASE WHEN code IN ('1º A','2º B','4º A') THEN 'Bloque A' ELSE 'Bloque B' END,
            staircase = CASE WHEN code IN ('3º C','5º C') THEN 'Escalera 2' ELSE 'Escalera 1' END
      WHERE community_id = $1 AND code = ANY($2::text[])`,
    [communityId, unitSpecs.map(([code]) => code)]
  );

  async function ensureRelation({ code, linkedUserId, fullName, relationType, ownership = null, primary = false, canVote = false }) {
    await client.query(
      `INSERT INTO unit_relations (community_id,unit_id,user_id,full_name,email,relation_type,ownership_percentage,
        is_primary,can_vote,valid_from,status,source,declared_by,verified_by,verified_at)
       VALUES ($1,$2,$3,$4,(SELECT email FROM app_users WHERE id=$3),$5,$6,$7,$8,'2026-01-01','active','administration',$9,$9,now())
       ON CONFLICT (community_id,unit_id,user_id,relation_type) WHERE status IN ('pending','active') AND user_id IS NOT NULL
       DO UPDATE SET full_name=EXCLUDED.full_name,status='active',ownership_percentage=EXCLUDED.ownership_percentage,
         is_primary=EXCLUDED.is_primary,can_vote=EXCLUDED.can_vote,valid_to=NULL`,
      [communityId, units.get(code), linkedUserId, fullName, relationType, ownership, primary, canVote, userId]
    );
  }
  const miguelId = demoUsers.get("miguel.ruiz@demo.comunidadconecta.local");
  const anaId = demoUsers.get("ana.torres@demo.comunidadconecta.local");
  const lauraId = demoUsers.get("laura.vidal@demo.comunidadconecta.local");
  await ensureRelation({ code: "1º A", linkedUserId: anaId, fullName: "Ana Torres", relationType: "owner", ownership: 100, primary: true, canVote: true });
  await ensureRelation({ code: "2º B", linkedUserId: miguelId, fullName: "Miguel Ruiz", relationType: "owner", ownership: 100, primary: true, canVote: true });
  await ensureRelation({ code: "3º C", linkedUserId: lauraId, fullName: "Laura Vidal", relationType: "tenant", primary: true });
  await client.query(
    `INSERT INTO unit_relations (community_id,unit_id,full_name,email,relation_type,ownership_percentage,is_primary,can_vote,valid_from,status,source,declared_by,verified_by,verified_at)
     SELECT $1,$2,'Marta Vidal','marta.vidal@example.test','owner',100,true,true,'2026-01-01','active','administration',$3,$3,now()
     WHERE NOT EXISTS (SELECT 1 FROM unit_relations WHERE community_id=$1 AND unit_id=$2 AND full_name='Marta Vidal' AND status='active')`,
    [communityId, units.get("3º C"), userId]
  );
  await client.query(
    `INSERT INTO memberships (community_id,user_id,role,status) VALUES ($1,$2,'owner','active')
     ON CONFLICT (community_id,user_id,role) DO UPDATE SET status='active',valid_to=NULL`,
    [communityId, miguelId]
  );

  for (const [table, rows] of Object.entries(sampleRows)) {
    const count = await client.query(`SELECT count(*)::int AS count FROM ${table} WHERE community_id = $1`, [communityId]);
    if (count.rows[0].count > 0) continue;

    for (const row of rows) {
      await client.query(
        `INSERT INTO ${table}
          (community_id, title, code, description, status, kind, amount_cents, event_date, due_date, contact, location, priority, assigned_to, created_by, updated_by)
         VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14, $14)`,
        [communityId, ...row, userId]
      );
    }
  }

  await client.query("UPDATE financial_records SET private_unit_id=$2 WHERE community_id=$1 AND location='1º A'", [communityId, units.get("1º A")]);
  await client.query("UPDATE financial_records SET private_unit_id=$2 WHERE community_id=$1 AND location='2º B'", [communityId, units.get("2º B")]);
  await client.query("UPDATE reservations SET private_unit_id=$2 WHERE community_id=$1 AND contact='Ana Torres'", [communityId, units.get("1º A")]);
  await client.query("UPDATE tickets SET private_unit_id=$2 WHERE community_id=$1 AND contact='Ana Torres'", [communityId, units.get("1º A")]);
  await client.query("UPDATE tickets SET private_unit_id=$2 WHERE community_id=$1 AND contact='Laura Vidal'", [communityId, units.get("3º C")]);
  await client.query("UPDATE documents SET data=jsonb_set(data,'{audience}','\"owners\"'::jsonb,true) WHERE community_id=$1", [communityId]);

  await client.query(
    `INSERT INTO audit_events (community_id, actor_user_id, action, resource_type, resource_id, reason)
     SELECT $1::uuid, $2, 'seed.completed', 'community', $1::uuid::text, 'Datos sintéticos iniciales'
     WHERE NOT EXISTS (
       SELECT 1 FROM audit_events WHERE community_id = $1::uuid AND action = 'seed.completed'
     )`,
    [communityId, userId]
  );

  await client.query("COMMIT");
  console.log(`✓ Datos iniciales preparados para ${email}`);
} catch (error) {
  await client.query("ROLLBACK");
  throw error;
} finally {
  client.release();
  await pool.end();
}
