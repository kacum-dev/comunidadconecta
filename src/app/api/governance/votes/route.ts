import type { NextRequest } from "next/server";
import { assertSameOrigin,handleApiError,noStoreJson,requireApiContext } from "@/lib/api";
import { castVote } from "@/lib/governance";
export async function POST(request:NextRequest){try{assertSameOrigin(request);const context=await requireApiContext();return noStoreJson(await castVote(context,await request.json(),request.headers.get("user-agent")));}catch(error){return handleApiError(error);}}