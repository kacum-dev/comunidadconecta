import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { DashboardView } from "@/components/DashboardView";
import { getAuthContext } from "@/lib/auth";
import { getDashboardData } from "@/lib/dashboard";

export const metadata: Metadata = { title: "Inicio" };
export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const data = await getDashboardData(context);
  return <DashboardView context={context} data={data} />;
}
