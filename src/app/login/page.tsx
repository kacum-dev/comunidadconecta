import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { Icon } from "@/components/Icon";
import { LoginForm } from "@/components/LoginForm";
import { getAuthContext } from "@/lib/auth";
import { getPublicDemoConfig } from "@/lib/demo";

export const metadata: Metadata = { title: "Acceso" };
export const dynamic = "force-dynamic";

export default async function LoginPage({ searchParams }: { searchParams: Promise<{ demo?: string | string[] }> }) {
  const context = await getAuthContext();
  if (context) redirect("/inicio");
  const demo = await getPublicDemoConfig();
  const requestedDemo = (await searchParams).demo === "1";

  return (
    <main className="login-page">
      <section className="login-story" aria-label="Presentación de Comunidad Conecta">
        <div className="story-content">
          <div className="login-brand"><span className="brand-mark inverse"><Icon name="building" /></span><span>Comunidad <strong>Conecta</strong></span></div>
          <span className="story-eyebrow">LA COMUNIDAD PERMANECE</span>
          <h1>Todo lo importante de tu comunidad, siempre contigo.</h1>
          <p>Economía comprensible, acuerdos trazables, incidencias claras y una memoria digital que no desaparece cuando cambia el administrador.</p>
          <div className="trust-list">
            <span><Icon name="shield-check" /> Datos separados y acceso por permisos</span>
            <span><Icon name="refresh-cw" /> Continuidad al cambiar de profesional</span>
            <span><Icon name="users" /> Diseñado para vecinos y administración</span>
          </div>
        </div>
        <div className="story-orb orb-one" /><div className="story-orb orb-two" />
      </section>
      <section className="login-panel">
        <div className="login-card">
          <span className="eyebrow">ACCESO PRIVADO</span>
          <h2>Te damos la bienvenida</h2>
          <p>Entra con la cuenta vinculada a tu comunidad.</p>
          <LoginForm demo={demo} initialDemoOpen={requestedDemo} />
        </div>
        <p className="login-legal">Al acceder aceptas las condiciones del servicio y la política de privacidad aplicables a tu comunidad.</p>
      </section>
    </main>
  );
}
