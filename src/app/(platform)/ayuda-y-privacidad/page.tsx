import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ResidentPrivacyView } from "@/components/ResidentPrivacyView";
import { getAuthContext } from "@/lib/auth";
import { isResidentRole } from "@/lib/permissions";
import { getResidentPrivacy } from "@/lib/resident-privacy";

export const metadata: Metadata = { title: "Ayuda y privacidad" };
export const dynamic = "force-dynamic";

export default async function ResidentPrivacyPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!isResidentRole(context.current.role)) redirect("/privacidad");
  const data = await getResidentPrivacy(context);
  return <ResidentPrivacyView
    initialData={data}
    initialSimpleMode={context.user.simpleMode}
    isDemo={context.isDemo}
    preferences={{ locale: context.current.locale, timeZone: context.current.timeZone, dateFormat: context.current.dateFormat, timeFormat: context.current.timeFormat }}
  />;
}
