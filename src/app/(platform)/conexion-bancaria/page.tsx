import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { BankConnectionWizard } from "@/components/BankConnectionWizard";
import { getAuthContext } from "@/lib/auth";
import { can } from "@/lib/permissions";

export const metadata: Metadata = { title: "Conectar banco" };
export const dynamic = "force-dynamic";

export default async function BankConnectionPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!can(context.current.role, "bancos", "write")) redirect("/economia");
  return <BankConnectionWizard />;
}
