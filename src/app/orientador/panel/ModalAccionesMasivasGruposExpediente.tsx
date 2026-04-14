"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { createPortal } from "react-dom";

type CargaHistorialMin = {
	id: string;
};

const GRADOS_BLOQUE = [1, 2, 3, 4, 5, 6] as const;

type GrupoPeriodo = {
	institucionGrupoId: string;
	grupoTokenId: string | null;
	grado: string;
	grupo: string;
	claveAcceso?: string;
};

type Alcance = "activo" | "inactivo";

type ItemRespuestaAccion = {
	ok: boolean;
	mensaje?: string;
	error?: string;
	institucionGrupoId: string;
};

type ResultadoResumenModal = {
	cuerpoGrande: string;
	erroresPequenos?: string;
};

function etiquetaSeccionGrupo(g: GrupoPeriodo): string {
	return `${g.grado}° ${g.grupo}`;
}

function construirResumenAccionMasiva(
	accion: "subir_grado" | "bajar_grado" | "archivar_grupo",
	seleccionados: GrupoPeriodo[],
	items: ItemRespuestaAccion[],
): ResultadoResumenModal {
	const okIds = new Set(items.filter((i) => i.ok).map((i) => i.institucionGrupoId));
	const exitosos = seleccionados.filter((g) => okIds.has(g.institucionGrupoId));
	const fallos = items.filter((i) => !i.ok);

	const erroresPequenos =
		fallos.length > 0
			? fallos
					.map((it) => {
						const g = seleccionados.find((x) => x.institucionGrupoId === it.institucionGrupoId);
						const nom = g ? etiquetaSeccionGrupo(g) : it.institucionGrupoId;
						return `${nom}: ${it.error ?? "Error"}`;
					})
					.join(" · ")
			: undefined;

	if (exitosos.length === 0) {
		return {
			cuerpoGrande:
				"No se aplicaron cambios a los grupos seleccionados. Revisa los mensajes de error si los hay.",
			erroresPequenos,
		};
	}

	if (accion === "archivar_grupo") {
		const lista = exitosos.map(etiquetaSeccionGrupo).join(", ");
		return {
			cuerpoGrande: `Los siguientes grupos fueron dados de baja (inactivados): ${lista}.`,
			erroresPequenos,
		};
	}

	const byOrigen = new Map<number, GrupoPeriodo[]>();
	for (const g of exitosos) {
		const n = Number.parseInt(String(g.grado), 10) || 0;
		if (n < 1) {
			continue;
		}
		if (!byOrigen.has(n)) {
			byOrigen.set(n, []);
		}
		byOrigen.get(n)!.push(g);
	}

	const partes: string[] = [];
	const ordenados = [...byOrigen.entries()].sort((a, b) => a[0] - b[0]);
	for (const [orig, gs] of ordenados) {
		const dest = accion === "subir_grado" ? orig + 1 : orig - 1;
		const lista = gs.map(etiquetaSeccionGrupo).join(", ");
		if (accion === "subir_grado") {
			partes.push(`Los siguientes grupos subieron de ${orig}.° a ${dest}.°: ${lista}.`);
		} else {
			partes.push(`Los siguientes grupos bajaron de ${orig}.° a ${dest}.°: ${lista}.`);
		}
	}

	const cuerpoGrande =
		partes.length > 0
			? partes.join(" ")
			: `Grupos afectados: ${exitosos.map(etiquetaSeccionGrupo).join(", ")}.`;

	return {
		cuerpoGrande,
		erroresPequenos,
	};
}

export type ModalAccionesMasivasGruposExpedienteProps = {
	abierto: boolean;
	alCerrar: () => void;
	alExito: () => void;
	/** Alineado con «Estado del listado» al abrir el modal */
	alcanceSugerido?: Alcance;
};

export default function ModalAccionesMasivasGruposExpediente({
	abierto,
	alCerrar,
	alExito,
	alcanceSugerido = "activo",
}: ModalAccionesMasivasGruposExpedienteProps) {
	const [montado, setMontado] = useState(false);
	const [cargaId, setCargaId] = useState("");
	const [gradoBloque, setGradoBloque] = useState<number | null>(null);
	const [carreraSubida1a2Id, setCarreraSubida1a2Id] = useState("");
	const [carrerasCatalogo, setCarrerasCatalogo] = useState<{ id: string; nombre: string }[]>([]);
	const [grupos, setGrupos] = useState<GrupoPeriodo[]>([]);
	const [elegidos, setElegidos] = useState<Set<string>>(new Set());
	const [alcance, setAlcance] = useState<Alcance>("activo");
	const [cargandoCargas, setCargandoCargas] = useState(false);
	const [cargandoGrupos, setCargandoGrupos] = useState(false);
	const [ejecutando, setEjecutando] = useState(false);
	const [error, setError] = useState<string | null>(null);
	const [resultadoResumen, setResultadoResumen] = useState<ResultadoResumenModal | null>(null);

	useEffect(() => {
		setMontado(true);
	}, []);

	const cargarContextoEncarga = useCallback(async () => {
		setCargandoCargas(true);
		setError(null);
		try {
			const res = await fetch("/api/orientador/cargas?soloHistorial=1", {
				credentials: "include",
			});
			const data = (await res.json()) as { historial?: CargaHistorialMin[]; error?: string };
			if (!res.ok) {
				setError(data.error ?? "No se pudieron cargar las encargas");
				return;
			}
			const lista = data.historial ?? [];
			const primera = lista[0];
			setCargaId(primera?.id ?? "");
		} catch {
			setError("Error de red al cargar el contexto de la encarga");
		} finally {
			setCargandoCargas(false);
		}
	}, []);

	const cargarCatalogoCarreras = useCallback(async () => {
		try {
			const res = await fetch("/api/orientador/carreras", { credentials: "include" });
			const data = (await res.json()) as { carreras?: { id: string; nombre: string }[] };
			if (res.ok && data.carreras) {
				setCarrerasCatalogo(data.carreras);
			}
		} catch {
			/* opcional en modal */
		}
	}, []);

	const cargarGrupos = useCallback(async (cid: string) => {
		if (!cid.trim()) {
			setGrupos([]);
			return;
		}
		setCargandoGrupos(true);
		setError(null);
		try {
			const res = await fetch(`/api/orientador/cargas/${encodeURIComponent(cid)}/grupos`, {
				credentials: "include",
			});
			const data = (await res.json()) as { grupos?: GrupoPeriodo[]; error?: string };
			if (!res.ok) {
				setError(data.error ?? "No se pudieron cargar los grupos");
				setGrupos([]);
				return;
			}
			setGrupos(data.grupos ?? []);
		} catch {
			setError("Error de red al cargar grupos");
			setGrupos([]);
		} finally {
			setCargandoGrupos(false);
		}
	}, []);

	useEffect(() => {
		if (!abierto) {
			return;
		}
		setAlcance(alcanceSugerido === "inactivo" ? "inactivo" : "activo");
		setError(null);
		setResultadoResumen(null);
		setGradoBloque(null);
		setCarreraSubida1a2Id("");
		void cargarContextoEncarga();
		void cargarCatalogoCarreras();
	}, [abierto, alcanceSugerido, cargarCatalogoCarreras, cargarContextoEncarga]);

	useEffect(() => {
		if (!abierto || !cargaId) {
			return;
		}
		setElegidos(new Set());
		setResultadoResumen(null);
		void cargarGrupos(cargaId);
	}, [abierto, cargaId, cargarGrupos]);

	useEffect(() => {
		if (!abierto) {
			return;
		}
		setElegidos(new Set());
	}, [abierto, gradoBloque]);

	const gruposFiltrados = useMemo(() => {
		if (gradoBloque === null) {
			return [];
		}
		return grupos.filter((g) => (Number.parseInt(String(g.grado), 10) || 0) === gradoBloque);
	}, [grupos, gradoBloque]);

	const seleccionIncluyePrimero = useMemo(() => {
		for (const id of elegidos) {
			const g = grupos.find((x) => x.institucionGrupoId === id);
			if (g && (Number.parseInt(String(g.grado), 10) || 0) === 1) {
				return true;
			}
		}
		return false;
	}, [elegidos, grupos]);

	const subirGradoRequiereCarrera = seleccionIncluyePrimero && !carreraSubida1a2Id.trim();

	const toggleGrupo = (id: string) => {
		setElegidos((prev) => {
			const n = new Set(prev);
			if (n.has(id)) {
				n.delete(id);
			} else {
				n.add(id);
			}
			return n;
		});
	};

	const seleccionarTodos = () => {
		if (gruposFiltrados.length === 0) {
			return;
		}
		const idsVisibles = gruposFiltrados.map((g) => g.institucionGrupoId);
		const todosMarcados = idsVisibles.every((id) => elegidos.has(id));
		if (todosMarcados) {
			setElegidos((prev) => {
				const n = new Set(prev);
				for (const id of idsVisibles) {
					n.delete(id);
				}
				return n;
			});
		} else {
			setElegidos((prev) => {
				const n = new Set(prev);
				for (const id of idsVisibles) {
					n.add(id);
				}
				return n;
			});
		}
	};

	const accionesHabilitadas = alcance === "activo";

	const ejecutar = async (accion: "subir_grado" | "bajar_grado" | "archivar_grupo") => {
		if (!accionesHabilitadas || elegidos.size === 0 || !cargaId) {
			return;
		}
		if (accion === "subir_grado" && subirGradoRequiereCarrera) {
			setError("Elige la carrera para el pase de 1.° a 2.°.");
			return;
		}
		if (accion === "archivar_grupo") {
			const ok = window.confirm(
				"Se marcarán como inactivos (archivo muerto) todos los expedientes activos de los grupos seleccionados. ¿Continuar?",
			);
			if (!ok) {
				return;
			}
		}
		const seleccionados = [...elegidos]
			.map((id) => grupos.find((g) => g.institucionGrupoId === id))
			.filter((g): g is GrupoPeriodo => Boolean(g));
		const incluyeSubidaDesde1 =
			accion === "subir_grado" &&
			seleccionados.some((g) => (Number.parseInt(String(g.grado), 10) || 0) === 1);

		setEjecutando(true);
		setError(null);
		setResultadoResumen(null);
		try {
			const res = await fetch("/api/orientador/expediente/acciones-masivas-grupos", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					cargaId,
					institucionGrupoIds: [...elegidos],
					alcanceListado: alcance,
					accion,
					...(incluyeSubidaDesde1 && carreraSubida1a2Id.trim() !== ""
						? { carreraIdSubida1a2: carreraSubida1a2Id.trim() }
						: {}),
				}),
			});
			const data = (await res.json()) as {
				ok?: boolean;
				items?: ItemRespuestaAccion[];
				error?: string;
			};
			if (!res.ok) {
				setError(data.error ?? "No se pudo completar la acción");
				return;
			}
			setResultadoResumen(construirResumenAccionMasiva(accion, seleccionados, data.items ?? []));
			alExito();
			void cargarGrupos(cargaId);
		} catch {
			setError("Error de red");
		} finally {
			setEjecutando(false);
		}
	};

	const { puedeMostrarSubirGrado, puedeMostrarBajarGrado } = useMemo(() => {
		if (elegidos.size === 0) {
			return { puedeMostrarSubirGrado: false, puedeMostrarBajarGrado: false };
		}
		const seleccionados = grupos.filter((g) => elegidos.has(g.institucionGrupoId));
		if (seleccionados.length === 0) {
			return { puedeMostrarSubirGrado: false, puedeMostrarBajarGrado: false };
		}
		const grados = seleccionados.map((g) => Number.parseInt(String(g.grado), 10) || 0);
		const puedeSubir = grados.every((n) => n >= 1 && n < 6);
		const puedeBajar = grados.every((n) => n > 1 && n <= 6);
		return { puedeMostrarSubirGrado: puedeSubir, puedeMostrarBajarGrado: puedeBajar };
	}, [elegidos, grupos]);

	if (!montado || !abierto) {
		return null;
	}

	return createPortal(
		<div
			className="fixed inset-0 z-[120] flex items-center justify-center bg-black/45 p-4"
			role="presentation"
			onMouseDown={(e) => {
				if (e.target === e.currentTarget) {
					alCerrar();
				}
			}}
		>
			<div
				className="flex max-h-[min(92vh,92dvh)] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-[#E2E8F0] bg-white shadow-xl"
				role="dialog"
				aria-labelledby="modal-acciones-grupos-titulo"
				onMouseDown={(e) => e.stopPropagation()}
			>
				<div className="shrink-0 border-b border-[#E2E8F0] px-5 py-4">
					<h2 id="modal-acciones-grupos-titulo" className="text-base font-bold text-[#1E293B]">
						Acciones por grupo
					</h2>
					{resultadoResumen ? (
						<div className="mt-4 rounded-xl border-2 border-[#DDD6FE] bg-gradient-to-b from-[#F5F3FF] to-white px-4 py-4 text-center shadow-sm">
							<p className="text-lg font-bold leading-snug text-[#0F172A] sm:text-2xl">
								{resultadoResumen.cuerpoGrande}
							</p>
							{resultadoResumen.erroresPequenos ? (
								<p className="mt-3 text-xs leading-relaxed text-red-700">{resultadoResumen.erroresPequenos}</p>
							) : null}
						</div>
					) : null}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 py-4">
					{cargandoCargas && !cargaId ? (
						<p className="mb-3 text-xs text-[#64748B]">Cargando encarga…</p>
					) : null}
					{!cargandoCargas && !cargaId ? (
						<p className="mb-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
							No hay encargas en el historial. Crea una carga de alumnos primero.
						</p>
					) : null}

					<div className="mb-3">
						<div className="relative inline-grid w-full max-w-xs grid-cols-2 rounded-xl border border-[#D1D5DB] bg-[#F3F4F6] p-1">
							<span
								aria-hidden
								className={`absolute top-1 h-[calc(100%-0.5rem)] w-[calc(50%-0.25rem)] rounded-lg shadow-sm transition-all duration-200 ${
									alcance === "activo"
										? "left-1 bg-[#7C3AED]"
										: "left-[calc(50%+0.125rem)] bg-[#2563EB]"
								}`}
							/>
							<button
								type="button"
								onClick={() => setAlcance("activo")}
								disabled={ejecutando}
								className={`relative z-10 rounded-lg px-3 py-2 text-xs font-semibold ${
									alcance === "activo" ? "text-white" : "text-[#374151]"
								}`}
							>
								Activo
							</button>
							<button
								type="button"
								onClick={() => setAlcance("inactivo")}
								disabled={ejecutando}
								className={`relative z-10 rounded-lg px-3 py-2 text-xs font-semibold ${
									alcance === "inactivo" ? "text-white" : "text-[#1E40AF]"
								}`}
							>
								Inactivo
							</button>
						</div>
						{alcance === "inactivo" ? (
							<p className="mt-2 text-xs text-[#B45309]">
								Subir/bajar grado e inactivar grupo solo aplican a expedientes activos. Cambia a «Activo»
								para usar las acciones.
							</p>
						) : null}
					</div>

					<div className="mb-3">
						<p className="mb-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">Grado</p>
						<div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
							{GRADOS_BLOQUE.map((gd) => {
								const activo = gradoBloque === gd;
								return (
									<button
										key={gd}
										type="button"
										onClick={() => setGradoBloque(gd)}
										disabled={!cargaId || cargandoGrupos || ejecutando}
										className={`rounded-xl border-2 px-2 py-3 text-center text-sm font-bold transition disabled:cursor-not-allowed disabled:opacity-40 ${
											activo
												? "border-[#7C3AED] bg-[#EDE9FE] text-[#5B21B6]"
												: "border-[#E2E8F0] bg-[#F8FAFC] text-[#475569] hover:border-[#C4B5FD]"
										}`}
									>
										{gd}.°
									</button>
								);
							})}
						</div>
					</div>

					{seleccionIncluyePrimero ? (
						<label className="mb-3 flex flex-col gap-1">
							<span className="text-xs font-semibold text-[#475569]">
								Carrera al subir de 1.° a 2.° (obligatoria si usas «Subir grado» con 1.°)
							</span>
							<select
								value={carreraSubida1a2Id}
								onChange={(e) => setCarreraSubida1a2Id(e.target.value)}
								disabled={!cargaId || ejecutando}
								className="rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-sm text-[#111827] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#EDE9FE]"
							>
								<option value="">— Elige carrera —</option>
								{carrerasCatalogo.map((c) => (
									<option key={c.id} value={c.id}>
										{c.nombre}
									</option>
								))}
							</select>
							{subirGradoRequiereCarrera ? (
								<span className="text-[11px] text-amber-800">
									Selecciona una carrera antes de subir grado desde 1.°.
								</span>
							) : null}
						</label>
					) : null}

					<div className="mb-2 flex items-center justify-between gap-2">
						<span className="text-xs font-semibold text-[#475569]">
							Grupos (secciones)
							{gradoBloque !== null ? (
								<span className="font-normal text-[#64748B]"> · {gradoBloque}.°</span>
							) : null}
						</span>
						<button
							type="button"
							onClick={seleccionarTodos}
							disabled={gruposFiltrados.length === 0 || cargandoGrupos || ejecutando}
							className="text-xs font-semibold text-[#7C3AED] hover:underline disabled:opacity-40"
						>
							{gruposFiltrados.length > 0 &&
							gruposFiltrados.every((g) => elegidos.has(g.institucionGrupoId))
								? "Quitar selección (visibles)"
								: "Seleccionar todos (visibles)"}
						</button>
					</div>

					{cargandoGrupos ? (
						<p className="py-6 text-center text-sm text-[#64748B]">Cargando grupos…</p>
					) : !cargaId ? (
						<p className="py-6 text-center text-sm text-[#64748B]">Aún no hay encarga disponible.</p>
					) : gradoBloque === null ? (
						<p className="py-6 text-center text-sm text-[#64748B]">
							Elige un grado arriba (1.° a 6.°) para listar las secciones de esa generación.
						</p>
					) : grupos.length === 0 ? (
						<p className="py-6 text-center text-sm text-[#64748B]">
							No hay secciones en el catálogo para el grado y letras de esta encarga.
						</p>
					) : gruposFiltrados.length === 0 ? (
						<p className="py-6 text-center text-sm text-[#64748B]">
							No hay secciones de {gradoBloque}.° en esta encarga (revisa líneas de la carga o el padrón).
						</p>
					) : (
						<ul className="space-y-1 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-2">
							{gruposFiltrados.map((g) => {
								const marcado = elegidos.has(g.institucionGrupoId);
								const sinToken = !g.grupoTokenId;
								return (
									<li key={g.institucionGrupoId}>
										<label
											className={`flex cursor-pointer items-center gap-3 rounded-lg px-2 py-2 text-sm transition ${
												marcado ? "bg-[#EDE9FE]" : "hover:bg-white"
											}`}
										>
											<input
												type="checkbox"
												checked={marcado}
												onChange={() => toggleGrupo(g.institucionGrupoId)}
												disabled={ejecutando}
												className="h-4 w-4 rounded border-[#CBD5E1] text-[#7C3AED] focus:ring-[#7C3AED]"
											/>
											<span className="font-semibold text-[#1E293B]">
												{g.grado}° {g.grupo}
											</span>
											{sinToken ? (
												<span className="ml-auto text-[10px] font-medium text-[#B45309]">Sin token</span>
											) : null}
										</label>
									</li>
								);
							})}
						</ul>
					)}

					{error ? (
						<p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-800">
							{error}
						</p>
					) : null}
				</div>

				<div className="flex shrink-0 flex-col gap-2 border-t border-[#E2E8F0] bg-[#FAFAFA] px-5 py-4 sm:flex-row sm:flex-wrap sm:items-center sm:justify-between">
					<div className="flex flex-wrap gap-2">
						{puedeMostrarSubirGrado ? (
							<button
								type="button"
								disabled={
									!accionesHabilitadas || !cargaId || ejecutando || subirGradoRequiereCarrera
								}
								onClick={() => void ejecutar("subir_grado")}
								className="rounded-xl border-2 border-[#BAE6FD] bg-[#E0F2FE] px-3 py-2 text-xs font-semibold text-[#0369A1] transition hover:bg-[#BAE6FD] disabled:cursor-not-allowed disabled:opacity-45"
							>
								Subir grado
							</button>
						) : null}
						{puedeMostrarBajarGrado ? (
							<button
								type="button"
								disabled={!accionesHabilitadas || !cargaId || ejecutando}
								onClick={() => void ejecutar("bajar_grado")}
								className="rounded-xl border-2 border-[#BAE6FD] bg-[#E0F2FE] px-3 py-2 text-xs font-semibold text-[#0369A1] transition hover:bg-[#BAE6FD] disabled:cursor-not-allowed disabled:opacity-45"
							>
								Bajar grado
							</button>
						) : null}
						<button
							type="button"
							disabled={!accionesHabilitadas || !cargaId || elegidos.size === 0 || ejecutando}
							onClick={() => void ejecutar("archivar_grupo")}
							className="rounded-xl border-2 border-[#FECACA] bg-[#FEF2F2] px-3 py-2 text-xs font-semibold text-[#B91C1C] transition hover:bg-[#FEE2E2] disabled:cursor-not-allowed disabled:opacity-45"
						>
							Inactivar grupo
						</button>
					</div>
					<button
						type="button"
						onClick={alCerrar}
						disabled={ejecutando}
						className="rounded-xl border border-[#D1D5DB] bg-white px-4 py-2 text-sm font-semibold text-[#374151] hover:bg-[#F3F4F6] disabled:opacity-50"
					>
						Cerrar
					</button>
				</div>
				{ejecutando ? (
					<p className="shrink-0 border-t border-[#E2E8F0] bg-[#FAFAFA] px-5 py-2 text-center text-xs text-[#64748B]">
						Aplicando…
					</p>
				) : null}
			</div>
		</div>,
		document.body,
	);
}
