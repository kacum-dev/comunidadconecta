import type { NextRequest } from "next/server";
import { assertSameOrigin,handleApiError,noStoreJson,requireApiContext } from "@/lib/api";
import { createAgreement } from "@/lib/governance";
interface RouteContext{params:Promise<{id:string}>}
export async function POST(request:NextRequest,route:RouteContext){try{assertSameOrigin(request);const context=await requireApiContext();const{id}=await route.params;return noStoreJson(await createAgreement(context,id,await request.json(),request.headers.get("user-agent")),{status:201});}catch(error){return handleApiError(error);}}
