import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { AccessView } from "@/components/AccessView";
import { listAccess } from "@/lib/access";
import { getAuthContext } from "@/lib/auth";
import { listHomeChoices } from "@/lib/homes";
import { canManageAccess, type Role } from "@/lib/permissions";

export const metadata: Metadata = { title: "Accesos y cargos" };
export const dynamic = "force-dynamic";

function rolesFor(role: Role): Role[] {
  if (role === "platform_admin") return ["owner","resident","president","vice_president","secretary","treasurer","administrator","supplier","auditor","support"];
  if (role === "president") return ["owner","resident","vice_president","secretary","treasurer","administrator","supplier","auditor"];
  return ["owner","resident","supplier","auditor"];
}

export default async function AccessPage() {
  const context = await getAuthContext();
  if (!context) redirect("/login");
  if (!canManageAccess(context.current.role) || context.isDemo) redirect("/inicio");
  const [access, homes] = await Promise.all([listAccess(context), listHomeChoices(context)]);
  return <AccessView initialAccess={access} homes={homes} assignableRoles={rolesFor(context.current.role)} />;
}
