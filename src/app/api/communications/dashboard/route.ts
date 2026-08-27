import { handleApiError, noStoreJson, requireApiContext } from "@/lib/api";
import { assertCommunicationFeatureEnabled } from "@/lib/communication-feature";
import { getCommunicationInbox } from "@/lib/communications";

export async function GET() {
  try {
    const context = await requireApiContext();
    await assertCommunicationFeatureEnabled(context);
    return noStoreJson(await getCommunicationInbox(context));
  } catch (error) {
    return handleApiError(error);
  }
}
