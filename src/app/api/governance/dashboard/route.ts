import type { NextRequest } from "next/server";
import { handleApiError,noStoreJson,requireApiContext } from "@/lib/api";
import { getGovernanceWorkspace } from "@/lib/governance";
export const dynamic="force-dynamic";
export async function GET(request:NextRequest){try{const context=await requireApiContext();return noStoreJson(await getGovernanceWorkspace(context,request.nextUrl.searchParams.get("meetingId")||undefined));}catch(error){return handleApiError(error);}}
