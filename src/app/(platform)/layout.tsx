import type { ReactNode } from "react";
import { redirect } from "next/navigation";
import { PlatformShell } from "@/components/PlatformShell";
import { getAuthContext } from "@/lib/auth";

export const dynamic = "force-dynamic";

export default async function AuthenticatedLayout({ children }: { children: ReactNode }) {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  return <PlatformShell context={context}>{children}</PlatformShell>;
}

