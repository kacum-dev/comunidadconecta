import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CommunicationFeatureSettings } from "@/components/CommunicationFeatureSettings";
import { ProductControlSettings } from "@/components/ProductControlSettings";
import { SettingsView } from "@/components/SettingsView";
import { getAuthContext } from "@/lib/auth";
import { getCommunicationFeature } from "@/lib/communication-feature";
import { canManageSettings } from "@/lib/permissions";
import { getProductControlState } from "@/lib/product-control";
import { getSettings } from "@/lib/settings";

export const metadata: Metadata = { title: "Configuración" };
export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!canManageSettings(context.current.role) || context.isDemo) redirect("/inicio");
  const [settings, communications, productControl] = await Promise.all([
    getSettings(context),
    getCommunicationFeature(context),
    getProductControlState()
  ]);
  return <>
    <ProductControlSettings initialState={productControl} />
    <CommunicationFeatureSettings initialEnabled={communications.enabled} />
    <SettingsView initialSettings={settings} />
  </>;
}
