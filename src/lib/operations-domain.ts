const transitions:Record<string,readonly string[]>={received:["triage"],triage:["assigned","blocked"],assigned:["scheduled","in_progress","blocked"],scheduled:["in_progress","blocked"],in_progress:["resolved","blocked"],blocked:["assigned","scheduled","in_progress"],resolved:["validated","in_progress"],validated:["closed","in_progress"],closed:[]};
export function canTransitionTicket(from:string,to:string){return transitions[from]?.includes(to)??false;}
export function assertTicketTransition(from:string,to:string){if(!canTransitionTicket(from,to))throw new Error(`No se puede pasar de ${from} a ${to}.`);}
export function notificationKey(sourceType:string,sourceId:string,event:string,userId:string){return [sourceType,sourceId,event,userId].join(":");}
export function nextNotificationAttempt(attempts:number,now=new Date()){const minutes=Math.min(24*60,Math.pow(2,Math.max(0,attempts))*5);return new Date(now.getTime()+minutes*60000);}
