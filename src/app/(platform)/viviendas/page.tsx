import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HomesView } from "@/components/HomesView";
import { getAuthContext } from "@/lib/auth";
import { listHomeDirectory } from "@/lib/homes";
import { canManageHomes } from "@/lib/permissions";

export const metadata: Metadata = { title: "Viviendas" };
export const dynamic = "force-dynamic";

export default async function HomesPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!canManageHomes(context.current.role)) redirect("/mi-vivienda");
  return <HomesView initialHomes={[]} initialDirectory={await listHomeDirectory(context)} mode="manager" />;
}
