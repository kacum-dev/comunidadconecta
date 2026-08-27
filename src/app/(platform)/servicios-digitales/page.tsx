import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DigitalServicesView } from "@/components/DigitalServicesView";
import { getAuthContext } from "@/lib/auth";
import { canManageSettings } from "@/lib/permissions";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Servicios digitales" };
export const dynamic = "force-dynamic";

export default async function DigitalServicesPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!canManageSettings(context.current.role)) redirect("/inicio");
  const settings = await getSettings(context);
  return <DigitalServicesView integrations={settings.integrations} />;
}
