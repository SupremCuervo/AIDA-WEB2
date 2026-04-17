"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

type RegistroLog = {
	id: string;
	creado_en: string;
	actor_tipo: string;
	actor_etiqueta: string;
	correo_electronico?: string;
	accion: string;
	entidad: string;
	entidad_id: string | null;
	origen: string;
	grado_contexto: string | null;
	grupo_contexto: string | null;
};

function formatearFechaHora(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) {
		return iso;
	}
	const dd = String(d.getDate()).padStart(2, "0");
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const yyyy = d.getFullYear();
	const hh = String(d.getHours()).padStart(2, "0");
	const min = String(d.getMinutes()).padStart(2, "0");
	return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function textoCorreoAuditoria(r: RegistroLog): string {
	const c = typeof r.correo_electronico === "string" ? r.correo_electronico.trim() : "";
	if (c !== "") {
		return c;
	}
	const et = typeof r.actor_etiqueta === "string" ? r.actor_etiqueta.trim() : "";
	if (et !== "" && et.toLowerCase() !== "sistema" && et.includes("@")) {
		return et;
	}
	return "—";
}

function textoContexto(v: string | null): string {
	if (v == null || String(v).trim() === "") {
		return "—";
	}
	return String(v).trim();
}

const GRADO_MAX_HISTORIAL = 6;

function sanitizarFiltroGrado(valor: string): string {
	const d = valor.replace(/\D/g, "").slice(0, 1);
	if (d === "") {
		return "";
	}
	const n = Number.parseInt(d, 10);
	if (!Number.isFinite(n) || n < 1 || n > GRADO_MAX_HISTORIAL) {
		return "";
	}
	return String(n);
}

function sanitizarFiltroGrupoLetra(valor: string): string {
	const letra = valor.replace(/[^A-Za-zÁÉÍÓÚÑáéíóúñ]/g, "").slice(0, 1);
	return letra.toUpperCase();
}

export default function HistorialAccionesOrientador() {
	const [cargando, setCargando] = useState(true);
	const [error, setError] = useState("");
	const [registros, setRegistros] = useState<RegistroLog[]>([]);

	const [filtroDesde, setFiltroDesde] = useState("");
	const [filtroHasta, setFiltroHasta] = useState("");
	const [filtroAccion, setFiltroAccion] = useState("");
	const [listaAcciones, setListaAcciones] = useState<string[]>([]);
	const [cargandoListaAcciones, setCargandoListaAcciones] = useState(true);
	const [filtroCorreo, setFiltroCorreo] = useState("");
	const [filtroGrado, setFiltroGrado] = useState("");
	const [filtroGrupo, setFiltroGrupo] = useState("");
	const [filtroInicialAplicado, setFiltroInicialAplicado] = useState(false);

	const sugerenciasAccionDatalist = useMemo(() => {
		const q = filtroAccion.trim().toLowerCase();
		const max = 120;
		if (q === "") {
			return listaAcciones.slice(0, max);
		}
		return listaAcciones.filter((a) => a.toLowerCase().includes(q)).slice(0, max);
	}, [listaAcciones, filtroAccion]);

	const cargar = useCallback(async () => {
		setCargando(true);
		setError("");
		try {
			const params = new URLSearchParams();
			if (filtroDesde.trim() !== "") {
				params.set("desde", filtroDesde.trim());
			}
			if (filtroHasta.trim() !== "") {
				params.set("hasta", filtroHasta.trim());
			}
			if (filtroAccion.trim() !== "") {
				params.set("accion", filtroAccion.trim());
			}
			if (filtroCorreo.trim() !== "") {
				params.set("correo", filtroCorreo.trim());
			}
			if (filtroGrado.trim() !== "") {
				params.set("grado", filtroGrado.trim());
			}
			if (filtroGrupo.trim() !== "") {
				params.set("grupo", filtroGrupo.trim());
			}
			const qs = params.toString();
			const res = await fetch(
				qs ? `/api/orientador/logs?${qs}` : "/api/orientador/logs",
				{ credentials: "include" },
			);
			const data = (await res.json()) as { ok?: boolean; registros?: RegistroLog[]; error?: string };
			if (!res.ok) {
				setError(data.error ?? "No se pudo cargar el historial");
				setRegistros([]);
				return;
			}
			const lista = data.registros ?? [];
			setRegistros(lista);
			setListaAcciones((prev) => {
				const s = new Set(prev);
				for (const r of lista) {
					const a = typeof r.accion === "string" ? r.accion.trim() : "";
					if (a !== "") {
						s.add(a);
					}
				}
				return [...s].sort((x, y) => x.localeCompare(y, "es"));
			});
		} catch {
			setError("Error de red");
			setRegistros([]);
		} finally {
			setCargando(false);
		}
	}, [filtroDesde, filtroHasta, filtroAccion, filtroCorreo, filtroGrado, filtroGrupo]);

	useEffect(() => {
		void cargar();
		// Carga inicial.
		// eslint-disable-next-line react-hooks/exhaustive-deps
	}, []);

	useEffect(() => {
		if (!filtroInicialAplicado) {
			setFiltroInicialAplicado(true);
			return;
		}
		const id = window.setTimeout(() => {
			void cargar();
		}, 250);
		return () => window.clearTimeout(id);
	}, [filtroDesde, filtroHasta, filtroAccion, filtroCorreo, filtroGrado, filtroGrupo, cargar, filtroInicialAplicado]);

	useEffect(() => {
		void (async () => {
			setCargandoListaAcciones(true);
			try {
				const res = await fetch("/api/orientador/logs/acciones", { credentials: "include" });
				const j = (await res.json()) as { ok?: boolean; acciones?: string[] };
				if (res.ok && Array.isArray(j.acciones)) {
					setListaAcciones(j.acciones);
				} else {
					setListaAcciones([]);
				}
			} catch {
				setListaAcciones([]);
			} finally {
				setCargandoListaAcciones(false);
			}
		})();
	}, []);

	return (
		<div id="sec-historial" className="mx-auto w-full max-w-none scroll-mt-24 pb-12 pt-4">
			<h2 className="mb-8 text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
				Historial de Acciones
			</h2>

			<div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60">

				<div className="border-b border-slate-200 bg-white px-4 py-3 sm:px-6">
					<div className="mx-auto flex w-full max-w-5xl flex-wrap items-end justify-center gap-x-3 gap-y-2">
						<label className="flex w-[148px] shrink-0 flex-col gap-1 text-xs font-medium text-slate-600">
							Desde
							<input
								type="date"
								value={filtroDesde}
								onChange={(e) => setFiltroDesde(e.target.value)}
								className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900"
							/>
						</label>
						<label className="flex w-[148px] shrink-0 flex-col gap-1 text-xs font-medium text-slate-600">
							Hasta
							<input
								type="date"
								value={filtroHasta}
								onChange={(e) => setFiltroHasta(e.target.value)}
								className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900"
							/>
						</label>
						<label className="flex w-[min(100%,22rem)] min-w-[12rem] shrink-0 flex-col gap-1 text-xs font-medium text-slate-600">
							Acción
							<input
								type="search"
								list="historial-acciones-datalist"
								autoComplete="off"
								value={filtroAccion}
								onChange={(e) => setFiltroAccion(e.target.value)}
								placeholder={
									cargandoListaAcciones
										? "Cargando sugerencias…"
										: "Escribe para filtrar (coincidencia parcial)"
								}
								className="w-full max-w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400"
								title="Filtra por texto contenido en la acción. Las sugerencias son acciones ya registradas."
							/>
							<datalist id="historial-acciones-datalist">
								{sugerenciasAccionDatalist.map((a) => (
									<option key={a} value={a} />
								))}
							</datalist>
						</label>
						<label className="flex w-[min(100%,14rem)] min-w-[10rem] shrink-0 flex-col gap-1 text-xs font-medium text-slate-600">
							Correo
							<input
								type="search"
								autoComplete="off"
								value={filtroCorreo}
								onChange={(e) => setFiltroCorreo(e.target.value)}
								placeholder="correo@…"
								className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-sm text-slate-900 placeholder:text-slate-400"
							/>
						</label>
						<div className="flex shrink-0 items-end gap-2">
							<label className="flex w-14 flex-col gap-1 text-xs font-medium text-slate-600">
								Grado
								<input
									type="text"
									inputMode="numeric"
									pattern="[1-6]"
									maxLength={1}
									title="Un solo dígito del 1 al 6"
									value={filtroGrado}
									onChange={(e) => setFiltroGrado(sanitizarFiltroGrado(e.target.value))}
									placeholder="1"
									className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm tabular-nums text-slate-900 placeholder:text-slate-400"
								/>
							</label>
							<label className="flex w-14 flex-col gap-1 text-xs font-medium text-slate-600">
								Grupo
								<input
									type="text"
									inputMode="text"
									maxLength={1}
									title="Una sola letra"
									value={filtroGrupo}
									onChange={(e) => setFiltroGrupo(sanitizarFiltroGrupoLetra(e.target.value))}
									placeholder="A"
									className="w-full rounded-lg border border-slate-200 bg-white px-2 py-1.5 text-center text-sm uppercase text-slate-900 placeholder:text-slate-400"
								/>
							</label>
						</div>
					</div>
				</div>

				{cargando && registros.length === 0 ? (
					<p className="px-6 py-10 text-center text-slate-500">Cargando historial…</p>
				) : error ? (
					<p className="px-6 py-10 text-center text-sm font-medium text-red-600" role="alert">
						{error}
					</p>
				) : registros.length === 0 ? (
					<p className="px-6 py-10 text-center text-slate-500">No hay registro en el sistema.</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[880px] border-collapse text-left text-sm">
							<thead>
								<tr className="border-b border-slate-200 bg-slate-50">
									<th className="px-4 py-3 font-bold text-slate-800 sm:px-6">Correo electrónico</th>
									<th className="px-4 py-3 font-bold text-slate-800 sm:px-6">Acción</th>
									<th className="px-4 py-3 font-bold text-slate-800 sm:px-6">Grado</th>
									<th className="px-4 py-3 font-bold text-slate-800 sm:px-6">Grupo</th>
									<th className="px-4 py-3 text-right font-bold text-slate-800 sm:px-6">
										Fecha y Hora
									</th>
								</tr>
							</thead>
							<tbody>
								{registros.map((r) => (
									<tr
										key={r.id}
										className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80"
									>
										<td className="max-w-[140px] truncate px-4 py-3 align-top font-medium text-slate-800 sm:max-w-[200px] sm:px-6">
											{textoCorreoAuditoria(r)}
										</td>
										<td className="px-4 py-3 align-top text-slate-700 sm:px-6">{r.accion}</td>
										<td className="whitespace-nowrap px-4 py-3 align-top tabular-nums text-slate-600 sm:px-6">
											{textoContexto(r.grado_contexto)}
										</td>
										<td className="whitespace-nowrap px-4 py-3 align-top text-slate-600 sm:px-6">
											{textoContexto(r.grupo_contexto)}
										</td>
										<td className="whitespace-nowrap px-4 py-3 text-right align-top tabular-nums text-slate-600 sm:px-6">
											{formatearFechaHora(r.creado_en)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
