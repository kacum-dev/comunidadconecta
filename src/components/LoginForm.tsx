"use client";

import { useEffect, useState, type FormEvent } from "react";
import { useRouter } from "next/navigation";
import type { DemoRole, PublicDemoConfig } from "@/lib/demo-types";
import { Icon } from "./Icon";

export function LoginForm({ demo, initialDemoOpen = false }: { demo: PublicDemoConfig | null; initialDemoOpen?: boolean }) {
  const router = useRouter();
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);
  const [demoOpen, setDemoOpen] = useState(initialDemoOpen && Boolean(demo));
  const [demoCode, setDemoCode] = useState("");
  const [demoError, setDemoError] = useState("");
  const [demoLoadingRole, setDemoLoadingRole] = useState<DemoRole | null>(null);

  useEffect(() => {
    if (!demoOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    const close = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !demoLoadingRole) setDemoOpen(false);
    };
    window.addEventListener("keydown", close);
    return () => {
      document.body.style.overflow = previous;
      window.removeEventListener("keydown", close);
    };
  }, [demoLoadingRole, demoOpen]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError("");
    setLoading(true);
    try {
      const response = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ email, password })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se ha podido iniciar sesión.");
      router.replace("/inicio");
      router.refresh();
    } catch (submitError) {
      setError(submitError instanceof Error ? submitError.message : "No se ha podido iniciar sesión.");
    } finally {
      setLoading(false);
    }
  }

  async function enterDemo(role: DemoRole) {
    if (demo?.requiresAccessCode && !demoCode.trim()) {
      setDemoError("Introduce el código de acceso facilitado para esta demo.");
      return;
    }
    setDemoError("");
    setDemoLoadingRole(role);
    try {
      const response = await fetch("/api/demo/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ role, accessCode: demoCode })
      });
      const result = await response.json();
      if (!response.ok) throw new Error(result.error || "No se ha podido abrir la demostración.");
      router.replace("/inicio");
      router.refresh();
    } catch (demoSubmitError) {
      setDemoError(demoSubmitError instanceof Error ? demoSubmitError.message : "No se ha podido abrir la demostración.");
      setDemoLoadingRole(null);
    }
  }

  return (
    <>
      <form className="login-form" onSubmit={submit} noValidate>
        <div className="field-group">
          <label htmlFor="email">Correo electrónico</label>
          <input id="email" name="email" type="email" autoComplete="username" placeholder="tu@comunidad.es" value={email} onChange={(event) => setEmail(event.target.value)} required autoFocus />
        </div>
        <div className="field-group">
          <div className="label-row">
            <label htmlFor="password">Contraseña</label>
            <button className="text-button" type="button" onClick={() => setError("Contacta con la presidencia o la administración para recuperar el acceso de forma verificada.")}>¿Necesitas ayuda?</button>
          </div>
          <input id="password" name="password" type="password" autoComplete="current-password" placeholder="Tu contraseña" value={password} onChange={(event) => setPassword(event.target.value)} required />
        </div>
        {error && <div className="form-alert" role="alert">{error}</div>}
        <button className="button button-primary login-submit" type="submit" disabled={loading}>
          {loading ? <span className="spinner" /> : <Icon name="shield-check" size={18} />}
          {loading ? "Comprobando…" : "Entrar de forma segura"}
        </button>
        <p className="login-security"><Icon name="shield-check" size={15} /> Sesión privada, revocable y limitada a tus comunidades.</p>
      </form>

      {demo && <div className="demo-login-entry">
        <span><i /> o prueba la plataforma <i /></span>
        <button className="button demo-login-button" type="button" onClick={() => { setDemoError(""); setDemoOpen(true); }}>
          <Icon name="sparkles" size={18} /> Entrar en la demo
        </button>
        <small>Datos ficticios · elige el perfil que quieres explorar</small>
      </div>}

      {demo && demoOpen && <div className="modal-backdrop demo-login-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !demoLoadingRole) setDemoOpen(false); }}>
        <section className="demo-login-dialog" role="dialog" aria-modal="true" aria-labelledby="demo-login-title" aria-describedby="demo-login-description">
          <header>
            <div><span className="eyebrow">ENTORNO DE DEMOSTRACIÓN</span><h2 id="demo-login-title">{demo.title}</h2><p id="demo-login-description">{demo.description}</p></div>
            <button className="icon-button" type="button" onClick={() => setDemoOpen(false)} disabled={Boolean(demoLoadingRole)} aria-label="Cerrar"><Icon name="close" /></button>
          </header>
          <div className="demo-login-community"><span><Icon name="building" size={20} /></span><span><strong>{demo.communityName}</strong><small>Comunidad ficticia preparada para probar la aplicación</small></span></div>
          {demo.requiresAccessCode && <div className="field-group demo-access-code"><label htmlFor="demo-access-code">Código de acceso a la demo</label><input id="demo-access-code" type="password" autoComplete="off" value={demoCode} onChange={(event) => setDemoCode(event.target.value)} placeholder="Código facilitado por Comunidad Conecta" /></div>}
          <div className="demo-profile-heading"><strong>¿Con qué perfil quieres entrar?</strong><small>Cada perfil aplica sus permisos y muestra su propio espacio.</small></div>
          <div className="demo-profile-grid">
            {demo.profiles.map((profile) => <button key={profile.role} type="button" onClick={() => void enterDemo(profile.role)} disabled={Boolean(demoLoadingRole)}>
              <span><Icon name={profile.icon} size={21} /></span>
              <span><strong>{profile.label}</strong><small>{profile.description}</small></span>
              <b aria-hidden>{demoLoadingRole === profile.role ? <span className="spinner" /> : "→"}</b>
            </button>)}
          </div>
          {demoError && <div className="form-alert" role="alert">{demoError}</div>}
          <footer><Icon name="shield-check" size={16} /><span><strong>Entorno separado de las comunidades reales</strong><small>Utiliza únicamente datos de ejemplo durante la prueba.</small></span></footer>
        </section>
      </div>}
    </>
  );
}
