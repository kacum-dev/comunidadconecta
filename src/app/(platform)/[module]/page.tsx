import type { Metadata } from "next";
import Link from "next/link";
import { notFound, redirect } from "next/navigation";
import { DataWorkbench } from "@/components/DataWorkbench";
import { FinanceWorkspace } from "@/components/FinanceWorkspace";
import { GovernanceWorkspace } from "@/components/GovernanceWorkspace";
import { OperationsWorkspace } from "@/components/OperationsWorkspace";
import { ReservationWorkspace } from "@/components/ReservationWorkspace";
import { PrivacyWorkspace } from "@/components/PrivacyWorkspace";
import { TransitionWorkspace } from "@/components/TransitionWorkspace";
import { CommunicationWorkspace } from "@/components/CommunicationWorkspace";
import { Icon } from "@/components/Icon";
import { getAuthContext } from "@/lib/auth";
import { getCommunicationFeature } from "@/lib/communication-feature";
import { isModuleKey, moduleDefinitions } from "@/lib/modules";
import { can, isResidentRole } from "@/lib/permissions";

interface PageProps {
  params: Promise<{ module: string }>;
  searchParams: Promise<{ view?: string; new?: string }>;
}

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: PageProps): Promise<Metadata> {
  const { module } = await params;
  return { title: isModuleKey(module) ? moduleDefinitions[module].title : "No encontrado" };
}

export default async function ModulePage({ params, searchParams }: PageProps) {
  const { module } = await params;
  const { view, new: createRequested } = await searchParams;
  if (!isModuleKey(module)) notFound();
  const context = await getAuthContext();
  if (!context) redirect("/login");
  const definition = moduleDefinitions[module];
  if (!can(context.current.role, module, "read")) {
    return <div className="page access-denied"><span><Icon name="shield-check" /></span><h1>Acceso limitado</h1><p>Tu función en esta comunidad no permite consultar {definition.title.toLowerCase()}.</p><Link className="button button-primary" href="/inicio">Volver al inicio</Link></div>;
  }
  const resident = isResidentRole(context.current.role);
  if (createRequested === "1") {
    return <DataWorkbench definition={definition} residentMode={resident} permissions={{ write: can(context.current.role, module, "write"), archive: can(context.current.role, module, "archive"), export: can(context.current.role, module, "export") }} />;
  }
  if (module === "privacidad" && view !== "records") {
    return <PrivacyWorkspace />;
  }
  if (module === "reservas" && view !== "records") {
    return <ReservationWorkspace canWrite={can(context.current.role, "reservas", "write")} />;
  }
  if (module === "transicion" && view !== "records") {
    return <TransitionWorkspace />;
  }
  if (module === "incidencias" && view !== "records") {
    return <OperationsWorkspace canWrite={can(context.current.role, "incidencias", "write") && !resident} canAddEvidence={can(context.current.role, "incidencias", "write")} />;
  }
  if (module === "avisos" && view !== "records" && (resident || can(context.current.role, "avisos", "write"))) {
    const communications = await getCommunicationFeature(context);
    if (communications.enabled) {
      return <CommunicationWorkspace residentMode={resident} canManage={can(context.current.role, "avisos", "write") && !resident} />;
    }
  }
  if (!resident && module === "juntas" && view !== "records") {
    return <GovernanceWorkspace canWrite={can(context.current.role, "juntas", "write")} />;
  }
  if (!resident && (module === "economia" || module === "bancos")) {
    return <FinanceWorkspace canWrite={can(context.current.role, "bancos", "write")} definition={definition} showRecords={view === "records"} />;
  }
  return <DataWorkbench definition={definition} residentMode={resident} permissions={{ write: can(context.current.role, module, "write"), archive: can(context.current.role, module, "archive"), export: can(context.current.role, module, "export") }} />;
}
