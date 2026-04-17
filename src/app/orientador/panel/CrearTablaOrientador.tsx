"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DURACION_MENSAJE_EMERGENTE_MS } from "@/lib/ui/duracion-mensaje-emergente-ms";

/** Columnas editables de la tabla. */
type ColKey = "grado" | "grupo" | "nombre" | "carrera" | "matricula";

type AlumnoExp = {
	nombreCompleto: string;
	matricula: string;
	grado: string;
	grupo: string;
	carreraNombre: string;
	cuentaId: string | null;
	documentosBaseSubidos?: number;
	documentosBaseTotales?: number;
	tieneDocumentoRechazado?: boolean;
	tieneDocumentoAceptado?: boolean;
};

type FilaEditable = { id: string; esManual?: boolean } & Record<ColKey, string>;

const ORDEN_COLUMNAS: ColKey[] = ["grado", "grupo", "nombre", "carrera", "matricula"];

const ETIQUETA_DEFAULT: Record<ColKey, string> = {
	grado: "Grado",
	grupo: "Grupo",
	nombre: "Nombre",
	carrera: "Carrera",
	matricula: "Matrícula",
};

/** Columnas que el usuario marca en «Información» (sin escribir). */
const COLUMNAS_INFORMACION: { key: ColKey; descripcion: string }[] = [
	{ key: "nombre", descripcion: "Nombre del alumno" },
	{ key: "carrera", descripcion: "Carrera" },
	{ key: "matricula", descripcion: "Matrícula" },
	{ key: "grado", descripcion: "Grado (en tabla)" },
	{ key: "grupo", descripcion: "Grupo (en tabla)" },
];

function filaVacia(esManual = false): FilaEditable {
	return {
		id: crypto.randomUUID(),
		esManual,
		grado: "",
		grupo: "",
		nombre: "",
		carrera: "",
		matricula: "",
	};
}

/** Valor estable para opciones y comparación cuando el dato viene vacío. */
function normalizaOpcionFiltro(raw: string | null | undefined): string {
	const t = String(raw ?? "").trim();
	return t === "" ? "(sin dato)" : t;
}

function valoresUnicosOpcion(candidatos: AlumnoExp[], clave: "grado" | "grupo" | "carreraNombre"): string[] {
	const set = new Set<string>();
	for (const a of candidatos) {
		const raw = clave === "grado" ? a.grado : clave === "grupo" ? a.grupo : a.carreraNombre;
		set.add(normalizaOpcionFiltro(raw));
	}
	return Array.from(set).sort((x, y) => x.localeCompare(y, "es"));
}

function pasaFiltrosValor(
	a: AlumnoExp,
	selGrados: string[],
	selGrupos: string[],
	selCarreras: string[],
): boolean {
	const g = normalizaOpcionFiltro(a.grado);
	const gr = normalizaOpcionFiltro(a.grupo);
	const c = normalizaOpcionFiltro(a.carreraNombre);
	if (selGrados.length > 0 && !selGrados.includes(g)) {
		return false;
	}
	if (selGrupos.length > 0 && !selGrupos.includes(gr)) {
		return false;
	}
	if (selCarreras.length > 0 && !selCarreras.includes(c)) {
		return false;
	}
	return true;
}

function filaDesdeAlumno(a: AlumnoExp): FilaEditable {
	return {
		...filaVacia(false),
		grado: a.grado ?? "",
		grupo: a.grupo ?? "",
		nombre: a.nombreCompleto ?? "",
		carrera: a.carreraNombre ?? "",
		matricula: a.matricula ?? "",
	};
}

function toggleEnListaOrdenada(prev: string[], valor: string): string[] {
	if (prev.includes(valor)) {
		return prev.filter((x) => x !== valor);
	}
	return [...prev, valor].sort((a, b) => a.localeCompare(b, "es"));
}

function escapeCsv(c: string): string {
	const s = String(c ?? "");
	if (/[",\n\r]/.test(s)) {
		return `"${s.replace(/"/g, '""')}"`;
	}
	return s;
}

function escapeHtml(s: string): string {
	return String(s)
		.replace(/&/g, "&amp;")
		.replace(/</g, "&lt;")
		.replace(/>/g, "&gt;")
		.replace(/"/g, "&quot;");
}

function inicialIncluirColumnas(): Record<ColKey, boolean> {
	return {
		nombre: true,
		carrera: true,
		matricula: true,
		grado: true,
		grupo: true,
	};
}

export default function CrearTablaOrientador() {
	const [incluirColumna, setIncluirColumna] = useState<Record<ColKey, boolean>>(inicialIncluirColumnas);
	const [titulosColumna, setTitulosColumna] = useState<Record<ColKey, string>>(() => ({ ...ETIQUETA_DEFAULT }));

	const [reqCuenta, setReqCuenta] = useState<
		| "todos"
		| "con_cuenta"
		| "sin_cuenta"
		| "con_documento_rechazado"
		| "con_documento_aceptado"
	>("todos");
	const [reqDocsBase, setReqDocsBase] = useState("");

	const [filas, setFilas] = useState<FilaEditable[]>([]);
	const [candidatosPool, setCandidatosPool] = useState<AlumnoExp[]>([]);
	const [opcionesGrado, setOpcionesGrado] = useState<string[]>([]);
	const [opcionesGrupo, setOpcionesGrupo] = useState<string[]>([]);
	const [opcionesCarrera, setOpcionesCarrera] = useState<string[]>([]);
	const [selGrados, setSelGrados] = useState<string[]>([]);
	const [selGrupos, setSelGrupos] = useState<string[]>([]);
	const [selCarreras, setSelCarreras] = useState<string[]>([]);
	const [cargando, setCargando] = useState(false);
	const [error, setError] = useState("");

	const columnasVisibles = useMemo(
		() => ORDEN_COLUMNAS.filter((k) => incluirColumna[k]),
		[incluirColumna],
	);

	useEffect(() => {
		if (!error.trim()) {
			return;
		}
		const id = window.setTimeout(() => setError(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [error]);

	const toggleColumna = useCallback((key: ColKey) => {
		setIncluirColumna((prev) => ({ ...prev, [key]: !prev[key] }));
	}, []);

	useEffect(() => {
		setFilas((prev) => {
			const manuales = prev.filter((f) => f.esManual === true);
			if (candidatosPool.length === 0) {
				return manuales;
			}
			const filtrados = candidatosPool.filter((a) =>
				pasaFiltrosValor(a, selGrados, selGrupos, selCarreras),
			);
			return [...filtrados.map(filaDesdeAlumno), ...manuales];
		});
	}, [candidatosPool, selGrados, selGrupos, selCarreras]);

	const buscar = useCallback(async () => {
		const algunaColumna = ORDEN_COLUMNAS.some((k) => incluirColumna[k]);
		if (!algunaColumna) {
			setError("Marca al menos un dato en Información (casillas moradas).");
			return;
		}

		setError("");
		setCargando(true);
		try {
			const p = new URLSearchParams();
			p.set("estado", "activo");

			const res = await fetch(`/api/orientador/expediente?${p.toString()}`, {
				credentials: "include",
			});
			const data = (await res.json()) as { alumnos?: AlumnoExp[]; error?: string };
			if (!res.ok) {
				setError(data.error ?? "No se pudo cargar la información");
				setCandidatosPool([]);
				setOpcionesGrado([]);
				setOpcionesGrupo([]);
				setOpcionesCarrera([]);
				setSelGrados([]);
				setSelGrupos([]);
				setSelCarreras([]);
				setFilas((prev) => prev.filter((f) => f.esManual === true));
				return;
			}
			// TODO(BD): mapear telefono, tutor, curp desde la respuesta cuando existan en API / padron.
			const candidatos = (data.alumnos ?? []).filter((a) => {
				if (reqCuenta === "con_cuenta" && !a.cuentaId) {
					return false;
				}
				if (reqCuenta === "sin_cuenta" && a.cuentaId) {
					return false;
				}
				if (reqCuenta === "con_documento_rechazado" && !a.tieneDocumentoRechazado) {
					return false;
				}
				if (reqCuenta === "con_documento_aceptado" && !a.tieneDocumentoAceptado) {
					return false;
				}
				const docs = Number(a.documentosBaseSubidos ?? 0);
				if (reqDocsBase.trim() !== "") {
					const objetivo = Number.parseInt(reqDocsBase, 10);
					if (!Number.isFinite(objetivo) || docs !== objetivo) {
						return false;
					}
				}
				return true;
			});
			setCandidatosPool(candidatos);
			setOpcionesGrado(valoresUnicosOpcion(candidatos, "grado"));
			setOpcionesGrupo(valoresUnicosOpcion(candidatos, "grupo"));
			setOpcionesCarrera(valoresUnicosOpcion(candidatos, "carreraNombre"));
			setSelGrados([]);
			setSelGrupos([]);
			setSelCarreras([]);
		} catch {
			setError("Error de red");
			setCandidatosPool([]);
			setOpcionesGrado([]);
			setOpcionesGrupo([]);
			setOpcionesCarrera([]);
			setSelGrados([]);
			setSelGrupos([]);
			setSelCarreras([]);
			setFilas((prev) => prev.filter((f) => f.esManual === true));
		} finally {
			setCargando(false);
		}
	}, [incluirColumna, reqCuenta, reqDocsBase]);

	const actualizarCelda = useCallback((id: string, key: ColKey, valor: string) => {
		setFilas((prev) => prev.map((f) => (f.id === id ? { ...f, [key]: valor } : f)));
	}, []);

	const eliminarFila = useCallback((id: string) => {
		setFilas((prev) => prev.filter((f) => f.id !== id));
	}, []);

	const agregarFila = useCallback(() => {
		setFilas((prev) => [...prev, filaVacia(true)]);
	}, []);

	const descargarExcel = useCallback(() => {
		if (filas.length === 0 || columnasVisibles.length === 0) {
			return;
		}
		const encabezados = columnasVisibles.map((k) => escapeCsv(titulosColumna[k] ?? ETIQUETA_DEFAULT[k])).join(",");
		const cuerpo = filas
			.map((f) => columnasVisibles.map((k) => escapeCsv(f[k])).join(","))
			.join("\n");
		const csv = `\uFEFF${encabezados}\n${cuerpo}`;
		const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = "tabla_alumnos.csv";
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}, [columnasVisibles, filas, titulosColumna]);

	const imprimir = useCallback(() => {
		if (filas.length === 0 || columnasVisibles.length === 0) {
			return;
		}
		const ths = columnasVisibles
			.map(
				(k) =>
					`<th style="border:1px solid #333;padding:8px;text-align:left">${escapeHtml(titulosColumna[k] ?? ETIQUETA_DEFAULT[k])}</th>`,
			)
			.join("");
		const trs = filas
			.map(
				(f) =>
					`<tr>${columnasVisibles.map((k) => `<td style="border:1px solid #333;padding:6px">${escapeHtml(f[k])}</td>`).join("")}</tr>`,
			)
			.join("");
		const html = `<!DOCTYPE html><html lang="es"><head><meta charset="utf-8"/><title>Tabla alumnos</title>
			<style>body{font-family:system-ui,sans-serif;padding:16px}table{border-collapse:collapse;width:100%}</style>
			</head><body><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></body></html>`;
		const w = window.open("", "_blank");
		if (!w) {
			return;
		}
		w.document.write(html);
		w.document.close();
		w.focus();
		w.print();
		w.close();
	}, [columnasVisibles, filas, titulosColumna]);

	return (
		<div className="mx-auto mt-5 w-full max-w-full rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm sm:p-6">
			<p className="text-sm leading-relaxed text-[#374151] sm:text-[0.95rem]">
				A la <strong className="text-[#5B21B6]">izquierda</strong> marcas columnas y filtros; a la{" "}
				<strong className="text-[#5B21B6]">derecha</strong> ves la tabla, buscas, agregas filas y exportas. Si falta algún
				dato, edítalo directo en la tabla.
			</p>

			<div className="mt-6 grid grid-cols-1 gap-8 lg:grid-cols-[minmax(16rem,20rem)_1fr] lg:items-start xl:grid-cols-[minmax(17.5rem,22rem)_1fr]">
				<aside className="flex min-w-0 flex-col gap-8 rounded-2xl border border-[#DDD6FE] bg-gradient-to-b from-[#FAF5FF] via-white to-[#F5F3FF] p-4 shadow-sm ring-1 ring-[#EDE9FE]/80 sm:p-5 lg:sticky lg:top-24 lg:self-start">
					<div>
						<h3 className="mb-1 text-base font-bold tracking-tight text-[#111827]">Información</h3>
						<p className="mb-3 text-xs leading-snug text-[#6B7280]">
							Casillas moradas: qué columnas salen en la tabla y en la exportación.
						</p>
						<div className="flex flex-col gap-2">
							{COLUMNAS_INFORMACION.map(({ key, descripcion }) => (
								<label
									key={key}
									className={`flex cursor-pointer items-start gap-3 rounded-xl border-2 px-3 py-2.5 transition ${
										incluirColumna[key]
											? "border-[#7C3AED] bg-[#EDE9FE] shadow-sm"
											: "border-[#E5E7EB] bg-white/80 hover:border-[#C4B5FD]"
									}`}
								>
									<input
										type="checkbox"
										checked={incluirColumna[key]}
										onChange={() => toggleColumna(key)}
										className="mt-0.5 h-5 w-5 shrink-0 rounded border-[#A78BFA] text-[#7C3AED] focus:ring-2 focus:ring-[#A78BFA] focus:ring-offset-0"
										style={{ accentColor: "#7C3AED" }}
									/>
									<span className="min-w-0">
										<span className="block text-sm font-bold text-[#111827]">{ETIQUETA_DEFAULT[key]}</span>
										<span className="mt-0.5 block text-xs leading-snug text-[#6B7280]">{descripcion}</span>
									</span>
								</label>
							))}
						</div>
					</div>

					<div className="border-t border-[#E9D5FF] pt-6">
						<h3 className="mb-1 text-base font-bold tracking-tight text-[#111827]">Requisitos</h3>
						<p className="mb-3 text-sm font-medium leading-snug text-[#4B5563]">
							Filtros clave para ver todo sin saturar opciones.
						</p>
						<div className="flex flex-col gap-3">
							<div>
								<label htmlFor="ct-req-cuenta" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
									Filtro de alumnos
								</label>
								<select
									id="ct-req-cuenta"
									value={reqCuenta}
									onChange={(e) => {
										setReqCuenta(
											e.target.value as
												| "todos"
												| "con_cuenta"
												| "sin_cuenta"
												| "con_documento_rechazado"
												| "con_documento_aceptado",
										);
									}}
									className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-sm text-[#111827] shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] outline-none focus:border-[#A78BFA] focus:ring-2 focus:ring-[#EDE9FE] disabled:opacity-60"
								>
									<option value="todos">Todos</option>
									<option value="con_cuenta">Alumnos con cuenta</option>
									<option value="sin_cuenta">Alumnos sin cuenta</option>
									<option value="con_documento_rechazado">Alumnos con documento rechazado</option>
									<option value="con_documento_aceptado">Alumnos con documento aceptado</option>
								</select>
								<p className="mt-1 text-xs text-[#6B7280]">
									Aqui puedes elegir solo alumnos con documentos rechazados o aceptados.
								</p>
							</div>
							<div>
								<label htmlFor="ct-req-docs" className="mb-1 block text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
									Documentos base subidos
								</label>
								<select
									id="ct-req-docs"
									value={reqDocsBase}
									onChange={(e) => setReqDocsBase(e.target.value)}
									className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-sm text-[#111827] shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] outline-none focus:border-[#A78BFA] focus:ring-2 focus:ring-[#EDE9FE] disabled:opacity-60"
								>
									<option value="">Todos (0 a 5)</option>
									<option value="1">1 documento</option>
									<option value="2">2 documentos</option>
									<option value="3">3 documentos</option>
									<option value="4">4 documentos</option>
									<option value="5">5 documentos</option>
								</select>
							</div>
							<div className="rounded-xl border border-[#E5E7EB] bg-white/90 p-3">
								<p className="text-xs font-semibold uppercase tracking-wide text-[#6B7280]">
									Por grado, grupo y carrera
								</p>
								<p className="mt-1 text-[11px] leading-snug text-[#6B7280]">
									Tras pulsar Buscar aparecen los valores que vienen del padrón. Sin marcar nada en un bloque =
									se muestran todos en ese criterio. Marca uno o varios para acotar la tabla y la exportación.
								</p>
								<div className="mt-3 space-y-3">
									<div>
										<p className="text-xs font-bold text-[#374151]">Grado</p>
										{opcionesGrado.length === 0 ? (
											<p className="mt-1 text-[11px] text-[#9CA3AF]">Sin datos hasta la próxima búsqueda.</p>
										) : (
											<>
												<div className="mt-1 max-h-28 space-y-1 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-2">
													{opcionesGrado.map((v) => (
														<label key={v} className="flex cursor-pointer items-center gap-2 text-sm text-[#111827]">
															<input
																type="checkbox"
																checked={selGrados.includes(v)}
																onChange={() => setSelGrados((p) => toggleEnListaOrdenada(p, v))}
																className="h-4 w-4 rounded border-[#A78BFA] text-[#7C3AED] focus:ring-[#A78BFA]"
																style={{ accentColor: "#7C3AED" }}
															/>
															<span>{v}</span>
														</label>
													))}
												</div>
												<button
													type="button"
													onClick={() => setSelGrados([])}
													className="mt-1 text-[11px] font-semibold text-[#6D28D9] underline-offset-2 hover:underline"
												>
													Quitar filtro de grado
												</button>
											</>
										)}
									</div>
									<div>
										<p className="text-xs font-bold text-[#374151]">Grupo</p>
										{opcionesGrupo.length === 0 ? (
											<p className="mt-1 text-[11px] text-[#9CA3AF]">Sin datos hasta la próxima búsqueda.</p>
										) : (
											<>
												<div className="mt-1 max-h-28 space-y-1 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-2">
													{opcionesGrupo.map((v) => (
														<label key={v} className="flex cursor-pointer items-center gap-2 text-sm text-[#111827]">
															<input
																type="checkbox"
																checked={selGrupos.includes(v)}
																onChange={() => setSelGrupos((p) => toggleEnListaOrdenada(p, v))}
																className="h-4 w-4 rounded border-[#A78BFA] text-[#7C3AED] focus:ring-[#A78BFA]"
																style={{ accentColor: "#7C3AED" }}
															/>
															<span>{v}</span>
														</label>
													))}
												</div>
												<button
													type="button"
													onClick={() => setSelGrupos([])}
													className="mt-1 text-[11px] font-semibold text-[#6D28D9] underline-offset-2 hover:underline"
												>
													Quitar filtro de grupo
												</button>
											</>
										)}
									</div>
									<div>
										<p className="text-xs font-bold text-[#374151]">Carrera</p>
										{opcionesCarrera.length === 0 ? (
											<p className="mt-1 text-[11px] text-[#9CA3AF]">Sin datos hasta la próxima búsqueda.</p>
										) : (
											<>
												<div className="mt-1 max-h-28 space-y-1 overflow-y-auto rounded-lg border border-[#E5E7EB] bg-[#FAFAFA] p-2">
													{opcionesCarrera.map((v) => (
														<label key={v} className="flex cursor-pointer items-center gap-2 text-sm text-[#111827]">
															<input
																type="checkbox"
																checked={selCarreras.includes(v)}
																onChange={() => setSelCarreras((p) => toggleEnListaOrdenada(p, v))}
																className="h-4 w-4 rounded border-[#A78BFA] text-[#7C3AED] focus:ring-[#A78BFA]"
																style={{ accentColor: "#7C3AED" }}
															/>
															<span>{v}</span>
														</label>
													))}
												</div>
												<button
													type="button"
													onClick={() => setSelCarreras([])}
													className="mt-1 text-[11px] font-semibold text-[#6D28D9] underline-offset-2 hover:underline"
												>
													Quitar filtro de carrera
												</button>
											</>
										)}
									</div>
								</div>
							</div>
						</div>
					</div>
				</aside>

				<div className="flex min-w-0 flex-col gap-4">
					<div className="flex flex-wrap items-center justify-between gap-4 rounded-2xl border border-[#E5E7EB] bg-[#FAFAFA] px-4 py-3 sm:px-5">
						<p className="max-w-md text-xs text-[#6B7280] sm:text-sm">
							Pulsa <span className="font-semibold text-[#5B21B6]">Buscar</span> para llenar la tabla desde el padrón.
						</p>
						<button
							type="button"
							onClick={() => void buscar()}
							disabled={cargando}
							className="flex min-h-[5.5rem] w-[7.5rem] shrink-0 flex-col items-center justify-center gap-1 rounded-2xl border border-[#6D28D9] bg-[#7C3AED] px-3 py-2.5 text-[#FAFAFA] shadow-md transition hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-60 sm:min-h-[6rem] sm:w-[8.25rem]"
						>
							<span className="text-sm font-bold sm:text-base">{cargando ? "Buscando…" : "Buscar"}</span>
							<svg
								aria-hidden
								xmlns="http://www.w3.org/2000/svg"
								viewBox="0 0 24 24"
								fill="none"
								stroke="currentColor"
								strokeWidth="2.2"
								strokeLinecap="round"
								strokeLinejoin="round"
								className="h-8 w-8 sm:h-9 sm:w-9"
							>
								<circle cx="11" cy="11" r="7" />
								<path d="M21 21l-4.35-4.35" />
							</svg>
						</button>
					</div>

					{error ? (
						<p className="rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
					) : null}

					<div className="min-h-[14rem] flex-1 rounded-xl border border-[#E5E7EB] bg-[#FAFAFA] p-3 sm:p-4">
				{cargando && filas.length === 0 ? (
					<div className="flex h-[12rem] flex-col items-center justify-center gap-2 text-[#6B7280]">
						<p className="text-sm font-medium">Buscando alumnos…</p>
					</div>
				) : filas.length === 0 ? (
					<div className="flex h-[12rem] flex-col items-center justify-center gap-3 text-[#6B7280]">
						<svg
							aria-hidden
							xmlns="http://www.w3.org/2000/svg"
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="1.8"
							className="h-14 w-14 opacity-70"
						>
							<rect x="3" y="4" width="18" height="16" rx="2" />
							<path d="M3 9h18M9 4v16" />
						</svg>
						<p className="max-w-sm text-center text-sm sm:text-base">
							Los resultados se muestran en una tabla aquí. Marca información, elige requisitos y pulsa Buscar, o
							agrega filas a mano.
						</p>
					</div>
				) : columnasVisibles.length === 0 ? (
					<div className="flex h-[12rem] flex-col items-center justify-center text-sm text-[#6B7280]">
						Activa al menos una casilla en Información para ver columnas.
					</div>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[480px] border-collapse text-sm">
							<thead>
								<tr className="border-b border-[#D1D5DB] bg-white">
									{columnasVisibles.map((k) => (
										<th key={k} className="p-1 text-left align-bottom">
											<input
												type="text"
												value={titulosColumna[k] ?? ETIQUETA_DEFAULT[k]}
												onChange={(e) =>
													setTitulosColumna((prev) => ({ ...prev, [k]: e.target.value }))
												}
												className="w-full min-w-[5.5rem] rounded-lg border border-[#D1D5DB] bg-white px-2 py-2 font-bold text-[#111827] shadow-[inset_0_1px_2px_rgba(0,0,0,0.06)] outline-none focus:border-[#A78BFA]"
												aria-label={`Título columna ${k}`}
											/>
										</th>
									))}
									<th className="w-24 p-1 text-left text-xs font-bold uppercase tracking-wide text-[#6B7280]">
										Acciones
									</th>
								</tr>
							</thead>
							<tbody>
								{filas.map((f) => (
									<tr key={f.id} className="border-b border-[#E5E7EB] bg-white hover:bg-[#F9FAFB]">
										{columnasVisibles.map((k) => (
											<td key={k} className="p-1">
												<input
													type="text"
													value={f[k]}
													onChange={(e) => actualizarCelda(f.id, k, e.target.value)}
													className="w-full min-w-[5rem] rounded-lg border border-transparent bg-transparent px-2 py-1.5 text-[#111827] outline-none focus:border-[#C4B5FD] focus:bg-[#FAF5FF]"
												/>
											</td>
										))}
										<td className="p-1">
											<button
												type="button"
												onClick={() => eliminarFila(f.id)}
												className="inline-flex items-center justify-center rounded-lg border border-[#FCA5A5] bg-red-50 px-2 py-1 text-xs font-medium text-red-800 transition hover:bg-red-100"
												aria-label="Quitar fila"
											>
												<svg
													aria-hidden
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													className="h-4 w-4"
												>
													<path d="M3 6h18" />
													<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
													<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
													<path d="M10 11v6M14 11v6" />
												</svg>
											</button>
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
					</div>

					<div className="flex flex-col gap-4">
						<button
							type="button"
							onClick={agregarFila}
							className="w-fit rounded-xl border border-[#D1D5DB] bg-white px-4 py-2.5 text-sm font-semibold text-[#374151] shadow-sm transition hover:bg-[#F9FAFB]"
						>
							+ Agregar fila
						</button>
						<div className="flex flex-wrap items-center justify-center gap-3 sm:gap-4">
							<button
								type="button"
								onClick={descargarExcel}
								disabled={filas.length === 0 || columnasVisibles.length === 0}
								className="inline-flex min-w-[11rem] items-center justify-center gap-2 rounded-2xl border border-[#7C3AED] bg-[#F3E8FF] px-5 py-3.5 text-sm font-bold text-[#5B21B6] transition hover:border-[#6D28D9] hover:bg-[#E9D5FF] disabled:cursor-not-allowed disabled:opacity-45 sm:min-w-[12rem] sm:text-base"
							>
								Descargar en Excel
								<svg
									aria-hidden
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									className="h-6 w-6 shrink-0 sm:h-7 sm:w-7"
								>
									<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M7 10l5 5 5-5M12 15V3" />
								</svg>
							</button>
							<button
								type="button"
								onClick={imprimir}
								disabled={filas.length === 0 || columnasVisibles.length === 0}
								className="inline-flex min-w-[11rem] items-center justify-center gap-2 rounded-2xl border border-[#7C3AED] bg-[#F3E8FF] px-5 py-3.5 text-sm font-bold text-[#5B21B6] transition hover:border-[#6D28D9] hover:bg-[#E9D5FF] disabled:cursor-not-allowed disabled:opacity-45 sm:min-w-[12rem] sm:text-base"
							>
								Imprimir
								<svg
									aria-hidden
									xmlns="http://www.w3.org/2000/svg"
									viewBox="0 0 24 24"
									fill="none"
									stroke="currentColor"
									strokeWidth="2"
									className="h-6 w-6 shrink-0 sm:h-7 sm:w-7"
								>
									<polyline points="6 9 6 2 18 2 18 9" />
									<path d="M6 18H4a2 2 0 0 1-2-2v-5a2 2 0 0 1 2-2h16a2 2 0 0 1 2 2v5a2 2 0 0 1-2 2h-2" />
									<rect x="6" y="14" width="12" height="8" />
								</svg>
							</button>
						</div>
					</div>
				</div>
			</div>
		</div>
	);
}
