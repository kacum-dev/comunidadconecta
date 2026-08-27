"use client";

import { useEffect, useMemo, useRef, useState, type FormEvent } from "react";
import type { HomeDirectoryResult, PrivateUnit, RelationType } from "@/lib/homes";
import { HelpTooltip } from "./HelpTooltip";
import { Icon } from "./Icon";
import { formatDateTime } from "@/lib/temporal";
import { useTemporalPreferences } from "./TemporalContext";

const relationLabels: Record<string, string> = {
  owner: "Propietario/a", co_owner: "Copropietario/a", tenant: "Inquilino/a", authorized_resident: "Residente autorizado/a"
};
const householdRelationshipLabels: Record<string, string> = {
  partner: "Pareja", child: "Hijo/a", parent: "Padre o madre", sibling: "Hermano/a",
  other_relative: "Otro familiar", dependent: "Persona a cargo", other: "Otra relaci\u00f3n familiar"
};
const unitLabels: Record<string, string> = {
  home: "Vivienda", commercial: "Local", office: "Oficina", garage: "Garaje", storage: "Trastero", other: "Otro"
};
const quotaFrequencyLabels: Record<PrivateUnit["quotaFrequency"], string> = {
  monthly: "al mes", quarterly: "al trimestre", semiannual: "al semestre", annual: "al año"
};
const emptyDirectory: HomeDirectoryResult = {
  rows: [], total: 0, page: 1, pageSize: 25,
  summary: { total: 0, withTenant: 0, pendingRelations: 0, withoutOwner: 0 },
  filters: { sites: [], blocks: [], staircases: [], floors: [] }
};

function today() {
  const value = new Date();
  return new Date(value.getTime() - value.getTimezoneOffset() * 60_000).toISOString().slice(0, 10);
}

function locationParts(home: PrivateUnit) {
  return [home.siteName, home.blockName, home.staircase, home.floor && `Planta ${home.floor}`, home.door && `Puerta ${home.door}`].filter(Boolean) as string[];
}

function areaLabel(value: number | null) {
  return value === null ? "Pendiente" : `${value.toLocaleString("es-ES", { maximumFractionDigits: 2 })} m²`;
}

function quotaLabel(home: PrivateUnit) {
  if (home.quotaMethod === "fixed_amount") {
    return home.fixedQuotaAmount === null
      ? "Importe pendiente"
      : `${home.fixedQuotaAmount.toLocaleString("es-ES", { style: "currency", currency: "EUR" })} ${quotaFrequencyLabels[home.quotaFrequency]}`;
  }
  return `${home.participationCoefficient.toLocaleString("es-ES", { maximumFractionDigits: 6 })} % del gasto repartido`;
}

export function HomesView({
  initialHomes,
  initialDirectory,
  mode,
  canDeclare = false
}: {
  initialHomes: PrivateUnit[];
  initialDirectory?: HomeDirectoryResult;
  mode: "manager" | "resident";
  canDeclare?: boolean;
}) {
  const [homes, setHomes] = useState(initialHomes);
  const [directory, setDirectory] = useState(initialDirectory ?? emptyDirectory);
  const [query, setQuery] = useState({ search: "", siteName: "", blockName: "", staircase: "", floor: "", unitType: "", occupancy: "" });
  const [page, setPage] = useState(initialDirectory?.page ?? 1);
  const [pageSize, setPageSize] = useState(initialDirectory?.pageSize ?? 25);
  const [sort, setSort] = useState("location");
  const [direction, setDirection] = useState<"asc" | "desc">("asc");
  const [loading, setLoading] = useState(false);
  const [mobileFiltersOpen, setMobileFiltersOpen] = useState(false);
  const [homeDialog, setHomeDialog] = useState<{ mode: "create" | "edit"; home?: PrivateUnit } | null>(null);
  const [detailHome, setDetailHome] = useState<PrivateUnit | null>(null);
  const [relationUnit, setRelationUnit] = useState<PrivateUnit | null>(null);
  const [familyUnit, setFamilyUnit] = useState<PrivateUnit | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [toast, setToast] = useState("");
  const firstDirectoryRender = useRef(true);

  const directoryParams = useMemo(() => {
    const params = new URLSearchParams({ page: String(page), pageSize: String(pageSize), sort, direction });
    Object.entries(query).forEach(([key, value]) => { if (value) params.set(key, value); });
    return params;
  }, [direction, page, pageSize, query, sort]);

  async function refresh() {
    if (mode === "manager") {
      setLoading(true);
      const response = await fetch(`/api/homes?${directoryParams}`, { cache: "no-store" });
      if (response.ok) {
        const next = await response.json() as HomeDirectoryResult;
        setDirectory(next);
        setDetailHome((current) => current ? next.rows.find((home) => home.id === current.id) ?? null : null);
      }
      setLoading(false);
      return;
    }
    const response = await fetch("/api/homes", { cache: "no-store" });
    if (response.ok) setHomes((await response.json()).homes);
  }

  useEffect(() => {
    if (mode !== "manager") return;
    if (firstDirectoryRender.current) { firstDirectoryRender.current = false; return; }
    const controller = new AbortController();
    const timeout = window.setTimeout(async () => {
      setLoading(true);
      try {
        const response = await fetch(`/api/homes?${directoryParams}`, { cache: "no-store", signal: controller.signal });
        if (response.ok) setDirectory(await response.json());
      } finally {
        if (!controller.signal.aborted) setLoading(false);
      }
    }, query.search ? 280 : 0);
    return () => { window.clearTimeout(timeout); controller.abort(); };
  }, [directoryParams, mode, query.search]);

  function changeFilter(key: keyof typeof query, value: string) {
    setQuery((current) => ({ ...current, [key]: value }));
    setPage(1);
  }

  async function submitHome(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const payload = {
      code: form.get("code"), unitType: form.get("unitType"), siteName: form.get("siteName"),
      blockName: form.get("blockName"), staircase: form.get("staircase"), floor: form.get("floor"),
      door: form.get("door"), cadastralReference: form.get("cadastralReference"),
      builtAreaM2: form.get("builtAreaM2"), usableAreaM2: form.get("usableAreaM2"),
      bedrooms: form.get("bedrooms"), bathrooms: form.get("bathrooms"),
      participationCoefficient: form.get("participationCoefficient") || 0,
      quotaMethod: form.get("quotaMethod"), fixedQuotaAmount: form.get("fixedQuotaAmount"),
      quotaFrequency: form.get("quotaFrequency")
    };
    const editing = homeDialog?.mode === "edit" ? homeDialog.home : null;
    const response = await fetch(editing ? `/api/homes/${editing.id}` : "/api/homes", {
      method: editing ? "PATCH" : "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(payload)
    });
    const body = await response.json();
    if (!response.ok) setError(body.error || "No se ha podido guardar el inmueble.");
    else {
      setHomeDialog(null); setDetailHome(null);
      setToast(editing ? "Inmueble actualizado" : "Inmueble creado");
      await refresh();
    }
    setBusy(false);
  }

  async function submitRelation(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!relationUnit) return;
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const relationType = form.get("relationType") as RelationType;
    const response = await fetch("/api/homes/relations", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ unitId: relationUnit.id, fullName: form.get("fullName"), email: form.get("email"), relationType, ownershipPercentage: ["owner", "co_owner"].includes(relationType) ? Number(form.get("ownershipPercentage") || 100) : null, isPrimary: form.get("isPrimary") === "on", canVote: form.get("canVote") === "on", validFrom: form.get("validFrom"), notes: form.get("notes") })
    });
    const body = await response.json();
    if (!response.ok) setError(body.error || "No se ha podido guardar la persona.");
    else {
      setRelationUnit(null); setDetailHome(null);
      setToast(mode === "manager" ? "Persona vinculada" : "Declaración enviada para validar");
      await refresh();
    }
    setBusy(false);
  }

  async function review(id: string, status: "active" | "rejected" | "ended") {
    setBusy(true); setError("");
    const response = await fetch(`/api/homes/relations/${id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ status }) });
    const body = await response.json();
    if (!response.ok) setError(body.error || "No se ha podido actualizar la relación.");
    else {
      setToast(status === "active" ? "Ocupación validada" : status === "ended" ? "Relación finalizada" : "Declaración rechazada");
      await refresh();
    }
    setBusy(false);
  }

  async function submitFamily(event: FormEvent<HTMLFormElement>) {
    event.preventDefault(); if (!familyUnit) return;
    setBusy(true); setError("");
    const form = new FormData(event.currentTarget);
    const response = await fetch("/api/homes/family", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        unitId: familyUnit.id,
        fullName: form.get("fullName"),
        relationshipType: form.get("relationshipType"),
        sharedWithCommunity: form.get("sharedWithCommunity") === "on"
      })
    });
    const body = await response.json();
    if (!response.ok) setError(body.error || "No se ha podido a\u00f1adir el familiar.");
    else {
      setFamilyUnit(null);
      setToast("Familiar a\u00f1adido");
      await refresh();
    }
    setBusy(false);
  }

  async function toggleFamilyShare(member: PrivateUnit["familyMembers"][number]) {
    setBusy(true); setError("");
    const response = await fetch(`/api/homes/family/${member.id}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sharedWithCommunity: !member.sharedWithCommunity, version: member.version })
    });
    const body = await response.json();
    if (!response.ok) setError(body.error || "No se ha podido cambiar la privacidad.");
    else {
      setToast(member.sharedWithCommunity ? "El familiar vuelve a ser privado" : "Familiar compartido con la administraci\u00f3n");
      await refresh();
    }
    setBusy(false);
  }

  async function removeFamily(member: PrivateUnit["familyMembers"][number]) {
    if (!window.confirm(`\u00bfQuitar a ${member.fullName} de tu familia?`)) return;
    setBusy(true); setError("");
    const response = await fetch(`/api/homes/family/${member.id}`, {
      method: "DELETE",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ version: member.version })
    });
    const body = await response.json();
    if (!response.ok) setError(body.error || "No se ha podido quitar el familiar.");
    else {
      setToast("Familiar retirado");
      await refresh();
    }
    setBusy(false);
  }

  const activeFilterCount = Object.values(query).filter(Boolean).length;
  const pageCount = Math.max(1, Math.ceil(directory.total / directory.pageSize));

  return (
    <div className={`page homes-page ${mode === "resident" ? "my-home-page" : ""}`}>
      {mode === "manager" && <div className="page-heading">
        <div>
          <span className="eyebrow">DIRECTORIO DE INMUEBLES</span>
          <h1>Viviendas y ocupación</h1>
          <p>Localiza cualquier unidad por su estructura y gestiona propiedad y ocupación sin cargar todo el censo.</p>
        </div>
        <div className="heading-actions"><a className="button button-secondary" href={`/api/homes/export?${directoryParams}`}><Icon name="download" size={17} /> Exportar</a><button className="button button-primary" onClick={() => { setError(""); setHomeDialog({ mode: "create" }); }}><Icon name="plus" size={18} /> Nuevo inmueble</button></div>
      </div>}

      {error && <div className="form-alert homes-alert">{error}</div>}
      {mode === "manager" ? (
        <>
          <section className="home-summary-grid home-directory-summary">
            <div><span className="summary-icon purple"><Icon name="building" /></span><span><strong>{directory.summary.total.toLocaleString("es-ES")}</strong><small>Inmuebles activos</small></span></div>
            <div><span className="summary-icon green"><Icon name="users" /></span><span><strong>{directory.summary.withTenant.toLocaleString("es-ES")}</strong><small>Con inquilino u ocupante</small></span></div>
            <div><span className="summary-icon orange"><Icon name="badge-check" /></span><span><strong>{directory.summary.pendingRelations.toLocaleString("es-ES")}</strong><small>Declaraciones por validar</small></span></div>
            <div><span className="summary-icon blue"><Icon name="home" /></span><span><strong>{directory.summary.withoutOwner.toLocaleString("es-ES")}</strong><small>Sin propiedad vinculada</small></span></div>
          </section>

          <section className={`data-card home-directory ${loading ? "is-loading" : ""}`}>
            <div className={`home-directory-toolbar ${mobileFiltersOpen ? "mobile-filters-open" : ""}`}>
              <label className="home-search"><Icon name="search" size={18} /><input value={query.search} onChange={(event) => changeFilter("search", event.target.value)} placeholder="Buscar referencia, propietario, inquilino..." aria-label="Buscar viviendas" /></label>
              <button className="mobile-filter-toggle" onClick={() => setMobileFiltersOpen((value) => !value)}><Icon name="settings" size={15} /> Filtros{activeFilterCount ? ` (${activeFilterCount})` : ""}</button>
              <select value={query.siteName} onChange={(event) => changeFilter("siteName", event.target.value)}><option value="">Todas las manzanas</option>{directory.filters.sites.map((value) => <option key={value}>{value}</option>)}</select>
              <select value={query.blockName} onChange={(event) => changeFilter("blockName", event.target.value)}><option value="">Todos los bloques</option>{directory.filters.blocks.map((value) => <option key={value}>{value}</option>)}</select>
              <select value={query.staircase} onChange={(event) => changeFilter("staircase", event.target.value)}><option value="">Todas las escaleras</option>{directory.filters.staircases.map((value) => <option key={value}>{value}</option>)}</select>
              <select value={query.floor} onChange={(event) => changeFilter("floor", event.target.value)}><option value="">Todas las plantas</option>{directory.filters.floors.map((value) => <option key={value}>{value}</option>)}</select>
              <select value={query.unitType} onChange={(event) => changeFilter("unitType", event.target.value)}><option value="">Todos los tipos</option>{Object.entries(unitLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select>
              <select value={query.occupancy} onChange={(event) => changeFilter("occupancy", event.target.value)}><option value="">Cualquier ocupación</option><option value="rented">Con inquilino / residente</option><option value="no_tenant">Sin inquilino declarado</option><option value="pending">Pendiente de validar</option><option value="no_owner">Sin propietario vinculado</option></select>
              {activeFilterCount > 0 && <button className="clear-home-filters" onClick={() => { setQuery({ search: "", siteName: "", blockName: "", staircase: "", floor: "", unitType: "", occupancy: "" }); setPage(1); }}><Icon name="close" size={14} /> Limpiar {activeFilterCount}</button>}
            </div>

            <div className="home-directory-meta">
              <span><strong>{directory.total.toLocaleString("es-ES")}</strong> resultado{directory.total === 1 ? "" : "s"}</span>
              <span className="home-sort-controls">Ordenar por <select value={sort} onChange={(event) => { setSort(event.target.value); setPage(1); }}><option value="location">Ubicación</option><option value="code">Referencia</option><option value="coefficient">Coeficiente</option><option value="updatedAt">Última actualización</option></select><button className="icon-button" onClick={() => setDirection((value) => value === "asc" ? "desc" : "asc")} aria-label="Invertir orden"><Icon name="refresh-cw" size={15} /></button></span>
            </div>

            <div className="home-table-scroll">
              <table className="home-table">
                <thead><tr><th>Inmueble</th><th>Manzana / bloque</th><th>Escalera</th><th>Planta / puerta</th><th>Propiedad</th><th>Ocupación</th><th>Coeficiente</th><th aria-label="Acciones" /></tr></thead>
                <tbody>{directory.rows.map((home) => <HomeTableRow key={home.id} home={home} open={() => setDetailHome(home)} />)}</tbody>
              </table>
              {!directory.rows.length && <div className="home-table-empty"><span><Icon name="search" size={24} /></span><h2>No hay inmuebles con estos filtros</h2><p>Prueba a quitar algún filtro o busca por otra referencia.</p></div>}
            </div>

            <footer className="home-directory-footer">
              <span>Mostrando {directory.total ? (directory.page - 1) * directory.pageSize + 1 : 0}–{Math.min(directory.page * directory.pageSize, directory.total)} de {directory.total.toLocaleString("es-ES")}</span>
              <label>Filas <select value={pageSize} onChange={(event) => { setPageSize(Number(event.target.value)); setPage(1); }}><option>25</option><option>50</option><option>100</option></select></label>
              <button className="button button-secondary" disabled={page <= 1 || loading} onClick={() => setPage((value) => value - 1)}>Anterior</button>
              <strong>{page} / {pageCount}</strong>
              <button className="button button-secondary" disabled={page >= pageCount || loading} onClick={() => setPage((value) => value + 1)}>Siguiente</button>
            </footer>
            {loading && <span className="home-directory-loading"><span className="spinner" /> Actualizando</span>}
          </section>
        </>
      ) : <ResidentHomes homes={homes} canDeclare={canDeclare} busy={busy}
        addRelation={(home) => { setError(""); setRelationUnit(home); }}
        addFamily={(home) => { setError(""); setFamilyUnit(home); }}
        toggleFamilyShare={toggleFamilyShare} removeFamily={removeFamily} />}

      {detailHome && <HomeDetailDialog home={detailHome} busy={busy} close={() => setDetailHome(null)} review={review} edit={() => { setHomeDialog({ mode: "edit", home: detailHome }); setDetailHome(null); }} addRelation={() => { setRelationUnit(detailHome); setDetailHome(null); }} />}
      {homeDialog && <HomeFormDialog dialog={homeDialog} directory={directory} busy={busy} close={() => setHomeDialog(null)} submit={submitHome} />}
      {relationUnit && <RelationDialog home={relationUnit} mode={mode} busy={busy} close={() => setRelationUnit(null)} submit={submitRelation} />}
      {familyUnit && <FamilyDialog home={familyUnit} busy={busy} close={() => setFamilyUnit(null)} submit={submitFamily} />}
      {toast && <div className="toast" role="status"><Icon name="badge-check" size={17} /> {toast}<button aria-label="Cerrar" onClick={() => setToast("")}><Icon name="close" size={14} /></button></div>}
    </div>
  );
}

function HomeTableRow({ home, open }: { home: PrivateUnit; open: () => void }) {
  const occupied = home.occupantNames.length > 0;
  return <tr onClick={open} tabIndex={0} onKeyDown={(event) => { if (event.key === "Enter") open(); }}>
    <td><span className="home-table-unit"><span className="home-table-icon"><Icon name="home" size={17} /></span><span><strong>{home.code}</strong><small>{unitLabels[home.unitType] ?? home.unitType}</small></span></span></td>
    <td><span className="home-table-copy"><strong>{home.siteName || "Sin manzana"}</strong><small>{home.blockName || "Sin bloque"}</small></span></td>
    <td>{home.staircase || "—"}</td>
    <td><span className="home-table-copy"><strong>{home.floor || "—"}</strong><small>{home.door ? `Puerta ${home.door}` : "Sin puerta"}</small></span></td>
    <td><span className="home-table-copy"><strong>{home.ownerNames[0] || "Sin propietario"}</strong>{home.ownerNames.length > 1 && <small>+{home.ownerNames.length - 1} copropietario{home.ownerNames.length > 2 ? "s" : ""}</small>}</span></td>
    <td><span className={`occupancy-pill ${occupied ? "rented" : "owner-occupied"}`}>{occupied ? "Con ocupante" : "Sin inquilino"}</span>{home.pendingRelations > 0 && <span className="pending-count">{home.pendingRelations} pendiente{home.pendingRelations > 1 ? "s" : ""}</span>}</td>
    <td><strong>{home.participationCoefficient.toLocaleString("es-ES", { maximumFractionDigits: 4 })} %</strong></td>
    <td><button className="icon-button" onClick={(event) => { event.stopPropagation(); open(); }} aria-label={`Abrir ${home.code}`}><Icon name="more" size={18} /></button></td>
  </tr>;
}

function ResidentHomes({ homes, canDeclare, busy, addRelation, addFamily, toggleFamilyShare, removeFamily }: {
  homes: PrivateUnit[];
  canDeclare: boolean;
  busy: boolean;
  addRelation: (home: PrivateUnit) => void;
  addFamily: (home: PrivateUnit) => void;
  toggleFamilyShare: (member: PrivateUnit["familyMembers"][number]) => void;
  removeFamily: (member: PrivateUnit["familyMembers"][number]) => void;
}) {
  return <section className="resident-bank-homes">
    {homes.map((home) => {
      const owners = home.relations.filter((relation) => ["owner", "co_owner"].includes(relation.relationType));
      const occupants = home.relations.filter((relation) => ["tenant", "authorized_resident"].includes(relation.relationType));
      const activeOccupants = occupants.filter((relation) => relation.status === "active");
      const linkedPeople = owners.length + occupants.length + home.familyMembers.length;
      return <article className="resident-bank-home-card" key={home.id}>
        <header className="resident-home-overview">
          <span className="resident-home-overview-icon"><Icon name="home" size={25} /></span>
          <span className="resident-home-overview-copy">
            <small>{unitLabels[home.unitType]?.toUpperCase() || "INMUEBLE"}</small>
            <h2>{home.code}</h2>
            <p>{locationParts(home).join(" · ") || "Ubicación pendiente"}</p>
          </span>
          <span className={`resident-home-state ${activeOccupants.length ? "occupied" : ""}`}>
            <span /> {activeOccupants.length ? "Ocupación comunicada" : "Sin alquiler declarado"}
          </span>
          <span className="resident-home-indicators" aria-label="Resumen de la vivienda">
            <span title={`${linkedPeople} persona${linkedPeople === 1 ? "" : "s"} vinculada${linkedPeople === 1 ? "" : "s"}`} aria-label={`${linkedPeople} persona${linkedPeople === 1 ? "" : "s"} vinculada${linkedPeople === 1 ? "" : "s"}`}><Icon name="users" size={18} /><strong>{linkedPeople}</strong></span>
            <span className={home.cadastralReference ? "complete" : "incomplete"} title={home.cadastralReference ? "Datos completos" : "Datos por completar"} aria-label={home.cadastralReference ? "Datos completos" : "Datos por completar"}><Icon name={home.cadastralReference ? "badge-check" : "info"} size={18} /></span>
          </span>
        </header>

        <div className="resident-home-accordions">
          <details>
            <summary><span><Icon name="home" size={20} /><strong>Datos de la vivienda</strong></span><b aria-hidden>+</b></summary>
            <div className="resident-home-detail-content">
              <dl className="resident-home-facts">
                <div><dt>Superficie construida</dt><dd>{areaLabel(home.builtAreaM2)}</dd></div>
                <div><dt>Superficie útil</dt><dd>{areaLabel(home.usableAreaM2)}</dd></div>
                <div><dt>Dormitorios</dt><dd>{home.bedrooms ?? "Pendiente"}</dd></div>
                <div><dt>Baños</dt><dd>{home.bathrooms ?? "Pendiente"}</dd></div>
                <div className="resident-home-wide"><dt>Referencia catastral</dt><dd>{home.cadastralReference || "Pendiente de completar"}</dd></div>
              </dl>
            </div>
          </details>

          {canDeclare && <details>
            <summary><span><Icon name="wallet" size={20} /><strong>Información económica</strong></span><b aria-hidden>+</b></summary>
            <div className="resident-home-detail-content">
              <div className="resident-economic-summary">
                <span><small>Cuota ordinaria</small><strong>{quotaLabel(home)}</strong></span>
                <span>
                  <small>Coeficiente <HelpTooltip label="Coeficiente de participación" align="right">Porcentaje utilizado para repartir determinados gastos comunes.</HelpTooltip></small>
                  <strong>{home.participationCoefficient.toLocaleString("es-ES", { maximumFractionDigits: 6 })} %</strong>
                </span>
              </div>
              <p className="resident-detail-note">{home.quotaMethod === "fixed_amount" ? "Importe fijo acordado por la comunidad." : "La cuota se reparte según el coeficiente de participación."}</p>
            </div>
          </details>}

          <details>
            <summary><span><Icon name="badge-check" size={20} /><strong>Titulares</strong><em>{owners.length}</em></span><b aria-hidden>+</b></summary>
            <div className="resident-home-detail-content resident-people-content">
              <div className="people-section">
                <div className="people-section-title"><strong>Propiedad</strong><span>{owners.length}</span></div>
                {owners.length ? owners.map((person) => <PersonRow key={person.id} person={person} mode="resident" busy={false} review={() => undefined} />) : <p className="people-empty">Aún no hay propietarios vinculados.</p>}
              </div>
            </div>
          </details>

          <details>
            <summary><span><Icon name="users" size={20} /><strong>Mi familia</strong><em>{home.familyMembers.length}</em></span><b aria-hidden>+</b></summary>
            <div className="resident-home-detail-content resident-family-content">
              <div className="family-privacy-note"><Icon name="shield-check" size={18} /><span><strong>Privada por defecto</strong><small>Solo tú ves esta lista. Activa cada casilla si quieres compartir ese familiar con la administración.</small></span></div>
              {home.familyMembers.length
                ? <div className="family-list">{home.familyMembers.map((member) => <FamilyRow key={member.id} member={member} busy={busy} toggleShare={toggleFamilyShare} remove={removeFamily} />)}</div>
                : <p className="people-empty family-empty">Aún no has añadido familiares a esta vivienda.</p>}
              <button className="button button-secondary family-add-button" onClick={() => addFamily(home)}><Icon name="plus" size={17} /> Añadir familiar</button>
            </div>
          </details>

          <details>
            <summary><span><Icon name="home" size={20} /><strong>Inquilinos comunicados</strong><em>{occupants.length}</em></span><b aria-hidden>+</b></summary>
            <div className="resident-home-detail-content resident-people-content">
              <div className="tenant-declaration-note"><Icon name="info" size={18} /><span><strong>Comunicación del propietario</strong><small>Cada envío conserva fecha, estado y referencia para que quede constancia de la comunicación.</small></span></div>
              <div className="people-section tenant-section">
                {occupants.length ? occupants.map((person) => <PersonRow key={person.id} person={person} mode="resident" busy={false} review={() => undefined} />) : <p className="people-empty">No se ha comunicado ningún inquilino.</p>}
              </div>
            </div>
          </details>
        </div>

        <footer className="resident-home-footer">
          <span><Icon name="shield-check" size={18} /><small>Tu familia es privada; los inquilinos comunicados se revisan.</small></span>
          <div className="resident-home-footer-actions">
            <button className="button button-secondary" onClick={() => addFamily(home)}><Icon name="users" size={17} /> Añadir familiar</button>
            {canDeclare && <a className="button button-secondary owner-report-button" href={`/api/homes/report?unitId=${encodeURIComponent(home.id)}`}><Icon name="download" size={17} /> Informe PDF</a>}
            {canDeclare && <button className="button button-primary" onClick={() => addRelation(home)}><Icon name="plus" size={17} /> Comunicar inquilino</button>}
          </div>
        </footer>
      </article>;
    })}
    {!homes.length && <div className="panel empty-homes"><span><Icon name="home" size={28} /></span><h2>Tu cuenta todavía no está vinculada</h2><p>Pide a la administración que vincule tu acceso con la vivienda correcta.</p></div>}
  </section>;
}

function FamilyRow({ member, busy, toggleShare, remove }: {
  member: PrivateUnit["familyMembers"][number];
  busy: boolean;
  toggleShare: (member: PrivateUnit["familyMembers"][number]) => void;
  remove: (member: PrivateUnit["familyMembers"][number]) => void;
}) {
  return <div className="family-row">
    <span className="person-avatar">{member.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span>
    <span className="person-copy"><strong>{member.fullName}</strong><small>{householdRelationshipLabels[member.relationshipType]}</small></span>
    <label className="family-share-toggle" title="Compartir solo con la administración autorizada">
      <input type="checkbox" checked={member.sharedWithCommunity} disabled={busy} onChange={() => toggleShare(member)} />
      <span><strong>{member.sharedWithCommunity ? "Compartido" : "Solo para mí"}</strong><small>Administración</small></span>
    </label>
    <button className="icon-button family-remove" type="button" disabled={busy} onClick={() => remove(member)} aria-label={`Quitar a ${member.fullName}`}><Icon name="close" size={16} /></button>
  </div>;
}

function HomeDetailDialog({ home, busy, close, review, edit, addRelation }: { home: PrivateUnit; busy: boolean; close: () => void; review: (id: string, status: "active" | "rejected" | "ended") => void; edit: () => void; addRelation: () => void }) {
  const owners = home.relations.filter((relation) => ["owner", "co_owner"].includes(relation.relationType));
  const occupants = home.relations.filter((relation) => ["tenant", "authorized_resident"].includes(relation.relationType));
  const sharedFamily = home.familyMembers;
  return <div className="modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget && !busy) close(); }}>
    <section className="record-dialog home-detail-dialog" role="dialog" aria-modal="true">
      <header className="dialog-header"><div><span className="eyebrow">{unitLabels[home.unitType]?.toUpperCase()}</span><h2>{home.code}</h2><p>{locationParts(home).join(" · ") || "Estructura pendiente de completar"}</p></div><button className="icon-button" onClick={close}><Icon name="close" /></button></header>
      <div className="home-detail-scroll">
        <h3 className="home-detail-section-title">Ubicación y características</h3>
        <dl className="home-detail-location">
          <div><dt>Manzana / conjunto</dt><dd>{home.siteName || "—"}</dd></div>
          <div><dt>Bloque</dt><dd>{home.blockName || "—"}</dd></div>
          <div><dt>Escalera</dt><dd>{home.staircase || "—"}</dd></div>
          <div><dt>Planta</dt><dd>{home.floor || "—"}</dd></div>
          <div><dt>Puerta</dt><dd>{home.door || "—"}</dd></div>
          <div><dt>Referencia catastral</dt><dd>{home.cadastralReference || "—"}</dd></div>
          <div><dt>Superficie construida</dt><dd>{areaLabel(home.builtAreaM2)}</dd></div>
          <div><dt>Superficie útil</dt><dd>{areaLabel(home.usableAreaM2)}</dd></div>
          <div><dt>Dormitorios / baños</dt><dd>{home.bedrooms ?? "—"} / {home.bathrooms ?? "—"}</dd></div>
        </dl>
        <h3 className="home-detail-section-title">Reparto de la cuota ordinaria</h3>
        <div className="home-detail-quota">
          <span className="resident-quota-icon"><Icon name="wallet" size={19} /></span>
          <span><small>{home.quotaMethod === "fixed_amount" ? "IMPORTE FIJO" : "POR COEFICIENTE"}</small><strong>{quotaLabel(home)}</strong><p>Coeficiente del título: {home.participationCoefficient.toLocaleString("es-ES", { maximumFractionDigits: 6 })} %</p></span>
        </div>
        <div className="home-detail-people"><section><div className="people-section-title"><strong>Propiedad</strong><span>{owners.length}</span></div>{owners.length ? owners.map((person) => <PersonRow key={person.id} person={person} mode="manager" busy={busy} review={review} />) : <p className="people-empty">No hay propiedad vinculada.</p>}</section><section><div className="people-section-title"><strong>Inquilinos comunicados</strong><span>{occupants.length}</span></div>{occupants.length ? occupants.map((person) => <PersonRow key={person.id} person={person} mode="manager" busy={busy} review={review} />) : <p className="people-empty">No hay inquilinos declarados.</p>}</section>{sharedFamily.length > 0 && <section><div className="people-section-title"><strong>Familia compartida</strong><span>{sharedFamily.length}</span></div><p className="shared-family-help">Estas personas han sido compartidas expresamente con la administración.</p>{sharedFamily.map((member) => <div className="family-row manager-family-row" key={member.id}><span className="person-avatar">{member.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><span className="person-copy"><strong>{member.fullName}</strong><small>{householdRelationshipLabels[member.relationshipType]}</small></span><span className="relation-status active">Compartido</span></div>)}</section>}</div>
      </div>
      <footer className="dialog-footer"><div><button className="button button-secondary" onClick={edit}><Icon name="pencil" size={16} /> Editar inmueble</button></div><div className="dialog-footer-actions"><button className="button button-primary" onClick={addRelation}><Icon name="plus" size={16} /> Vincular persona</button></div></footer>
    </section>
  </div>;
}

function HomeFormDialog({ dialog, directory, busy, close, submit }: { dialog: { mode: "create" | "edit"; home?: PrivateUnit }; directory: HomeDirectoryResult; busy: boolean; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  const home = dialog.home;
  const [quotaMethod, setQuotaMethod] = useState<PrivateUnit["quotaMethod"]>(home?.quotaMethod ?? "participation_coefficient");
  return <div className="modal-backdrop" role="presentation">
    <section className="record-dialog home-form-dialog" role="dialog" aria-modal="true">
      <header className="dialog-header"><div><span className="eyebrow">{dialog.mode === "edit" ? "EDITAR INMUEBLE" : "NUEVO INMUEBLE"}</span><h2>{dialog.mode === "edit" ? home?.code : "Añadir vivienda o local"}</h2><p>Completa la identificación, las superficies y el criterio de la cuota ordinaria.</p></div><button className="icon-button" onClick={close}><Icon name="close" /></button></header>
      <form className="dialog-form" onSubmit={submit}>
        <div className="dialog-scroll home-form-scroll">
          <section className="home-form-section">
            <div className="home-form-section-title"><span>1</span><div><h3>Identificación y ubicación</h3><p>Datos para localizar el inmueble sin ambigüedades.</p></div></div>
            <div className="form-grid">
              <label className="field-group"><span>Referencia *</span><input name="code" required maxLength={80} defaultValue={home?.code} placeholder="Ej. MN-A-E1-01A" /></label>
              <label className="field-group"><span>Tipo *</span><select name="unitType" defaultValue={home?.unitType ?? "home"}>{Object.entries(unitLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
              <label className="field-group"><span>Manzana / conjunto</span><input name="siteName" maxLength={120} defaultValue={home?.siteName ?? ""} list="home-sites" placeholder="Ej. Manzana Norte" /></label>
              <label className="field-group"><span>Bloque / edificio</span><input name="blockName" maxLength={120} defaultValue={home?.blockName ?? ""} list="home-blocks" placeholder="Ej. Bloque A" /></label>
              <label className="field-group"><span>Escalera / portal</span><input name="staircase" maxLength={120} defaultValue={home?.staircase ?? ""} list="home-staircases" placeholder="Ej. Escalera 2" /></label>
              <label className="field-group"><span>Planta</span><input name="floor" maxLength={40} defaultValue={home?.floor ?? ""} list="home-floors" placeholder="Bajo, Entresuelo, 1, Ático..." /></label>
              <label className="field-group"><span>Puerta</span><input name="door" maxLength={40} defaultValue={home?.door ?? ""} placeholder="A, B, Izquierda..." /></label>
              <label className="field-group"><span>Referencia catastral</span><input name="cadastralReference" maxLength={80} defaultValue={home?.cadastralReference ?? ""} placeholder="20 caracteres" /></label>
            </div>
          </section>
          <section className="home-form-section">
            <div className="home-form-section-title"><span>2</span><div><h3>Superficies y distribución</h3><p>Características privativas que verá la persona vinculada.</p></div></div>
            <div className="form-grid">
              <label className="field-group"><span>Superficie construida (m²)</span><input name="builtAreaM2" type="number" min="0.01" max="1000000" step="0.01" defaultValue={home?.builtAreaM2 ?? ""} placeholder="Ej. 112,40" /></label>
              <label className="field-group"><span>Superficie útil (m²)</span><input name="usableAreaM2" type="number" min="0.01" max="1000000" step="0.01" defaultValue={home?.usableAreaM2 ?? ""} placeholder="Ej. 94,20" /></label>
              <label className="field-group"><span>Dormitorios</span><input name="bedrooms" type="number" min="0" max="99" step="1" defaultValue={home?.bedrooms ?? ""} /></label>
              <label className="field-group"><span>Baños</span><input name="bathrooms" type="number" min="0" max="99" step="1" defaultValue={home?.bathrooms ?? ""} /></label>
            </div>
          </section>
          <section className="home-form-section quota-form-section">
            <div className="home-form-section-title"><span>3</span><div><h3>Cuota ordinaria</h3><p>Registra el criterio aprobado para este inmueble.</p></div></div>
            <div className="form-grid">
              <label className="field-group"><span>Criterio de reparto *</span><select name="quotaMethod" value={quotaMethod} onChange={(event) => setQuotaMethod(event.target.value as PrivateUnit["quotaMethod"])}><option value="participation_coefficient">Según coeficiente de participación</option><option value="fixed_amount">Importe fijo por inmueble</option></select></label>
              <label className="field-group"><span>Periodicidad *</span><select name="quotaFrequency" defaultValue={home?.quotaFrequency ?? "monthly"}><option value="monthly">Mensual</option><option value="quarterly">Trimestral</option><option value="semiannual">Semestral</option><option value="annual">Anual</option></select></label>
              <label className="field-group"><span>Coeficiente de participación (%) *</span><input name="participationCoefficient" type="number" min="0" max="100" step="0.000001" required defaultValue={home?.participationCoefficient ?? 0} /></label>
              {quotaMethod === "fixed_amount" && <label className="field-group"><span>Importe fijo por periodo (€) *</span><input name="fixedQuotaAmount" type="number" min="0" max="999999999" step="0.01" required defaultValue={home?.fixedQuotaAmount ?? ""} placeholder="Ej. 86,50" /></label>}
              <p className="home-form-help field-wide"><Icon name="info" size={16} /> El coeficiente es el porcentaje asignado en el título constitutivo. La superficie útil influye en su fijación, pero el sistema no debe recalcularlo automáticamente solo con los metros.</p>
            </div>
          </section>
          <datalist id="home-sites">{directory.filters.sites.map((value) => <option key={value} value={value} />)}</datalist><datalist id="home-blocks">{directory.filters.blocks.map((value) => <option key={value} value={value} />)}</datalist><datalist id="home-staircases">{directory.filters.staircases.map((value) => <option key={value} value={value} />)}</datalist><datalist id="home-floors">{directory.filters.floors.map((value) => <option key={value} value={value} />)}</datalist>
        </div>
        <DialogFooter busy={busy} close={close} />
      </form>
    </section>
  </div>;
}

function FamilyDialog({ home, busy, close, submit }: { home: PrivateUnit; busy: boolean; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  return <div className="modal-backdrop guided-backdrop" role="presentation">
    <section className="record-dialog guided-dialog family-dialog" role="dialog" aria-modal="true" aria-labelledby="family-dialog-title">
      <header className="dialog-header guided-header">
        <span className="guided-header-icon family"><Icon name="users" size={24} /></span>
        <div><span className="eyebrow">{home.code} · FAMILIA</span><h2 id="family-dialog-title">Añadir a mi familia</h2><p>Registra a una persona que reside contigo sin convertirla en inquilina ni darle acceso a la aplicación.</p></div>
        <button className="icon-button guided-close" type="button" onClick={close} aria-label="Cerrar"><Icon name="close" /></button>
      </header>
      <form className="dialog-form" onSubmit={submit}>
        <div className="dialog-scroll guided-scroll">
          <div className="guided-reassurance family-reassurance"><Icon name="shield-check" size={18} /><span><strong>Solo tú podrás verla por defecto</strong><small>La administración solo verá a esta persona si activas expresamente la casilla inferior.</small></span></div>
          <section className="guided-section">
            <div className="guided-section-title"><span>1</span><div><h3>¿Quién es?</h3><p>Solo pedimos los datos imprescindibles.</p></div></div>
            <div className="guided-fields-stack">
              <label className="guided-field"><span>Nombre y apellidos</span><input name="fullName" required maxLength={180} autoComplete="name" placeholder="Escribe su nombre completo" /></label>
              <label className="guided-field"><span>Relación familiar</span><select name="relationshipType" defaultValue="partner">{Object.entries(householdRelationshipLabels).map(([value, label]) => <option value={value} key={value}>{label}</option>)}</select></label>
            </div>
          </section>
          <section className="guided-section family-sharing-section">
            <div className="guided-section-title"><span>2</span><div><h3>Privacidad</h3><p>Puedes cambiar esta decisión en cualquier momento.</p></div></div>
            <label className="family-consent-card"><input name="sharedWithCommunity" type="checkbox" /><span className="family-consent-check"><Icon name="badge-check" size={18} /></span><span><strong>Compartir con la administración de la comunidad</strong><small>Los cargos autorizados podrán ver su nombre y relación familiar para la gestión comunitaria. No será visible para otros vecinos.</small></span></label>
          </section>
        </div>
        <DialogFooter busy={busy} close={close} submitLabel="Añadir familiar" />
      </form>
    </section>
  </div>;
}

function RelationDialog({ home, mode, busy, close, submit }: { home: PrivateUnit; mode: "manager" | "resident"; busy: boolean; close: () => void; submit: (event: FormEvent<HTMLFormElement>) => void }) {
  if (mode === "resident") {
    return <div className="modal-backdrop guided-backdrop" role="presentation"><section className="record-dialog guided-dialog resident-relation-dialog" role="dialog" aria-modal="true" aria-labelledby="resident-relation-title"><header className="dialog-header guided-header"><span className="guided-header-icon reservation"><Icon name="home" size={24} /></span><div><span className="eyebrow">{home.code} · INQUILINO</span><h2 id="resident-relation-title">Comunicar un inquilino</h2><p>Deja constancia de quién reside de alquiler en tu vivienda.</p></div><button className="icon-button guided-close" type="button" onClick={close} aria-label="Cerrar"><Icon name="close" /></button></header><form className="dialog-form" onSubmit={submit}><input type="hidden" name="relationType" value="tenant" /><div className="dialog-scroll guided-scroll"><div className="guided-reassurance"><Icon name="shield-check" size={18} /><span><strong>La comunicación quedará registrada</strong><small>Guardaremos fecha, referencia y estado de revisión. No crea acceso automático ni sustituye la documentación contractual.</small></span></div><section className="guided-section"><div className="guided-section-title"><span>1</span><div><h3>Datos del inquilino</h3><p>Solo necesitamos lo imprescindible para identificar la comunicación.</p></div></div><div className="guided-fields-stack"><label className="guided-field"><span>Nombre y apellidos</span><input name="fullName" required maxLength={180} autoComplete="name" placeholder="Escribe su nombre completo" /></label><label className="guided-field"><span>Correo electrónico <small>(opcional)</small></span><input name="email" type="email" maxLength={254} autoComplete="email" placeholder="Para poder vincular su acceso más adelante" /></label><label className="guided-field guided-date"><span>¿Desde cuándo vive aquí?</span><input name="validFrom" type="date" required defaultValue={today()} /></label></div></section><details className="guided-optional"><summary>Añadir una observación <span>Opcional</span></summary><label className="guided-field"><span>Algo que la administración deba saber</span><textarea name="notes" rows={3} maxLength={1000} placeholder="Por ejemplo, duración prevista del alquiler" /></label></details></div><DialogFooter busy={busy} close={close} submitLabel="Registrar comunicación" /></form></section></div>;
  }
  return <div className="modal-backdrop" role="presentation"><section className="record-dialog" role="dialog" aria-modal="true"><header className="dialog-header"><div><span className="eyebrow">{home.code}</span><h2>Vincular una persona</h2><p>{locationParts(home).join(" · ") || "Inmueble sin estructura"}</p></div><button className="icon-button" onClick={close}><Icon name="close" /></button></header><form className="dialog-form" onSubmit={submit}><div className="dialog-scroll"><div className="form-grid"><label className="field-group"><span>Nombre completo *</span><input name="fullName" required maxLength={180} /></label><label className="field-group"><span>Correo electrónico</span><input name="email" type="email" maxLength={254} placeholder="Para vincular su acceso" /></label><label className="field-group"><span>Relación *</span><select name="relationType"><option value="owner">Propietario/a</option><option value="co_owner">Copropietario/a</option><option value="tenant">Inquilino/a</option><option value="authorized_resident">Residente autorizado/a</option></select></label><label className="field-group"><span>Porcentaje de propiedad</span><input name="ownershipPercentage" type="number" min="0.0001" max="100" step="0.0001" defaultValue="100" /></label><label className="field-group"><span>Desde *</span><input name="validFrom" type="date" required defaultValue={today()} /></label><label className="field-group field-wide"><span>Observaciones</span><textarea name="notes" rows={3} maxLength={1000} placeholder="Información útil para comprobar la relación" /></label><div className="field-wide check-row"><label><input name="isPrimary" type="checkbox" /> Persona principal</label><label><input name="canVote" type="checkbox" /> Puede votar</label></div></div></div><DialogFooter busy={busy} close={close} /></form></section></div>;
}

function PersonRow({ person, mode, busy, review }: { person: PrivateUnit["relations"][number]; mode: "manager" | "resident"; busy: boolean; review: (id: string, status: "active" | "rejected" | "ended") => void }) {
  const preferences = useTemporalPreferences();
  return <div className="person-row"><span className="person-avatar">{person.fullName.split(/\s+/).slice(0, 2).map((part) => part[0]).join("")}</span><span className="person-copy"><strong>{person.fullName}</strong><small>{relationLabels[person.relationType]}{mode === "manager" && person.email ? ` · ${person.email}` : ""}</small>{person.source === "owner_declaration" && <small className="declaration-meta">Comunicado el {formatDateTime(person.createdAt, preferences)} · {preferences.timeZone} · Ref. {person.id.slice(0, 8).toUpperCase()}</small>}</span><span className={`relation-status ${person.status}`}>{person.status === "active" ? "Validado" : person.status === "rejected" ? "Rechazado" : "Pendiente"}</span>{mode === "manager" && person.status === "pending" && <span className="person-actions"><button type="button" disabled={busy} onClick={() => review(person.id, "active")}>Validar</button><button type="button" disabled={busy} onClick={() => review(person.id, "rejected")}>Rechazar</button></span>}</div>;
}

function DialogFooter({ busy, close, submitLabel = "Guardar" }: { busy: boolean; close: () => void; submitLabel?: string }) {
  return <footer className="dialog-footer"><div><button className="button button-secondary" type="button" disabled={busy} onClick={close}>Cancelar</button></div><div className="dialog-footer-actions"><button className="button button-primary" type="submit" disabled={busy}>{busy && <span className="spinner" />} {submitLabel}</button></div></footer>;
}
