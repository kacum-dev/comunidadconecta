import "server-only";

import { ApiError } from "./api";
import { writeAudit } from "./audit";
import type { AuthContext } from "./auth";
import { withTenant } from "./db";
import { calculateVoteResult, quorum, type VoteChoice, type VotingRule } from "./governance-domain";
import { getMeetingLifecycleBatch, lifecycleSummary, residentSafeLifecycle } from "./governance-lifecycle";
import { legalMilestoneKeys, type LegalMilestoneKey } from "./governance-lifecycle-domain";
import type { GovernanceWorkspaceDTO, MeetingLifecycleDTO } from "./governance-types";
import { can, isResidentRole } from "./permissions";
import { precisionForLocalDateTime, zonedLocalDateTimeToIso } from "./temporal";

const uuid=(value:string)=>/^[0-9a-f-]{36}$/i.test(value);
const instant=(value:Date|string|null)=>value?(value instanceof Date?value.toISOString():String(value)):null;
function assertRead(context:AuthContext){if(!can(context.current.role,"juntas","read"))throw new ApiError(403,"No puedes consultar juntas.","forbidden");}
function assertWrite(context:AuthContext){if(!can(context.current.role,"juntas","write"))throw new ApiError(403,"No puedes gestionar esta junta.","forbidden");}

export async function getGovernanceWorkspace(context:AuthContext,meetingId?:string):Promise<GovernanceWorkspaceDTO>{
  assertRead(context);
  return withTenant(context.current.communityId,context.user.id,async(client)=>{
    const meetings=await client.query<{id:string;title:string;code:string|null;status:string;kind:string;event_at:Date|null;event_time_precision:"day"|"minute"|"second"|null;location:string|null;description:string|null;version:number}>(
      `SELECT id::text,title,code,status,kind,event_at,event_time_precision,location,description,version FROM meetings
        WHERE community_id=$1 AND archived_at IS NULL ORDER BY event_at DESC NULLS LAST,created_at DESC LIMIT 100`,
      [context.current.communityId]
    );
    const lifecycleByMeeting=await getMeetingLifecycleBatch(client,context.current.communityId,meetings.rows.map(row=>row.id),context.current.timeZone);
    const normalized=meetings.rows.map(row=>{const lifecycle=lifecycleByMeeting.get(row.id);return {id:row.id,title:row.title,code:row.code??"",status:row.status,kind:row.kind,
      eventDate:instant(row.event_at),eventTimePrecision:row.event_time_precision,location:row.location??"",description:row.description??"",version:row.version,
      lifecycleSummary:lifecycle?lifecycleSummary(lifecycle):{phaseLabel:"PreparaciÃ³n",overallStatus:"pending" as const,completed:0,total:10,progress:0,nextTitle:"Datos legales de la reuniÃ³n"}}});
    const selected=normalized.find(item=>item.id===meetingId)??normalized[0]??null;
    if(!selected)return {meetings:normalized,selected:null,agenda:[],attendance:[],votes:[],agreements:[],quorum:{units:0,coefficient:0},lifecycle:null};
    const [agenda,attendance,votes,agreements]=await Promise.all([
      client.query<{id:string;position:number;title:string;proposal:string;voting_rule:string;qualified_threshold:number|null;status:string;result:unknown}>(
        "SELECT id::text,position,title,proposal,voting_rule,qualified_threshold,status,result FROM meeting_agenda_items WHERE community_id=$1 AND meeting_id=$2 ORDER BY position",[context.current.communityId,selected.id]),
      client.query<{id:string;unit_id:string;unit_code:string;owner_name:string|null;attendance_type:string;coefficient_snapshot:number}>(
        `SELECT a.id::text,a.unit_id::text,u.code AS unit_code,r.full_name AS owner_name,a.attendance_type,a.coefficient_snapshot
           FROM meeting_attendance a JOIN private_units u ON u.id=a.unit_id
           LEFT JOIN unit_relations r ON r.id=a.relation_id
          WHERE a.community_id=$1 AND a.meeting_id=$2 ORDER BY u.code`,[context.current.communityId,selected.id]),
      client.query<{id:string;agenda_item_id:string;unit_id:string;choice:VoteChoice;coefficient_snapshot:number}>(
        `SELECT id::text,agenda_item_id::text,unit_id::text,choice,coefficient_snapshot FROM meeting_votes
          WHERE community_id=$1 AND agenda_item_id IN(SELECT id FROM meeting_agenda_items WHERE meeting_id=$2 AND community_id=$1)`,
        [context.current.communityId,selected.id]),
      client.query<{id:string;agenda_item_id:string;title:string;description:string;responsible:string;due_at:Date|null;due_time_precision:"day"|"minute"|"second"|null;due_inclusive:boolean;status:string}>(
        "SELECT id::text,agenda_item_id::text,title,description,responsible,due_at,due_time_precision,due_inclusive,status FROM meeting_agreements WHERE community_id=$1 AND meeting_id=$2 ORDER BY created_at",
        [context.current.communityId,selected.id])
    ]);
    const attendanceRows=attendance.rows.map(row=>({id:row.id,unitId:row.unit_id,unitCode:row.unit_code,ownerName:row.owner_name??"Sin representante",
      attendanceType:row.attendance_type,coefficient:Number(row.coefficient_snapshot)}));
    const selectedLifecycle=lifecycleByMeeting.get(selected.id)??null;
    return {meetings:normalized,selected,
      agenda:agenda.rows.map(row=>({id:row.id,position:row.position,title:row.title,proposal:row.proposal,votingRule:row.voting_rule,
        qualifiedThreshold:row.qualified_threshold===null?null:Number(row.qualified_threshold),status:row.status,result:row.result})),
      attendance:attendanceRows,
      votes:votes.rows.map(row=>({id:row.id,agendaItemId:row.agenda_item_id,unitId:row.unit_id,choice:row.choice,coefficient:Number(row.coefficient_snapshot)})),
      agreements:agreements.rows.map(row=>({id:row.id,agendaItemId:row.agenda_item_id,title:row.title,description:row.description,
        responsible:row.responsible,dueDate:instant(row.due_at),dueTimePrecision:row.due_time_precision,dueInclusive:row.due_inclusive!==false,status:row.status})),
      quorum:quorum(attendanceRows.map(row=>({attendanceType:row.attendanceType,coefficient:row.coefficient}))),
      lifecycle:selectedLifecycle?(isResidentRole(context.current.role)?residentSafeLifecycle(selectedLifecycle):selectedLifecycle):null};
  });
}

export async function getMeetingLifecycle(context:AuthContext,meetingId:string):Promise<MeetingLifecycleDTO>{
  assertRead(context);
  if(!uuid(meetingId))throw new ApiError(400,"Junta no vÃ¡lida.","validation_error");
  return withTenant(context.current.communityId,context.user.id,async client=>{
    const map=await getMeetingLifecycleBatch(client,context.current.communityId,[meetingId],context.current.timeZone);
    const lifecycle=map.get(meetingId);
    if(!lifecycle)throw new ApiError(404,"La junta no existe.","not_found");
    return isResidentRole(context.current.role)?residentSafeLifecycle(lifecycle):lifecycle;
  });
}

export async function updateMeetingLegalProfile(context:AuthContext,meetingId:string,input:{convenerName?:string;sessionCall?:string;secondCallAt?:string|null;version?:number},userAgent?:string|null){
  assertWrite(context);
  if(!uuid(meetingId))throw new ApiError(400,"Junta no vÃ¡lida.","validation_error");
  const convenerName=String(input.convenerName??"").trim();
  const sessionCall=String(input.sessionCall??"");
  const expectedVersion=Number(input.version);
  if(convenerName.length<2||convenerName.length>200)throw new ApiError(400,"Indica quiÃ©n ha realizado la convocatoria.","validation_error");
  if(!["first","second","universal"].includes(sessionCall))throw new ApiError(400,"Indica si se celebrarÃ¡ en primera, segunda o convocatoria universal.","validation_error");
  if(!Number.isInteger(expectedVersion)||expectedVersion<1)throw new ApiError(400,"Falta la versiÃ³n actual de la junta.","validation_error");
  const secondInput=String(input.secondCallAt??"").trim();
  const secondCallAt=secondInput?zonedLocalDateTimeToIso(secondInput,context.current.timeZone):null;
  if(sessionCall==="second"&&!secondCallAt)throw new ApiError(400,"La segunda convocatoria necesita fecha y hora exactas.","validation_error");
  if(secondInput&&!secondCallAt)throw new ApiError(400,"La fecha de segunda convocatoria no es vÃ¡lida para la zona horaria de la comunidad.","validation_error");
  const precision=secondInput?precisionForLocalDateTime(secondInput):null;
  return withTenant(context.current.communityId,context.user.id,async client=>{
    const before=await client.query<{version:number;event_at:Date|null}>("SELECT version,event_at FROM meetings WHERE id=$1 AND community_id=$2 AND archived_at IS NULL FOR UPDATE",[meetingId,context.current.communityId]);
    if(!before.rowCount)throw new ApiError(404,"La junta no existe.","not_found");
    if(before.rows[0].version!==expectedVersion)throw new ApiError(409,"Otra persona ha modificado la junta. Actualiza el expediente.","version_conflict");
    if(secondCallAt&&before.rows[0].event_at&&new Date(secondCallAt).getTime()<new Date(before.rows[0].event_at).getTime()+30*60*1000){
      throw new ApiError(400,"La segunda convocatoria debe celebrarse al menos treinta minutos despuÃ©s de la primera.","validation_error");
    }
    await client.query(`UPDATE meetings SET convener_name=$3,session_call=$4,second_call_at=$5,second_call_time_precision=$6,version=version+1,updated_by=$7,updated_at=now() WHERE id=$1 AND community_id=$2`,
      [meetingId,context.current.communityId,convenerName,sessionCall,secondCallAt,precision,context.user.id]);
    await writeAudit(client,{communityId:context.current.communityId,userId:context.user.id,action:"juntas.legal_profile_updated",resourceType:"meeting",resourceId:meetingId,after:{convenerName,sessionCall,secondCallAt,timeZone:context.current.timeZone},userAgent});
    return {ok:true};
  });
}

function legalEventDependency(key:LegalMilestoneKey){
  return key==="notices_completed"?"call_issued":key==="minutes_closed"?"meeting_held":key==="minutes_notified"?"minutes_closed":key==="records_archived"?"minutes_notified":null;
}

export async function confirmMeetingMilestone(context:AuthContext,meetingId:string,key:string,input:{occurredAt?:string;evidenceReference?:string;note?:string;version?:number},userAgent?:string|null){
  assertWrite(context);
  if(!uuid(meetingId)||!legalMilestoneKeys.includes(key as LegalMilestoneKey))throw new ApiError(400,"Hito de junta no vÃ¡lido.","validation_error");
  const milestoneKey=key as LegalMilestoneKey;
  const occurredInput=String(input.occurredAt??"").trim();
  const occurredAt=zonedLocalDateTimeToIso(occurredInput,context.current.timeZone);
  const evidenceReference=String(input.evidenceReference??"").trim();
  const note=String(input.note??"").trim();
  const expectedVersion=Number(input.version??0);
  if(!occurredAt)throw new ApiError(400,"Indica la fecha y hora exactas del hito.","validation_error");
  if(evidenceReference.length<2||evidenceReference.length>200)throw new ApiError(400,"Indica una referencia de evidencia entre 2 y 200 caracteres.","validation_error");
  if(note.length>1000)throw new ApiError(400,"La observaciÃ³n no puede superar 1.000 caracteres.","validation_error");
  if(!Number.isInteger(expectedVersion)||expectedVersion<0)throw new ApiError(400,"La versiÃ³n del hito no es vÃ¡lida.","validation_error");
  const timePrecision=precisionForLocalDateTime(occurredInput)==="second"?"second":"minute";
  return withTenant(context.current.communityId,context.user.id,async client=>{
    const meeting=await client.query<{status:string;kind:string;event_at:Date|null;event_time_precision:string|null;location:string|null;convener_name:string|null;session_call:string;second_call_at:Date|null}>("SELECT status,kind,event_at,event_time_precision,location,convener_name,session_call,second_call_at FROM meetings WHERE id=$1 AND community_id=$2 AND archived_at IS NULL FOR UPDATE",[meetingId,context.current.communityId]);
    if(!meeting.rowCount)throw new ApiError(404,"La junta no existe.","not_found");
    const current=await client.query<{id:string;version:number}>("SELECT id::text,version FROM meeting_legal_events WHERE community_id=$1 AND meeting_id=$2 AND milestone_key=$3 FOR UPDATE",[context.current.communityId,meetingId,milestoneKey]);
    const currentVersion=current.rows[0]?.version??0;
    if(currentVersion!==expectedVersion)throw new ApiError(409,"Otra persona ha actualizado este hito. Recarga el expediente.","version_conflict");
    const dependency=legalEventDependency(milestoneKey);
    if(dependency){
      const exists=await client.query("SELECT 1 FROM meeting_legal_events WHERE community_id=$1 AND meeting_id=$2 AND milestone_key=$3",[context.current.communityId,meetingId,dependency]);
      if(!exists.rowCount)throw new ApiError(409,"Completa primero el hito anterior del expediente.","milestone_dependency");
    }
    if(milestoneKey==="call_issued"){
      const agenda=await client.query<{count:number}>("SELECT count(*)::int AS count FROM meeting_agenda_items WHERE community_id=$1 AND meeting_id=$2",[context.current.communityId,meetingId]);
      if(!meeting.rows[0].event_at||!meeting.rows[0].event_time_precision||meeting.rows[0].event_time_precision==="day"||!meeting.rows[0].location||!meeting.rows[0].convener_name||(meeting.rows[0].session_call==="second"&&!meeting.rows[0].second_call_at)||agenda.rows[0].count===0)throw new ApiError(409,"Completa fecha y hora, lugar, datos legales y orden del dÃ­a antes de emitir la convocatoria.","milestone_dependency");
    }
    if(milestoneKey==="meeting_held"&&meeting.rows[0].session_call!=="universal"){
      const notices=await client.query("SELECT 1 FROM meeting_legal_events WHERE community_id=$1 AND meeting_id=$2 AND milestone_key='notices_completed'",[context.current.communityId,meetingId]);
      if(!notices.rowCount)throw new ApiError(409,"Registra primero las citaciones practicadas.","milestone_dependency");
    }
    if(milestoneKey==="minutes_closed"){
      const unresolved=await client.query<{count:number}>("SELECT count(*)::int AS count FROM meeting_agenda_items WHERE community_id=$1 AND meeting_id=$2 AND status NOT IN('approved','rejected')",[context.current.communityId,meetingId]);
      const missingAgreements=await client.query<{count:number}>(`SELECT count(*)::int AS count FROM meeting_agenda_items i LEFT JOIN meeting_agreements a ON a.agenda_item_id=i.id AND a.community_id=i.community_id WHERE i.community_id=$1 AND i.meeting_id=$2 AND i.status='approved' AND a.id IS NULL`,[context.current.communityId,meetingId]);
      const attendance=await client.query<{active:number;recorded:number}>(`SELECT (SELECT count(*)::int FROM private_units WHERE community_id=$1 AND status='active') AS active,(SELECT count(*)::int FROM meeting_attendance WHERE community_id=$1 AND meeting_id=$2) AS recorded`,[context.current.communityId,meetingId]);
      if(unresolved.rows[0].count||missingAgreements.rows[0].count||attendance.rows[0].active!==attendance.rows[0].recorded)throw new ApiError(409,"Completa asistencia, resultados y acuerdos antes de cerrar el acta.","milestone_dependency");
    }
    if(current.rowCount){
      await client.query(`UPDATE meeting_legal_events SET occurred_at=$4,time_precision=$5,evidence_reference=$6,note=$7,confirmed_by=$8,version=version+1,updated_at=now() WHERE community_id=$1 AND meeting_id=$2 AND milestone_key=$3`,
        [context.current.communityId,meetingId,milestoneKey,occurredAt,timePrecision,evidenceReference,note||null,context.user.id]);
    }else{
      await client.query(`INSERT INTO meeting_legal_events(community_id,meeting_id,milestone_key,occurred_at,time_precision,evidence_reference,note,confirmed_by) VALUES($1,$2,$3,$4,$5,$6,$7,$8)`,
        [context.current.communityId,meetingId,milestoneKey,occurredAt,timePrecision,evidenceReference,note||null,context.user.id]);
    }
    const status=milestoneKey==="call_issued"?"called":milestoneKey==="meeting_held"?"review":milestoneKey==="minutes_closed"?"closed":null;
    if(status){
      const eligible=status==="called"?["draft","called"]:status==="review"?["draft","called","in_progress","review"]:["draft","called","in_progress","review","closed"];
      await client.query("UPDATE meetings SET status=CASE WHEN status=ANY($5::text[]) THEN $3 ELSE status END,version=version+1,updated_by=$4,updated_at=now() WHERE id=$1 AND community_id=$2",[meetingId,context.current.communityId,status,context.user.id,eligible]);
    }
    await writeAudit(client,{communityId:context.current.communityId,userId:context.user.id,action:"juntas.milestone_confirmed",resourceType:"meeting",resourceId:meetingId,after:{milestoneKey,occurredAt,timePrecision,evidenceReference,version:currentVersion+1},userAgent});
    return {ok:true};
  });
}

export async function addAgendaItem(context:AuthContext,meetingId:string,input:{title?:string;proposal?:string;votingRule?:VotingRule;qualifiedThreshold?:number},userAgent?:string|null){
  assertWrite(context);if(!uuid(meetingId))throw new ApiError(400,"Junta no válida.","validation_error");
  const title=String(input.title??"").trim(),proposal=String(input.proposal??"").trim();
  if(title.length<3||proposal.length<3)throw new ApiError(400,"Completa el título y la propuesta.","validation_error");
  const rule=input.votingRule??"simple_majority";
  if(!["simple_majority","qualified_majority","unanimity"].includes(rule))throw new ApiError(400,"Regla de votación no válida.","validation_error");
  const threshold=rule==="qualified_majority"?Number(input.qualifiedThreshold??66.67):null;
  if(rule==="qualified_majority"&&(threshold===null||!Number.isFinite(threshold)||threshold<50||threshold>100))throw new ApiError(400,"El umbral debe estar entre el 50% y el 100%.","validation_error");
  return withTenant(context.current.communityId,context.user.id,async client=>{
    const meeting=await client.query("SELECT 1 FROM meetings WHERE id=$1 AND community_id=$2 AND status IN('draft','called') FOR UPDATE",[meetingId,context.current.communityId]);
    if(!meeting.rowCount)throw new ApiError(409,"Solo se puede editar el orden del día antes de iniciar la junta.","invalid_state");
    const result=await client.query<{id:string}>(
      `INSERT INTO meeting_agenda_items(community_id,meeting_id,position,title,proposal,voting_rule,qualified_threshold,created_by,updated_by)
       VALUES($1,$2,(SELECT COALESCE(max(position),0)+1 FROM meeting_agenda_items WHERE community_id=$1 AND meeting_id=$2),$3,$4,$5,$6,$7,$7) RETURNING id::text`,
      [context.current.communityId,meetingId,title,proposal,rule,threshold,context.user.id]);
    await writeAudit(client,{communityId:context.current.communityId,userId:context.user.id,action:"juntas.agenda_added",resourceType:"meeting",resourceId:meetingId,after:{agendaItemId:result.rows[0].id,title,rule},userAgent});
    return result.rows[0];
  });
}

export async function initializeAttendance(context:AuthContext,meetingId:string,userAgent?:string|null){
  assertWrite(context);if(!uuid(meetingId))throw new ApiError(400,"Junta no válida.","validation_error");
  return withTenant(context.current.communityId,context.user.id,async client=>{
    const meeting=await client.query("SELECT status FROM meetings WHERE id=$1 AND community_id=$2 FOR UPDATE",[meetingId,context.current.communityId]);
    if(!meeting.rowCount)throw new ApiError(404,"La junta no existe.","not_found");
    if(!["draft","called"].includes(String(meeting.rows[0].status)))throw new ApiError(409,"La asistencia no puede reiniciarse en una junta cerrada.","invalid_state");
    const inserted=await client.query(
      `INSERT INTO meeting_attendance(community_id,meeting_id,unit_id,relation_id,attendance_type,coefficient_snapshot)
       SELECT u.community_id,$2,u.id,r.id,'absent',u.participation_coefficient
         FROM private_units u LEFT JOIN LATERAL(
           SELECT id FROM unit_relations WHERE community_id=u.community_id AND unit_id=u.id AND relation_type IN('owner','co_owner')
             AND status='active' AND can_vote=true AND valid_from<=current_date AND(valid_to IS NULL OR valid_to>=current_date)
           ORDER BY is_primary DESC,ownership_percentage DESC NULLS LAST LIMIT 1
         )r ON true
        WHERE u.community_id=$1 AND u.status='active'
       ON CONFLICT(meeting_id,unit_id)DO NOTHING`,
      [context.current.communityId,meetingId]);
    await client.query("UPDATE meetings SET status=CASE WHEN status='draft' THEN 'called' ELSE status END,version=version+1,updated_by=$3 WHERE id=$1 AND community_id=$2",[meetingId,context.current.communityId,context.user.id]);
    await writeAudit(client,{communityId:context.current.communityId,userId:context.user.id,action:"juntas.attendance_initialized",resourceType:"meeting",resourceId:meetingId,after:{units:inserted.rowCount},userAgent});
    return {units:inserted.rowCount};
  });
}

export async function setAttendance(context:AuthContext,meetingId:string,input:{unitId?:string;attendanceType?:string;representationNote?:string},userAgent?:string|null){
  assertWrite(context);if(!uuid(meetingId)||!uuid(String(input.unitId)))throw new ApiError(400,"Datos no válidos.","validation_error");
  if(!["present","represented","absent"].includes(String(input.attendanceType)))throw new ApiError(400,"Asistencia no válida.","validation_error");
  return withTenant(context.current.communityId,context.user.id,async client=>{
    const meeting=await client.query<{status:string}>("SELECT status FROM meetings WHERE id=$1 AND community_id=$2 FOR UPDATE",[meetingId,context.current.communityId]);
    if(!meeting.rowCount)throw new ApiError(404,"La junta no existe.","not_found");
    if(!["draft","called"].includes(meeting.rows[0].status))throw new ApiError(409,"La asistencia de una junta cerrada no se puede modificar.","invalid_state");
    const result=await client.query(
      `UPDATE meeting_attendance SET attendance_type=$4,representation_note=$5,verified_by=$6,verified_at=now()
        WHERE community_id=$1 AND meeting_id=$2 AND unit_id=$3`,
      [context.current.communityId,meetingId,input.unitId,input.attendanceType,String(input.representationNote??"").trim().slice(0,500)||null,context.user.id]);
    if(!result.rowCount)throw new ApiError(404,"La unidad no está en el censo de la junta.","not_found");
    await writeAudit(client,{communityId:context.current.communityId,userId:context.user.id,action:"juntas.attendance_updated",resourceType:"meeting",resourceId:meetingId,after:{unitId:input.unitId,attendanceType:input.attendanceType},userAgent});
    return {ok:true};
  });
}

export async function castVote(context:AuthContext,input:{agendaItemId?:string;unitId?:string;choice?:VoteChoice},userAgent?:string|null){
  if(!can(context.current.role,"juntas","write")&&!isResidentRole(context.current.role))throw new ApiError(403,"No puedes registrar este voto.","forbidden");
  if(!uuid(String(input.agendaItemId))||!uuid(String(input.unitId))||!["yes","no","abstain"].includes(String(input.choice)))throw new ApiError(400,"Voto no válido.","validation_error");
  return withTenant(context.current.communityId,context.user.id,async client=>{
    const item=await client.query<{voting_rule:VotingRule;qualified_threshold:number|null;meeting_status:string}>(`SELECT i.voting_rule,i.qualified_threshold,m.status AS meeting_status
      FROM meeting_agenda_items i JOIN meetings m ON m.id=i.meeting_id AND m.community_id=i.community_id
      WHERE i.id=$1 AND i.community_id=$2 FOR UPDATE OF i,m`,[input.agendaItemId,context.current.communityId]);
    if(!item.rowCount)throw new ApiError(404,"El punto del orden del día no existe.","not_found");
    if(item.rows[0].meeting_status!=="called")throw new ApiError(409,"Solo se puede votar mientras la junta está convocada y abierta.","invalid_state");
    if(isResidentRole(context.current.role)){
      const own=await client.query("SELECT 1 FROM unit_relations WHERE community_id=$1 AND unit_id=$2 AND user_id=$3 AND status='active' AND can_vote=true AND valid_from<=current_date AND(valid_to IS NULL OR valid_to>=current_date)",[context.current.communityId,input.unitId,context.user.id]);
      if(!own.rowCount)throw new ApiError(403,"No puedes votar por esta unidad.","forbidden");
    }
    const attendance=await client.query<{coefficient_snapshot:number;attendance_type:string}>(
      `SELECT coefficient_snapshot,attendance_type FROM meeting_attendance WHERE community_id=$1 AND unit_id=$2 AND attendance_type<>'absent'
        AND meeting_id=(SELECT meeting_id FROM meeting_agenda_items WHERE id=$3 AND community_id=$1)`,
      [context.current.communityId,input.unitId,input.agendaItemId]);
    if(!attendance.rowCount)throw new ApiError(409,"La unidad debe constar como presente o representada.","attendance_required");
    if(isResidentRole(context.current.role)&&attendance.rows[0].attendance_type!=="present")throw new ApiError(403,"Una unidad representada debe votar a través de la persona representante.","represented_unit");
    await client.query(
      `INSERT INTO meeting_votes(community_id,agenda_item_id,unit_id,choice,coefficient_snapshot,cast_by)
       VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT(agenda_item_id,unit_id)DO UPDATE SET choice=EXCLUDED.choice,coefficient_snapshot=EXCLUDED.coefficient_snapshot,cast_by=EXCLUDED.cast_by,updated_at=now()`,
      [context.current.communityId,input.agendaItemId,input.unitId,input.choice,attendance.rows[0].coefficient_snapshot,context.user.id]);
    const votes=await client.query<{choice:VoteChoice;coefficient_snapshot:number}>("SELECT choice,coefficient_snapshot FROM meeting_votes WHERE agenda_item_id=$1 AND community_id=$2",[input.agendaItemId,context.current.communityId]);
    const result=calculateVoteResult(votes.rows.map(row=>({choice:row.choice,coefficient:Number(row.coefficient_snapshot)})),item.rows[0].voting_rule,Number(item.rows[0].qualified_threshold??60));
    await client.query("UPDATE meeting_agenda_items SET status=$3,result=$4::jsonb,updated_by=$5,updated_at=now() WHERE id=$1 AND community_id=$2",[input.agendaItemId,context.current.communityId,result.status,JSON.stringify(result),context.user.id]);
    await writeAudit(client,{communityId:context.current.communityId,userId:context.user.id,action:"juntas.vote_recorded",resourceType:"meeting_agenda_item",resourceId:input.agendaItemId,after:{unitId:input.unitId,choice:input.choice,result},userAgent});
    return result;
  });
}

export async function closeMeeting(context:AuthContext,meetingId:string,userAgent?:string|null){
  assertWrite(context);if(!uuid(meetingId))throw new ApiError(400,"Junta no válida.","validation_error");
  return withTenant(context.current.communityId,context.user.id,async client=>{
    const meeting=await client.query("SELECT status FROM meetings WHERE id=$1 AND community_id=$2 FOR UPDATE",[meetingId,context.current.communityId]);
    if(!meeting.rowCount)throw new ApiError(404,"La junta no existe.","not_found");
    if(meeting.rows[0].status==="closed")return {status:"closed"};
    const pending=await client.query<{count:number}>("SELECT count(*)::int AS count FROM meeting_agenda_items WHERE community_id=$1 AND meeting_id=$2 AND status IN('pending','open','tied')",[context.current.communityId,meetingId]);
    if(pending.rows[0].count)throw new ApiError(409,"No se puede cerrar: quedan puntos sin resultado definitivo.","agenda_pending");
    const missingAgreement=await client.query<{count:number}>(
      `SELECT count(*)::int AS count FROM meeting_agenda_items i LEFT JOIN meeting_agreements a ON a.agenda_item_id=i.id AND a.community_id=i.community_id
        WHERE i.community_id=$1 AND i.meeting_id=$2 AND i.status='approved' AND a.id IS NULL`,[context.current.communityId,meetingId]);
    if(missingAgreement.rows[0].count)throw new ApiError(409,"Cada punto aprobado necesita un acuerdo con responsable antes del cierre.","agreement_required");
    const minutes=await client.query("SELECT 1 FROM meeting_legal_events WHERE community_id=$1 AND meeting_id=$2 AND milestone_key='minutes_closed'",[context.current.communityId,meetingId]);
    if(!minutes.rowCount)throw new ApiError(409,"Registra primero el acta firmada y cerrada en el ciclo de la junta.","minutes_required");
    await client.query("UPDATE meetings SET status='closed',version=version+1,updated_by=$3 WHERE id=$1 AND community_id=$2",[meetingId,context.current.communityId,context.user.id]);
    await writeAudit(client,{communityId:context.current.communityId,userId:context.user.id,action:"juntas.closed",resourceType:"meeting",resourceId:meetingId,after:{status:"closed"},userAgent});
    return {status:"closed"};
  });
}


export async function createAgreement(context:AuthContext,meetingId:string,input:{agendaItemId?:string;title?:string;description?:string;responsible?:string;dueDate?:string},userAgent?:string|null){
  assertWrite(context);
  if(!uuid(meetingId)||!uuid(String(input.agendaItemId)))throw new ApiError(400,"Datos no válidos.","validation_error");
  const title=String(input.title??"").trim(),description=String(input.description??"").trim(),responsible=String(input.responsible??"").trim();
  if(title.length<3||description.length<3||responsible.length<2)throw new ApiError(400,"Completa el acuerdo y su responsable.","validation_error");
  const dueInput=String(input.dueDate??"").trim();
  const dueDate=dueInput?zonedLocalDateTimeToIso(dueInput,context.current.timeZone):null;
  if(dueInput&&!dueDate)throw new ApiError(400,"La fecha y hora objetivo no son válidas para la zona horaria de la comunidad.","validation_error");
  if(dueDate&&new Date(dueDate).getTime()<=Date.now())throw new ApiError(400,"La fecha y hora objetivo debe estar en el futuro.","validation_error");
  const duePrecision=dueInput?precisionForLocalDateTime(dueInput):null;
  return withTenant(context.current.communityId,context.user.id,async client=>{
    const item=await client.query(`SELECT 1 FROM meeting_agenda_items i JOIN meetings m ON m.id=i.meeting_id AND m.community_id=i.community_id
      WHERE i.id=$1 AND i.meeting_id=$2 AND i.community_id=$3 AND i.status='approved' AND m.status<>'closed'`,[input.agendaItemId,meetingId,context.current.communityId]);
    if(!item.rowCount)throw new ApiError(409,"Solo se crean acuerdos para puntos aprobados.","invalid_state");
    const result=await client.query<{id:string}>(
      `INSERT INTO meeting_agreements(community_id,meeting_id,agenda_item_id,title,description,responsible,due_at,due_time_precision,due_inclusive,created_by,updated_by)
       VALUES($1,$2,$3,$4,$5,$6,$7,$8,true,$9,$9)
       ON CONFLICT(agenda_item_id)DO UPDATE SET title=EXCLUDED.title,description=EXCLUDED.description,responsible=EXCLUDED.responsible,due_at=EXCLUDED.due_at,due_time_precision=EXCLUDED.due_time_precision,due_inclusive=true,updated_by=EXCLUDED.updated_by,updated_at=now()
       RETURNING id::text`,
      [context.current.communityId,meetingId,input.agendaItemId,title,description,responsible,dueDate,duePrecision,context.user.id]);
    await writeAudit(client,{communityId:context.current.communityId,userId:context.user.id,action:"juntas.agreement_saved",resourceType:"meeting_agreement",resourceId:result.rows[0].id,after:{meetingId,agendaItemId:input.agendaItemId,title,responsible,dueAt:dueDate,duePrecision,dueInclusive:true,timeZone:context.current.timeZone},userAgent});
    return result.rows[0];
  });
}
