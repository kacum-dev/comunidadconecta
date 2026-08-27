"use client";

import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname, useRouter } from "next/navigation";
import type { AuthContext } from "@/lib/auth";
import type { ModuleKey } from "@/lib/modules";
import { can, canManageAccess, canManageHomes, canManageSettings, isResidentRole, roleLabels, type Role } from "@/lib/permissions";
import type { WeatherSnapshot } from "@/lib/weather-domain";
import { formatDateTime } from "@/lib/temporal";
import { Icon } from "./Icon";
import { DemoTour } from "./DemoTour";
import { ProductControlHeartbeat } from "./ProductControlHeartbeat";
import { TemporalProvider } from "./TemporalContext";

type NavigationItem = {
  href: string;
  label: string;
  module?: ModuleKey;
  icon: string;
  settingsOnly?: boolean;
  platformOnly?: boolean;
  homesOnly?: boolean;
  accessOnly?: boolean;
  hasAlert?: boolean;
};

const adminPrimaryItems: NavigationItem[] = [
  { href: "/inicio", label: "Inicio", icon: "dashboard" },
  { href: "/economia", label: "Economía", module: "economia", icon: "wallet" },
  { href: "/notificaciones", label: "Notificaciones", icon: "bell" }
];

const adminNavGroups: Array<{ id: string; label: string; icon: string; items: NavigationItem[] }> = [
  { id: "community", label: "Comunidad", icon: "building", items: [
    { href: "/viviendas", label: "Viviendas", icon: "home", homesOnly: true },
    { href: "/estructura", label: "Datos de la comunidad", module: "estructura", icon: "building" },
    { href: "/censo", label: "Censo", module: "censo", icon: "users" },
    { href: "/accesos", label: "Accesos y cargos", icon: "users", accessOnly: true },
    { href: "/avisos", label: "Avisos", module: "avisos", icon: "megaphone" }
  ]},
  { id: "operations", label: "Operaciones", icon: "wrench", items: [
    { href: "/bancos", label: "Bancos", module: "bancos", icon: "landmark" },
    { href: "/juntas", label: "Juntas", module: "juntas", icon: "vote" },
    { href: "/incidencias", label: "Incidencias", module: "incidencias", icon: "wrench" },
    { href: "/proveedores", label: "Proveedores", module: "proveedores", icon: "briefcase" },
    { href: "/activos", label: "Activos", module: "activos", icon: "hard-hat" },
    { href: "/reservas", label: "Reservas", module: "reservas", icon: "calendar-check" }
  ]},
  { id: "administration", label: "Administración", icon: "shield-check", items: [
    { href: "/documentos", label: "Documentos", module: "documentos", icon: "files" },
    { href: "/aprobaciones", label: "Aprobaciones", module: "aprobaciones", icon: "badge-check", hasAlert: true },
    { href: "/transicion", label: "Transición", module: "transicion", icon: "refresh-cw" },
    { href: "/privacidad", label: "Privacidad", module: "privacidad", icon: "shield-check" },
    { href: "/auditoria", label: "Auditoría", module: "auditoria", icon: "scroll-text" },
    { href: "/servicios-digitales", label: "Servicios digitales", icon: "sparkles", settingsOnly: true },
    { href: "/configuracion", label: "Configuración", icon: "settings", settingsOnly: true },
    { href: "/configuracion/demo", label: "Modo demo", icon: "sparkles", settingsOnly: true, platformOnly: true }
  ]}
];

function isNavigationItemActive(pathname: string, href: string) {
  if (href === "/configuracion") return pathname === href;
  return pathname === href || pathname.startsWith(`${href}/`);
}

const residentMenuItems: Array<{ href: string; label: string; module?: ModuleKey; icon: string; important?: boolean; ownerOnly?: boolean }> = [
  { href: "/inicio", label: "Inicio", icon: "dashboard" },
  { href: "/mi-vivienda", label: "Mi vivienda", icon: "home" },
  { href: "/economia", label: "Mis recibos", module: "economia", icon: "wallet", ownerOnly: true },
  { href: "/avisos", label: "Avisos", module: "avisos", icon: "megaphone" },
  { href: "/incidencias", label: "Incidencias", module: "incidencias", icon: "wrench", important: true },
  { href: "/juntas", label: "Juntas", module: "juntas", icon: "vote" },
  { href: "/reservas", label: "Reservas", module: "reservas", icon: "calendar-check" },
  { href: "/documentos", label: "Documentos", module: "documentos", icon: "files" },
  { href: "/ayuda-y-privacidad", label: "Ayuda y privacidad", icon: "shield-check" }
];

const relationLabels: Record<string, string> = {
  owner: "Propietario/a",
  co_owner: "Copropietario/a",
  tenant: "Inquilino/a",
  authorized_resident: "Residente autorizado/a"
};

function initials(name: string) {
  return name.split(/\s+/).slice(0, 2).map((part) => part[0]).join("").toUpperCase();
}

export function PlatformShell({ context, children }: { context: AuthContext; children: ReactNode }) {
  const temporalPreferences = { locale: context.current.locale, timeZone: context.current.timeZone, dateFormat: context.current.dateFormat, timeFormat: context.current.timeFormat };
  const pathname = usePathname();
  const router = useRouter();
  const [mobileOpen, setMobileOpen] = useState(false);
  const [identityOpen, setIdentityOpen] = useState(false);
  const [weatherOpen, setWeatherOpen] = useState(false);
  const [weatherResult, setWeatherResult] = useState<{ communityId: string; value: WeatherSnapshot } | null>(null);
  const [weatherFailure, setWeatherFailure] = useState<string | null>(null);
  const [switching, setSwitching] = useState(false);
  const [tourRequest, setTourRequest] = useState(0);
  const [expandedNavGroups, setExpandedNavGroups] = useState<Record<string, boolean>>({});
  const currentCommunityId = context.current.communityId;
  const resident = isResidentRole(context.current.role);
  const visibleResidentItems = residentMenuItems.filter((item) =>
    (!item.ownerOnly || context.current.role === "owner") &&
    (!item.module || can(context.current.role, item.module, "read"))
  );
  const weather = weatherResult?.communityId === currentCommunityId ? weatherResult.value : null;
  const weatherUnavailable = weatherFailure === currentCommunityId;
  const isVisibleNavigationItem = (item: NavigationItem) =>
    (!item.settingsOnly || (!context.isDemo && canManageSettings(context.current.role))) &&
    (!item.platformOnly || context.current.role === "platform_admin") &&
    (!item.homesOnly || canManageHomes(context.current.role)) &&
    (!item.accessOnly || (!context.isDemo && canManageAccess(context.current.role))) &&
    (!item.module || can(context.current.role, item.module, "read"));
  const visibleAdminPrimaryItems = adminPrimaryItems.filter(isVisibleNavigationItem);
  const visibleAdminGroups = adminNavGroups
    .map((group) => ({ ...group, items: group.items.filter(isVisibleNavigationItem) }))
    .filter((group) => group.items.length > 0);
  const activeAdminGroupId = visibleAdminGroups.find((group) =>
    group.items.some((item) => isNavigationItemActive(pathname, item.href))
  )?.id;

  useEffect(() => {
    const stored = localStorage.getItem("cc-theme") === "dark" ? "dark" : "light";
    document.documentElement.dataset.theme = stored;
  }, []);
  useEffect(() => {
    if (!mobileOpen) return;
    const previous = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.body.style.overflow = previous;
    };
  }, [mobileOpen]);
  useEffect(() => {
    if (!mobileOpen && !identityOpen && !weatherOpen) return;
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      setMobileOpen(false);
      setIdentityOpen(false);
      setWeatherOpen(false);
    };
    window.addEventListener("keydown", closeOnEscape);
    return () => window.removeEventListener("keydown", closeOnEscape);
  }, [identityOpen, mobileOpen, weatherOpen]);
  useEffect(() => {
    if (!resident) return;
    let cancelled = false;
    const controller = new AbortController();
    const refreshWeather = async () => {
      try {
        const response = await fetch("/api/weather", { cache: "no-store", signal: controller.signal });
        if (!response.ok) throw new Error("weather_unavailable");
        const value = await response.json() as WeatherSnapshot;
        if (!cancelled) {
          setWeatherResult({ communityId: currentCommunityId, value });
          setWeatherFailure(null);
        }
      } catch (error) {
        if (!cancelled && (error as { name?: string }).name !== "AbortError") setWeatherFailure(currentCommunityId);
      }
    };
    void refreshWeather();
    const interval = window.setInterval(refreshWeather, 10 * 60_000);
    return () => {
      cancelled = true;
      controller.abort();
      window.clearInterval(interval);
    };
  }, [currentCommunityId, resident]);

  function toggleTheme() {
    const next = document.documentElement.dataset.theme === "dark" ? "light" : "dark";
    localStorage.setItem("cc-theme", next);
    document.documentElement.dataset.theme = next;
  }

  async function logout() {
    await fetch("/api/auth/logout", { method: "POST" });
    router.replace("/login");
    router.refresh();
  }

  async function switchCommunity(communityId: string) {
    setSwitching(true);
    try {
      const response = await fetch("/api/context/community", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ communityId }) });
      if (response.ok) {
        router.refresh();
      }
    } finally {
      setSwitching(false);
    }
  }

  async function switchRole(role: Role) {
    setSwitching(true);
    try {
      const response = await fetch("/api/context/role", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ role }) });
      if (response.ok) {
        router.replace("/inicio");
        router.refresh();
      }
    } finally {
      setSwitching(false);
    }
  }

  return (
    <TemporalProvider preferences={{
      locale: context.current.locale,
      timeZone: context.current.timeZone,
      dateFormat: context.current.dateFormat,
      timeFormat: context.current.timeFormat
    }}>
    <div className={`platform-shell ${resident ? "resident-shell" : ""} ${context.user.simpleMode ? "readable-mode" : ""} ${context.isDemo ? "demo-session-shell" : ""}`}>
      <ProductControlHeartbeat />
      <header className="mobile-topbar">
        {resident ? (
          <button className="mobile-header-identity" type="button" onClick={() => { setIdentityOpen((open) => !open); setWeatherOpen(false); }} aria-haspopup="dialog" aria-expanded={identityOpen} aria-controls="mobile-identity-popover">
            <Icon name="home" size={17} />
            <strong>{context.primaryHome?.code ?? "Vivienda"}</strong>
          </button>
        ) : (
          <button className="icon-button" onClick={() => setMobileOpen(true)} aria-label="Abrir menú"><Icon name="menu" /></button>
        )}
        <Link className="brand compact-brand" href="/inicio" aria-label="Comunidad Conecta, inicio">
          <span className="brand-mark"><Icon name="building" size={19} /></span>
          <span>Comunidad <strong>Conecta</strong></span>
        </Link>
        <span className="mobile-header-actions">
          {resident && <button className={`mobile-weather-trigger ${weather?.alert ? `has-alert ${weather.alert.level}` : ""}`} type="button" onClick={() => { setWeatherOpen((open) => !open); setIdentityOpen(false); }} aria-label={weather ? `Tiempo en ${weather.location}: ${weather.temperatureC} grados, ${weather.condition}${weather.alert ? `. ${weather.alert.title}` : ""}` : "Consultar el tiempo"} aria-haspopup="dialog" aria-expanded={weatherOpen} aria-controls="mobile-weather-popover">
            <span><Icon name={weather?.icon ?? "cloud-sun"} size={19} />{weather?.alert && <i aria-hidden />}</span>
            {weather && <strong>{weather.temperatureC}°</strong>}
          </button>}
          <Link className="icon-button" href="/notificaciones" aria-label="Ver notificaciones" onClick={() => { setIdentityOpen(false); setWeatherOpen(false); }}><Icon name="bell" /></Link>
        </span>

        {resident && identityOpen && <section className="mobile-header-popover mobile-identity-popover" id="mobile-identity-popover" role="dialog" aria-labelledby="mobile-identity-name">
          <header><span className="avatar">{initials(context.user.fullName)}</span><button className="icon-button" type="button" onClick={() => setIdentityOpen(false)} aria-label="Cerrar datos del usuario"><Icon name="close" size={17} /></button></header>
          <strong id="mobile-identity-name">{context.user.fullName}</strong>
          <small>{context.primaryHome ? `${context.primaryHome.code} · ${relationLabels[context.primaryHome.relation] ?? context.primaryHome.relation}` : roleLabels[context.current.role]}</small>
          <Link href="/mi-vivienda" onClick={() => setIdentityOpen(false)}>Ver mi vivienda <span aria-hidden>→</span></Link>
        </section>}

        {resident && weatherOpen && <section className="mobile-header-popover mobile-weather-popover" id="mobile-weather-popover" role="dialog" aria-labelledby="mobile-weather-title" aria-live="polite">
          <header><span><small>TIEMPO EN TU COMUNIDAD</small><strong id="mobile-weather-title">{weather?.location ?? "Consultando…"}</strong></span><button className="icon-button" type="button" onClick={() => setWeatherOpen(false)} aria-label="Cerrar información meteorológica"><Icon name="close" size={17} /></button></header>
          {weather ? <>
            <div className="mobile-weather-current"><span><Icon name={weather.icon} size={31} /></span><strong>{weather.temperatureC}°</strong><span><b>{weather.condition}</b><small>Sensación de {weather.apparentTemperatureC}° · Rachas {weather.windGustKmh} km/h</small></span></div>
            {weather.alert ? <div className={`mobile-weather-alert ${weather.alert.level}`}><Icon name="cloud-lightning" size={19} /><span><strong>{weather.alert.official ? "Aviso oficial de AEMET" : "Previsión adversa"}</strong><b>{weather.alert.title}</b><small>{weather.alert.detail}</small></span></div> : <div className="mobile-weather-clear"><Icon name="badge-check" size={18} /><span><strong>Sin avisos próximos</strong><small>No se detectan fenómenos adversos en las próximas horas.</small></span></div>}
            <footer><small>{weather.stale ? `Último dato disponible: ${formatDateTime(weather.updatedAt,temporalPreferences)}` : `Actualizado el ${formatDateTime(weather.updatedAt,temporalPreferences)}`} · {context.current.timeZone}</small><a href="https://open-meteo.com/" target="_blank" rel="noreferrer">Tiempo: Open-Meteo</a></footer>
          </> : <div className="mobile-weather-loading"><Icon name={weatherUnavailable ? "cloud" : "refresh-cw"} size={23} /><span><strong>{weatherUnavailable ? "Tiempo no disponible" : "Consultando el tiempo…"}</strong><small>{weatherUnavailable ? "Comprueba el municipio configurado o inténtalo más tarde." : "Buscando la ubicación de la comunidad."}</small></span></div>}
        </section>}
      </header>

      {(identityOpen || weatherOpen) && <button className="mobile-header-popover-scrim" type="button" aria-label="Cerrar información de cabecera" onClick={() => { setIdentityOpen(false); setWeatherOpen(false); }} />}

      {mobileOpen && <button className="sidebar-scrim" aria-label="Cerrar menú" onClick={() => setMobileOpen(false)} />}
      <aside className={`sidebar ${mobileOpen ? "is-open" : ""}`} id="mobile-sidebar">
        <div className="sidebar-header">
          <Link className="brand" href="/inicio">
            <span className="brand-mark"><Icon name="building" size={20} /></span>
            <span className="brand-copy"><span>Comunidad <strong>Conecta</strong></span>{resident && <small>Mi espacio</small>}</span>
          </Link>
          <button className="icon-button sidebar-close" onClick={() => setMobileOpen(false)} aria-label="Cerrar menú"><Icon name="close" /></button>
        </div>

        <div className="community-switcher">
          <span className="community-monogram">{initials(context.current.communityName)}</span>
          <span className="community-copy">
            <strong>{context.current.communityName}</strong>
            <small>{context.current.communityAddress}</small>
          </span>
          {context.communities.length > 1 && (
            <select disabled={switching} value={context.current.communityId} aria-label="Cambiar de comunidad" onChange={(event) => switchCommunity(event.target.value)}>
              {context.communities.map((community) => <option key={community.membershipId} value={community.communityId}>{community.communityName}</option>)}
            </select>
          )}
        </div>

        {resident && <div className="resident-menu-heading"><strong>Tu espacio</strong><small>Todo lo importante, en un solo lugar.</small></div>}
        {resident && <nav className="resident-app-nav" aria-label="Opciones de mi espacio">
          {visibleResidentItems.map((item) => {
            const active = pathname === item.href;
            return <Link className={`resident-app-link ${active ? "active" : ""} ${item.important ? "important" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)}><span><Icon name={item.icon} size={20} /></span><strong>{item.label}</strong><b aria-hidden>→</b></Link>;
          })}
        </nav>}

        {!resident && <nav className="sidebar-nav admin-sidebar-nav" aria-label="Navegación principal">
          <div className="nav-group admin-primary-nav">
            {visibleAdminPrimaryItems.map((item) => {
              const active = isNavigationItemActive(pathname, item.href);
              return <Link className={`nav-item ${active ? "active" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)}><Icon name={item.icon} size={18} strokeWidth={1.8} /><span>{item.label}</span></Link>;
            })}
          </div>
          {visibleAdminGroups.map((group) => {
            const containsActiveItem = group.id === activeAdminGroupId;
            const expansionKey = `${pathname}:${group.id}`;
            const expanded = expandedNavGroups[expansionKey] ?? containsActiveItem;
            const containsAlert = group.items.some((item) => item.hasAlert);
            const regionId = `admin-nav-${group.id}`;
            return <section className="nav-group nav-group-collapsible" key={group.id}>
              <button className={`nav-group-toggle ${containsActiveItem ? "has-active" : ""}`} type="button" aria-expanded={expanded} aria-controls={regionId} onClick={() => setExpandedNavGroups((current) => ({ ...current, [expansionKey]: !expanded }))}>
                <span className="nav-group-toggle-icon"><Icon name={group.icon} size={17} strokeWidth={1.8} /></span>
                <span>{group.label}</span>
                {containsAlert && <span className="nav-group-alert" aria-label="Hay elementos pendientes" />}
                <small>{group.items.length}</small>
                <Icon className="nav-group-chevron" name="chevron-down" size={15} strokeWidth={2} />
              </button>
              {expanded && <div className="nav-group-items" id={regionId}>
                {group.items.map((item) => {
                  const active = isNavigationItemActive(pathname, item.href);
                  return <Link className={`nav-item ${active ? "active" : ""}`} href={item.href} key={item.href} aria-current={active ? "page" : undefined} onClick={() => setMobileOpen(false)}><Icon name={item.icon} size={17} strokeWidth={1.8} /><span>{item.label}</span>{item.hasAlert && <span className="nav-dot" aria-label="Hay elementos pendientes" />}</Link>;
                })}
              </div>}
            </section>;
          })}
        </nav>}

        <div className="sidebar-footer standard-sidebar-footer">
          <div className="user-panel">
            <span className="avatar">{initials(context.user.fullName)}</span>
            <span className="user-copy"><strong>{context.user.fullName}</strong>{context.current.roles.length > 1 ? <select className="role-switch" disabled={switching} value={context.current.role} aria-label="Cambiar perfil" onChange={(event) => switchRole(event.target.value as Role)}>{context.current.roles.map((role) => <option key={role} value={role}>{roleLabels[role]}</option>)}</select> : <small>{roleLabels[context.current.role]}</small>}</span>
          </div>
          <div className="footer-actions">
            <button className="icon-button" onClick={toggleTheme} aria-label="Cambiar tema claro u oscuro"><Icon name="moon" size={18} /></button>
            <Link className="icon-button" href={resident ? "/ayuda-y-privacidad" : "/privacidad"} aria-label="Ayuda y privacidad"><Icon name="help" size={18} /></Link>
            <button className="icon-button" onClick={logout} aria-label="Cerrar sesión"><Icon name="logout" size={18} /></button>
          </div>
        </div>
        {resident && <div className="resident-mobile-footer">
          <div className="resident-profile-card">
            <span className="avatar">{initials(context.user.fullName)}</span>
            <span><strong>{context.user.fullName}</strong><small>{roleLabels[context.current.role]}</small></span>
          </div>
          <div className="resident-footer-actions"><button type="button" onClick={toggleTheme}><Icon name="moon" size={18} /> Apariencia</button><Link href="/ayuda-y-privacidad" onClick={() => setMobileOpen(false)}><Icon name="help" size={18} /> Ayuda</Link><button type="button" onClick={logout}><Icon name="logout" size={18} /> Salir</button></div>
        </div>}
      </aside>
      <main className="platform-main">
        {context.isDemo && <div className="demo-session-banner" role="status"><span><Icon name="sparkles" size={18} /></span><span><strong>Estás en la demo como {roleLabels[context.current.role]}</strong><small>Comunidad y personas ficticias · no introduzcas datos reales · sesión hasta {formatDateTime(context.sessionExpiresAt, temporalPreferences)}</small></span><span className="demo-session-actions"><button type="button" onClick={() => { setMobileOpen(false); setTourRequest((value) => value + 1); }}><Icon name="play" size={15} /> Visita guiada</button><button type="button" onClick={logout}>Salir <Icon name="logout" size={15} /></button></span></div>}
        {children}
      </main>
      {context.isDemo && <DemoTour role={context.current.role} pathname={pathname} request={tourRequest} />}
      {resident && <nav className="mobile-bottom-nav" aria-label="Accesos móviles"><Link className={pathname === "/inicio" ? "active" : ""} href="/inicio" aria-current={pathname === "/inicio" ? "page" : undefined} onClick={() => setMobileOpen(false)}><Icon name="dashboard" /><span>Inicio</span></Link><Link className={pathname === "/mi-vivienda" ? "active" : ""} href="/mi-vivienda" aria-current={pathname === "/mi-vivienda" ? "page" : undefined} onClick={() => setMobileOpen(false)}><Icon name="home" /><span>Vivienda</span></Link><Link className={pathname === "/incidencias" ? "active" : ""} href="/incidencias?new=1" aria-current={pathname === "/incidencias" ? "page" : undefined} onClick={() => setMobileOpen(false)}><span className="bottom-main-action"><Icon name="plus" /></span><span>Incidencia</span></Link><button type="button" onClick={() => { setMobileOpen(true); setIdentityOpen(false); setWeatherOpen(false); }} aria-expanded={mobileOpen} aria-controls="mobile-sidebar"><Icon name="menu" /><span>Más</span></button></nav>}
    </div>
    </TemporalProvider>
  );
}
