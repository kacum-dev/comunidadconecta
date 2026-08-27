import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DemoSettingsView } from "@/components/DemoSettingsView";
import { getAuthContext } from "@/lib/auth";
import { getDemoAdminSettings } from "@/lib/demo";

export const metadata: Metadata = { title: "Modo demo" };
export const dynamic = "force-dynamic";

export default async function DemoSettingsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (context.current.role !== "platform_admin" || context.isDemo) redirect("/inicio");
  return <DemoSettingsView initialSettings={await getDemoAdminSettings(context)} />;
}
