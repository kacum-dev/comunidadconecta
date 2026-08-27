import type { NextRequest } from "next/server";
import { assertSameOrigin,handleApiError,noStoreJson,requireApiContext } from "@/lib/api";
import { initializeAttendance,setAttendance } from "@/lib/governance";
interface RouteContext{params:Promise<{id:string}>}
export async function POST(request:NextRequest,route:RouteContext){try{assertSameOrigin(request);const context=await requireApiContext();const{id}=await route.params;return noStoreJson(await initializeAttendance(context,id,request.headers.get("user-agent")));}catch(error){return handleApiError(error);}}
export async function PATCH(request:NextRequest,route:RouteContext){try{assertSameOrigin(request);const context=await requireApiContext();const{id}=await route.params;return noStoreJson(await setAttendance(context,id,await request.json(),request.headers.get("user-agent")));}catch(error){return handleApiError(error);}}
