import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { HomesView } from "@/components/HomesView";
import { getAuthContext } from "@/lib/auth";
import { listHomes } from "@/lib/homes";
import { isResidentRole } from "@/lib/permissions";

export const metadata: Metadata = { title: "Mi vivienda" };
export const dynamic = "force-dynamic";

export default async function MyHomePage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!isResidentRole(context.current.role)) redirect("/viviendas");
  return <HomesView initialHomes={await listHomes(context)} mode="resident" canDeclare={context.current.role === "owner"} />;
}
