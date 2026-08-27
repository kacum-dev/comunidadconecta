import type { NextRequest } from "next/server";
import { assertSameOrigin,handleApiError,noStoreJson,requireApiContext } from "@/lib/api";
import { closeMeeting } from "@/lib/governance";
interface RouteContext{params:Promise<{id:string}>}
export async function POST(request:NextRequest,route:RouteContext){try{assertSameOrigin(request);const context=await requireApiContext();const{id}=await route.params;return noStoreJson(await closeMeeting(context,id,request.headers.get("user-agent")));}catch(error){return handleApiError(error);}}
