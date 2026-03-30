"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { DURACION_MENSAJE_EMERGENTE_MS } from "@/lib/ui/duracion-mensaje-emergente-ms";

type ModoPanel = "cargas" | "periodos";

type CargaListaItem = {
	id: string;
	fechaCierre: string;
	gradoCarga: number;
	gruposLetras: string[];
	creadoEn: string;
};

type LineaAlumno = {
	id: string;
	nombreCompleto: string;
	padronId: string;
	cuentaId: string | null;
	grupoLetra: string;
};

type DocEstatus = {
	tipo: string;
	etiqueta: string;
	estado: string | null;
	tieneArchivo: boolean;
};

function fechaInputDesdeIso(iso: string | null | undefined): string {
	if (!iso || typeof iso !== "string") {
		return "";
	}
	return iso.slice(0, 10);
}

function formatearFechaMostrar(iso: string): string {
	const s = iso.slice(0, 10);
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) {
		return iso;
	}
	return `${m[3]}/${m[2]}/${m[1]}`;
}

type CatalogoSeccionPeriodo = {
	key: string;
	institucionGrupoId: string;
	etiqueta: string;
};

type PeriodoListaItem = {
	id: string;
	nombrePeriodo: string;
	gruposAsignados: number;
};

type GrupoEnPeriodoUi = {
	institucionGrupoId: string;
	grado: string;
	grupo: string;
	claveAcceso?: string;
};

/**
 * Solo secciones “en uso”: alumnos activos en padrón y/o token de grupo enlazado a esa sección.
 * Evita listar todo el catálogo sembrado (p. ej. 1.°A–6.°E) si están vacías.
 */
function catalogoSeccionesDesdeGruposApi(
	grupos: {
		institucionGrupoId: string | null;
		grado: string;
		grupo: string;
		claveAcceso: string;
		totalAlumnos?: number;
		tieneToken?: boolean;
	}[],
): CatalogoSeccionPeriodo[] {
	const porIg = new Map<
		string,
		{ grado: string; grupo: string; claveAcceso: string; enUso: boolean }
	>();
	for (const g of grupos) {
		const ig = g.institucionGrupoId;
		if (!ig) {
			continue;
		}
		const alumnos = Number(g.totalAlumnos ?? 0);
		const enUso = alumnos > 0 || g.tieneToken === true;
		const clave = String(g.claveAcceso ?? "").trim();
		const prev = porIg.get(ig);
		if (!prev) {
			porIg.set(ig, {
				grado: g.grado,
				grupo: g.grupo,
				claveAcceso: clave,
				enUso,
			});
		} else {
			porIg.set(ig, {
				grado: prev.grado,
				grupo: prev.grupo,
				claveAcceso: prev.claveAcceso || clave,
				enUso: prev.enUso || enUso,
			});
		}
	}
	const out: CatalogoSeccionPeriodo[] = [];
	for (const [ig, v] of porIg) {
		if (!v.enUso) {
			continue;
		}
		out.push({
			key: ig,
			institucionGrupoId: ig,
			etiqueta: `${v.grado}° ${String(v.grupo).toUpperCase()}${v.claveAcceso ? ` · ${v.claveAcceso}` : ""}`,
		});
	}
	return out.sort((a, b) => a.etiqueta.localeCompare(b.etiqueta, "es"));
}

function descargarTxtClavesGrupos(
	tokens: { grupoLetra: string; claveAcceso: string }[],
	fechaCierre: string,
	gradoCarga: number,
) {
	const lineas = [
		`AIDA — Claves por grupo (${gradoCarga}.° grado)`,
		`Fecha de cierre: ${fechaCierre}`,
		"",
		"Grupo\tClave",
		...tokens.filter((t) => t.claveAcceso.trim() !== "").map((t) => `${t.grupoLetra}\t${t.claveAcceso}`),
		"",
		"Cada alumno usa en acceso la clave de su grupo (no hay clave única para toda la carga).",
	];
	const blob = new Blob([lineas.join("\n")], { type: "text/plain;charset=utf-8" });
	const url = URL.createObjectURL(blob);
	const a = document.createElement("a");
	a.href = url;
	a.download = `claves-carga-${gradoCarga}grado-${fechaCierre}.txt`;
	a.rel = "noopener";
	document.body.appendChild(a);
	a.click();
	a.remove();
	URL.revokeObjectURL(url);
}

export default function CargasPeriodosOrientador({ modo }: { modo: ModoPanel }) {
	const [cargandoCargas, setCargandoCargas] = useState(false);
	const [historial, setHistorial] = useState<CargaListaItem[]>([]);
	const [cargaActual, setCargaActual] = useState<{
		carga: CargaListaItem;
		lineasPorGrupo: Record<string, LineaAlumno[]>;
	} | null>(null);
	const [errorMsg, setErrorMsg] = useState("");
	const [okMsg, setOkMsg] = useState("");

	const [gruposTexto, setGruposTexto] = useState("A, B, C, D, E");
	const [fechaCierre, setFechaCierre] = useState("");
	const [grupoEdicion, setGrupoEdicion] = useState<string>("A");
	const [nombresPorGrupo, setNombresPorGrupo] = useState<Record<string, string[]>>({});
	const [enviandoCarga, setEnviandoCarga] = useState(false);

	const [grupoVistaActual, setGrupoVistaActual] = useState<string>("A");
	const [lineaCambiarGrupo, setLineaCambiarGrupo] = useState<LineaAlumno | null>(null);
	const [nuevoGrupoLetra, setNuevoGrupoLetra] = useState("");
	const [verDocs, setVerDocs] = useState<{
		nombre: string;
		padronId: string;
		cuentaId: string | null;
		documentos: DocEstatus[];
	} | null>(null);
	const [previewUrl, setPreviewUrl] = useState<string | null>(null);
	const [previewTitulo, setPreviewTitulo] = useState("");

	const [historialDetalle, setHistorialDetalle] = useState<{
		carga: CargaListaItem;
		lineasPorGrupo: Record<string, LineaAlumno[]>;
		clavesPorGrupo?: Record<string, string>;
	} | null>(null);
	const [grupoHist, setGrupoHist] = useState<string>("A");
	const [estatusHist, setEstatusHist] = useState<{
		nombre: string;
		padronId: string;
		cuentaId: string | null;
		documentos: DocEstatus[];
	} | null>(null);

	const [primerPeriodo, setPrimerPeriodo] = useState("");
	const [segundoPeriodo, setSegundoPeriodo] = useState("");
	const [cargandoPeriodos, setCargandoPeriodos] = useState(false);
	const [guardandoPeriodos, setGuardandoPeriodos] = useState(false);

	const [periodosLista, setPeriodosLista] = useState<PeriodoListaItem[]>([]);
	const [periodoIdSel, setPeriodoIdSel] = useState("");
	const [gruposPeriodo, setGruposPeriodo] = useState<GrupoEnPeriodoUi[]>([]);
	const [catalogoSecciones, setCatalogoSecciones] = useState<CatalogoSeccionPeriodo[]>([]);
	const [cargandoGruposPeriodo, setCargandoGruposPeriodo] = useState(false);
	const [cargandoCatalogoPeriodo, setCargandoCatalogoPeriodo] = useState(false);
	const [seccionParaAnadir, setSeccionParaAnadir] = useState("");
	const [mutandoPeriodoGrupo, setMutandoPeriodoGrupo] = useState(false);
	const [eliminandoCargaId, setEliminandoCargaId] = useState<string | null>(null);
	const [clavesPorGrupoUltima, setClavesPorGrupoUltima] = useState<Record<string, string>>({});

	const [filtroFechaVista, setFiltroFechaVista] = useState("");
	const [cargaIdSubSeleccion, setCargaIdSubSeleccion] = useState<string | null>(null);
	const [cargaVistaFiltrada, setCargaVistaFiltrada] = useState<{
		carga: CargaListaItem;
		lineasPorGrupo: Record<string, LineaAlumno[]>;
		clavesPorGrupo: Record<string, string>;
	} | null>(null);
	const [cargandoVistaFiltrada, setCargandoVistaFiltrada] = useState(false);

	const letrasCrear = useMemo(() => {
		return gruposTexto
			.split(/[,;\s]+/)
			.map((x) => x.trim().toUpperCase())
			.filter(Boolean);
	}, [gruposTexto]);

	const seccionesDisponiblesParaPeriodo = useMemo(() => {
		const asignados = new Set(gruposPeriodo.map((g) => g.institucionGrupoId));
		return catalogoSecciones.filter((c) => !asignados.has(c.institucionGrupoId));
	}, [catalogoSecciones, gruposPeriodo]);

	const refrescarCargas = useCallback(async () => {
		setCargandoCargas(true);
		setErrorMsg("");
		try {
			const res = await fetch("/api/orientador/cargas", { credentials: "include" });
			const data = (await res.json()) as {
				historial?: CargaListaItem[];
				cargaActual?: { carga: CargaListaItem; lineasPorGrupo: Record<string, LineaAlumno[]> } | null;
				clavesPorGrupoUltima?: Record<string, string>;
				error?: string;
				tablasCargasPendientes?: boolean;
			};
			if (!res.ok) {
				setErrorMsg(data.error ?? "No se pudieron cargar los datos");
				return;
			}
			if (data.tablasCargasPendientes) {
				setErrorMsg(
					"Ejecuta en Supabase el script supabase/cargas_alumnos_extension.sql para habilitar cargas.",
				);
			}
			setHistorial(data.historial ?? []);
			setCargaActual(data.cargaActual ?? null);
			setClavesPorGrupoUltima(data.clavesPorGrupoUltima ?? {});
			if (data.cargaActual?.carga.gruposLetras?.length) {
				const g0 = data.cargaActual.carga.gruposLetras[0] ?? "A";
				setGrupoVistaActual(g0);
			}
		} catch {
			setErrorMsg("Error de red al cargar cargas.");
		} finally {
			setCargandoCargas(false);
		}
	}, []);

	useEffect(() => {
		if (modo === "cargas") {
			void refrescarCargas();
		}
	}, [modo, refrescarCargas]);

	useEffect(() => {
		if (!errorMsg.trim()) {
			return;
		}
		const id = window.setTimeout(() => setErrorMsg(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [errorMsg]);

	useEffect(() => {
		if (modo !== "periodos") {
			return;
		}
		let cancel = false;
		(async () => {
			setCargandoPeriodos(true);
			try {
				const [resSem, resPer] = await Promise.all([
					fetch("/api/orientador/semestre-fechas", { credentials: "include" }),
					fetch("/api/orientador/periodos-academicos", { credentials: "include" }),
				]);
				const d = (await resSem.json()) as {
					primerPeriodoFecha?: string | null;
					segundoPeriodoFecha?: string | null;
				};
				const dPer = (await resPer.json()) as {
					periodos?: PeriodoListaItem[];
					error?: string;
				};
				if (!cancel && resSem.ok) {
					setPrimerPeriodo(fechaInputDesdeIso(d.primerPeriodoFecha ?? null));
					setSegundoPeriodo(fechaInputDesdeIso(d.segundoPeriodoFecha ?? null));
				}
				if (!cancel && resPer.ok) {
					setPeriodosLista(dPer.periodos ?? []);
				}
			} finally {
				if (!cancel) {
					setCargandoPeriodos(false);
				}
			}
		})();
		return () => {
			cancel = true;
		};
	}, [modo]);

	useEffect(() => {
		if (modo !== "periodos" || periodosLista.length === 0) {
			return;
		}
		if (!periodoIdSel || !periodosLista.some((p) => p.id === periodoIdSel)) {
			setPeriodoIdSel(periodosLista[0].id);
		}
	}, [modo, periodosLista, periodoIdSel]);

	useEffect(() => {
		if (modo !== "periodos") {
			return;
		}
		let cancel = false;
		(async () => {
			setCargandoCatalogoPeriodo(true);
			try {
				const res = await fetch("/api/orientador/grupos", { credentials: "include" });
				const data = (await res.json()) as {
					grupos?: {
						institucionGrupoId: string | null;
						grado: string;
						grupo: string;
						claveAcceso: string;
						totalAlumnos?: number;
						tieneToken?: boolean;
					}[];
					error?: string;
				};
				if (!cancel && res.ok && data.grupos) {
					setCatalogoSecciones(catalogoSeccionesDesdeGruposApi(data.grupos));
				}
			} finally {
				if (!cancel) {
					setCargandoCatalogoPeriodo(false);
				}
			}
		})();
		return () => {
			cancel = true;
		};
	}, [modo]);

	useEffect(() => {
		if (modo !== "periodos" || !periodoIdSel) {
			return;
		}
		let cancel = false;
		(async () => {
			setCargandoGruposPeriodo(true);
			try {
				const res = await fetch(`/api/orientador/periodos-academicos/${periodoIdSel}/grupos`, {
					credentials: "include",
				});
				const data = (await res.json()) as {
					grupos?: GrupoEnPeriodoUi[];
					error?: string;
				};
				if (!cancel && res.ok) {
					setGruposPeriodo(data.grupos ?? []);
				}
			} finally {
				if (!cancel) {
					setCargandoGruposPeriodo(false);
				}
			}
		})();
		return () => {
			cancel = true;
		};
	}, [modo, periodoIdSel]);

	function nombresGrupoActual(): string[] {
		return nombresPorGrupo[grupoEdicion] ?? [""];
	}

	function setNombreEnIndice(idx: number, valor: string) {
		const arr = [...nombresGrupoActual()];
		arr[idx] = valor;
		setNombresPorGrupo((prev) => ({ ...prev, [grupoEdicion]: arr }));
	}

	function agregarFilaNombre() {
		const arr = [...nombresGrupoActual(), ""];
		setNombresPorGrupo((prev) => ({ ...prev, [grupoEdicion]: arr }));
	}

	function quitarFilaNombre(idx: number) {
		const arr = nombresGrupoActual().filter((_, i) => i !== idx);
		setNombresPorGrupo((prev) => ({ ...prev, [grupoEdicion]: arr.length ? arr : [""] }));
	}

	async function importarExcel(f: File) {
		setErrorMsg("");
		try {
			const fd = new FormData();
			fd.set("archivo", f);
			const res = await fetch("/api/orientador/cargas/filas-xlsx", {
				method: "POST",
				credentials: "include",
				body: fd,
			});
			const data = (await res.json()) as {
				filas?: { nombreCompleto: string; grupoLetra: string }[];
				error?: string;
			};
			if (!res.ok) {
				setErrorMsg(data.error ?? "No se pudo importar");
				return;
			}
			const manualPorGrupo = { ...nombresPorGrupo };
			const claves = new Set<string>();
			for (const g of letrasCrear) {
				for (const n of manualPorGrupo[g] ?? []) {
					const t = n.trim();
					if (t) {
						claves.add(`${t.toLowerCase()}|${g}`);
					}
				}
			}
			const merged = { ...manualPorGrupo };
			for (const row of data.filas ?? []) {
				const g = row.grupoLetra.toUpperCase();
				if (!letrasCrear.includes(g)) {
					continue;
				}
				const clave = `${row.nombreCompleto.trim().toLowerCase()}|${g}`;
				if (claves.has(clave)) {
					continue;
				}
				claves.add(clave);
				const lista = [...(merged[g] ?? []).filter((x) => x.trim() !== ""), row.nombreCompleto.trim()];
				merged[g] = lista.length ? lista : [""];
			}
			setNombresPorGrupo(merged);
			setOkMsg("Importación mezclada (sin duplicar respecto a lo manual).");
			setTimeout(() => setOkMsg(""), DURACION_MENSAJE_EMERGENTE_MS);
		} catch {
			setErrorMsg("Error al leer el archivo.");
		}
	}

	async function crearCarga() {
		setErrorMsg("");
		setOkMsg("");
		const alumnos: { grupoLetra: string; nombreCompleto: string }[] = [];
		for (const g of letrasCrear) {
			for (const n of nombresPorGrupo[g] ?? []) {
				const t = n.trim();
				if (t) {
					alumnos.push({ grupoLetra: g, nombreCompleto: t });
				}
			}
		}
		if (!fechaCierre.trim()) {
			setErrorMsg("Indica la fecha de cierre.");
			return;
		}
		if (alumnos.length === 0) {
			setErrorMsg("Agrega al menos un nombre de alumno.");
			return;
		}
		setEnviandoCarga(true);
		try {
			const res = await fetch("/api/orientador/cargas", {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					gruposLetras: letrasCrear,
					fechaCierre: fechaCierre.trim(),
					gradoCarga: 1,
					alumnos,
				}),
			});
			const data = (await res.json()) as {
				ok?: boolean;
				error?: string;
				tokensPorGrupo?: { grupoLetra: string; claveAcceso: string }[];
				fechaCierre?: string;
				gradoCarga?: number;
			};
			if (!res.ok) {
				setErrorMsg(data.error ?? "No se pudo crear la carga");
				return;
			}
			setOkMsg(`Carga creada (${alumnos.length} alumnos). Se descargó un .txt con la clave de cada grupo.`);
			setTimeout(() => setOkMsg(""), DURACION_MENSAJE_EMERGENTE_MS);
			setNombresPorGrupo({});
			if (data.tokensPorGrupo && data.fechaCierre) {
				descargarTxtClavesGrupos(data.tokensPorGrupo, data.fechaCierre, data.gradoCarga ?? 1);
			}
			await refrescarCargas();
		} catch {
			setErrorMsg("Error de red.");
		} finally {
			setEnviandoCarga(false);
		}
	}

	async function abrirVerDocumentos(nombre: string, padronId: string, cuentaId: string | null) {
		setErrorMsg("");
		const res = await fetch(
			`/api/orientador/cargas/documentos-estatus?padronId=${encodeURIComponent(padronId)}`,
			{ credentials: "include" },
		);
		const data = (await res.json()) as {
			documentos?: DocEstatus[];
			cuentaId?: string | null;
			error?: string;
		};
		if (!res.ok) {
			setErrorMsg(data.error ?? "No se pudieron cargar los documentos");
			return;
		}
		setVerDocs({
			nombre,
			padronId,
			cuentaId: data.cuentaId ?? cuentaId,
			documentos: data.documentos ?? [],
		});
	}

	async function verificarDoc(accion: "validar_manual" | "rechazar", tipo: string) {
		const cId = verDocs?.cuentaId;
		if (!cId) {
			setErrorMsg("El alumno aún no tiene cuenta o no ha subido archivos.");
			return;
		}
		const res = await fetch("/api/orientador/entrega", {
			method: "PATCH",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				cuentaId: cId,
				tipoDocumento: tipo,
				accion,
				...(accion === "rechazar" ? { motivoRechazo: "Marcado como incorrecto por el orientador" } : {}),
			}),
		});
		if (!res.ok) {
			const d = (await res.json()) as { error?: string };
			setErrorMsg(d.error ?? "No se pudo actualizar");
			return;
		}
		if (verDocs) {
			await abrirVerDocumentos(verDocs.nombre, verDocs.padronId, verDocs.cuentaId);
		}
	}

	async function abrirPreview(tipo: string) {
		const cId = verDocs?.cuentaId;
		if (!cId) {
			return;
		}
		setPreviewTitulo(tipo);
		try {
			const res = await fetch(
				`/api/orientador/documento/descargar?cuentaId=${encodeURIComponent(cId)}&tipo=${encodeURIComponent(tipo)}&inline=1`,
				{ credentials: "include" },
			);
			if (!res.ok) {
				return;
			}
			const blob = await res.blob();
			const u = URL.createObjectURL(blob);
			setPreviewUrl((prev) => {
				if (prev) {
					URL.revokeObjectURL(prev);
				}
				return u;
			});
		} catch {
			/* noop */
		}
	}

	useEffect(() => {
		return () => {
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl);
			}
		};
	}, [previewUrl]);

	async function guardarCambioGrupo() {
		if (!lineaCambiarGrupo || !nuevoGrupoLetra.trim()) {
			return;
		}
		const res = await fetch("/api/orientador/cargas/linea", {
			method: "PATCH",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify({
				lineaId: lineaCambiarGrupo.id,
				nuevoGrupoLetra: nuevoGrupoLetra.trim(),
			}),
		});
		const d = (await res.json()) as { error?: string };
		if (!res.ok) {
			setErrorMsg(d.error ?? "No se pudo cambiar de grupo");
			return;
		}
		setLineaCambiarGrupo(null);
		setNuevoGrupoLetra("");
		await refrescarCargas();
	}

	async function eliminarLinea(lineaId: string) {
		if (!confirm("¿Eliminar este alumno de la carga actual? (Si no tiene cuenta, también se quita del padrón.)")) {
			return;
		}
		const res = await fetch(`/api/orientador/cargas/linea?lineaId=${encodeURIComponent(lineaId)}`, {
			method: "DELETE",
			credentials: "include",
		});
		const d = (await res.json()) as { error?: string };
		if (!res.ok) {
			setErrorMsg(d.error ?? "No se pudo eliminar");
			return;
		}
		await refrescarCargas();
	}

	async function eliminarCargaHistorial(cargaId: string) {
		if (
			!confirm(
				"¿Eliminar esta carga del historial? Se quitan las filas de la carga. Los alumnos sin cuenta de acceso también se borran del padrón; si ya tienen cuenta, permanecen en el padrón.",
			)
		) {
			return;
		}
		setEliminandoCargaId(cargaId);
		setErrorMsg("");
		try {
			const res = await fetch(`/api/orientador/cargas/${cargaId}`, {
				method: "DELETE",
				credentials: "include",
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setErrorMsg(d.error ?? "No se pudo eliminar la carga");
				return;
			}
			if (historialDetalle?.carga.id === cargaId) {
				setHistorialDetalle(null);
				setEstatusHist(null);
			}
			setOkMsg("Carga eliminada del historial.");
			setTimeout(() => setOkMsg(""), DURACION_MENSAJE_EMERGENTE_MS);
			await refrescarCargas();
		} catch {
			setErrorMsg("Error de red al eliminar la carga.");
		} finally {
			setEliminandoCargaId(null);
		}
	}

	async function verHistorialCarga(cargaId: string) {
		const res = await fetch(`/api/orientador/cargas/${cargaId}`, { credentials: "include" });
		const data = (await res.json()) as {
			carga?: CargaListaItem;
			lineasPorGrupo?: Record<string, LineaAlumno[]>;
			clavesPorGrupo?: Record<string, string>;
			error?: string;
		};
		if (!res.ok || !data.carga) {
			setErrorMsg(data.error ?? "No se pudo cargar el detalle");
			return;
		}
		setHistorialDetalle({
			carga: data.carga,
			lineasPorGrupo: data.lineasPorGrupo ?? {},
			clavesPorGrupo: data.clavesPorGrupo,
		});
		const g0 = data.carga.gruposLetras[0] ?? "A";
		setGrupoHist(g0);
	}

	async function guardarPeriodos() {
		setGuardandoPeriodos(true);
		setErrorMsg("");
		try {
			const res = await fetch("/api/orientador/semestre-fechas", {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					primerPeriodoFecha: primerPeriodo.trim() || null,
					segundoPeriodoFecha: segundoPeriodo.trim() || null,
				}),
			});
			const d = (await res.json()) as { error?: string; ok?: boolean };
			if (!res.ok) {
				setErrorMsg(d.error ?? "No se pudo guardar");
				return;
			}
			setOkMsg("Periodos guardados.");
			setTimeout(() => setOkMsg(""), DURACION_MENSAJE_EMERGENTE_MS);
			const resP = await fetch("/api/orientador/periodos-academicos", { credentials: "include" });
			const dp = (await resP.json()) as { periodos?: PeriodoListaItem[] };
			if (resP.ok) {
				setPeriodosLista(dp.periodos ?? []);
			}
		} finally {
			setGuardandoPeriodos(false);
		}
	}

	async function refrescarGruposYListaPeriodos() {
		if (!periodoIdSel) {
			return;
		}
		const [resG, resP] = await Promise.all([
			fetch(`/api/orientador/periodos-academicos/${periodoIdSel}/grupos`, { credentials: "include" }),
			fetch("/api/orientador/periodos-academicos", { credentials: "include" }),
		]);
		const dg = (await resG.json()) as { grupos?: GrupoEnPeriodoUi[] };
		const dp = (await resP.json()) as { periodos?: PeriodoListaItem[] };
		if (resG.ok) {
			setGruposPeriodo(dg.grupos ?? []);
		}
		if (resP.ok) {
			setPeriodosLista(dp.periodos ?? []);
		}
	}

	async function anadirSeccionAlPeriodo() {
		if (!periodoIdSel || !seccionParaAnadir.trim()) {
			return;
		}
		setMutandoPeriodoGrupo(true);
		setErrorMsg("");
		try {
			const res = await fetch(`/api/orientador/periodos-academicos/${periodoIdSel}/grupos`, {
				method: "POST",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ institucionGrupoId: seccionParaAnadir.trim() }),
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setErrorMsg(d.error ?? "No se pudo añadir la sección");
				return;
			}
			setSeccionParaAnadir("");
			setOkMsg("Sección asignada al ciclo.");
			setTimeout(() => setOkMsg(""), DURACION_MENSAJE_EMERGENTE_MS);
			await refrescarGruposYListaPeriodos();
		} finally {
			setMutandoPeriodoGrupo(false);
		}
	}

	async function quitarSeccionDelPeriodo(institucionGrupoId: string) {
		if (!periodoIdSel) {
			return;
		}
		if (!confirm("¿Quitar esta sección del ciclo? No borra alumnos ni el padrón.")) {
			return;
		}
		setMutandoPeriodoGrupo(true);
		setErrorMsg("");
		try {
			const res = await fetch(`/api/orientador/periodos-academicos/${periodoIdSel}/grupos`, {
				method: "DELETE",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ institucionGrupoId }),
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setErrorMsg(d.error ?? "No se pudo quitar la sección");
				return;
			}
			setOkMsg("Sección quitada del ciclo.");
			setTimeout(() => setOkMsg(""), DURACION_MENSAJE_EMERGENTE_MS);
			await refrescarGruposYListaPeriodos();
		} finally {
			setMutandoPeriodoGrupo(false);
		}
	}

	function anadirLetraAGruposSiFalta(letra: string) {
		const L = letra.trim().toUpperCase();
		if (!L) {
			return;
		}
		const actuales = gruposTexto
			.split(/[,;\s]+/)
			.map((x) => x.trim().toUpperCase())
			.filter(Boolean);
		if (actuales.includes(L)) {
			setGrupoEdicion(L);
			return;
		}
		setGruposTexto((prev) => (prev.trim() ? `${prev}, ${L}` : L));
		setGrupoEdicion(L);
	}

	const fechasCierreExistentes = useMemo(() => {
		const u = new Set<string>();
		for (const h of historial) {
			u.add(h.fechaCierre.slice(0, 10));
		}
		return [...u].sort((a, b) => (a < b ? 1 : -1));
	}, [historial]);

	const cargasPorFechaCierre = useMemo(() => {
		const m = new Map<string, CargaListaItem[]>();
		for (const h of historial) {
			const k = h.fechaCierre.slice(0, 10);
			const arr = m.get(k) ?? [];
			arr.push(h);
			m.set(k, arr);
		}
		for (const arr of m.values()) {
			arr.sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));
		}
		return m;
	}, [historial]);

	const fechaCierreNormFormulario = fechaCierre.trim().slice(0, 10);
	const letrasYaConCargaEnFecha = useMemo(() => {
		const s = new Set<string>();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(fechaCierreNormFormulario)) {
			return s;
		}
		for (const h of historial) {
			if (h.fechaCierre.slice(0, 10) !== fechaCierreNormFormulario) {
				continue;
			}
			for (const l of h.gruposLetras) {
				s.add(String(l).toUpperCase());
			}
		}
		return s;
	}, [historial, fechaCierreNormFormulario]);

	const candidatosFechaVista = useMemo(() => {
		if (!filtroFechaVista) {
			return [];
		}
		return cargasPorFechaCierre.get(filtroFechaVista) ?? [];
	}, [filtroFechaVista, cargasPorFechaCierre]);

	const cargaIdResueltoVista = useMemo(() => {
		if (!filtroFechaVista) {
			return cargaActual?.carga.id ?? null;
		}
		const cand = candidatosFechaVista;
		if (cand.length === 0) {
			return null;
		}
		if (cargaIdSubSeleccion && cand.some((c) => c.id === cargaIdSubSeleccion)) {
			return cargaIdSubSeleccion;
		}
		return cand[0]?.id ?? null;
	}, [filtroFechaVista, cargaActual, candidatosFechaVista, cargaIdSubSeleccion]);

	const vistaParaLista = useMemo(() => {
		if (!filtroFechaVista) {
			if (!cargaActual) {
				return null;
			}
			return {
				carga: cargaActual.carga,
				lineasPorGrupo: cargaActual.lineasPorGrupo,
				clavesPorGrupo: clavesPorGrupoUltima,
			};
		}
		if (!cargaVistaFiltrada || cargaVistaFiltrada.carga.id !== cargaIdResueltoVista) {
			return null;
		}
		return cargaVistaFiltrada;
	}, [filtroFechaVista, cargaActual, cargaVistaFiltrada, cargaIdResueltoVista, clavesPorGrupoUltima]);

	const vistaGruposFingerprint = useMemo(() => {
		return (vistaParaLista?.carga.gruposLetras ?? []).join(",");
	}, [vistaParaLista]);

	useEffect(() => {
		if (modo !== "cargas") {
			return;
		}
		if (!filtroFechaVista) {
			setCargaVistaFiltrada(null);
			setCargandoVistaFiltrada(false);
			return;
		}
		const cand = cargasPorFechaCierre.get(filtroFechaVista) ?? [];
		const id =
			cargaIdSubSeleccion && cand.some((c) => c.id === cargaIdSubSeleccion)
				? cargaIdSubSeleccion
				: cand[0]?.id;
		if (!id) {
			setCargaVistaFiltrada(null);
			setCargandoVistaFiltrada(false);
			return;
		}
		let cancel = false;
		setCargandoVistaFiltrada(true);
		setCargaVistaFiltrada(null);
		fetch(`/api/orientador/cargas/${id}`, { credentials: "include" })
			.then(async (r) => {
				const data = (await r.json()) as {
					carga?: CargaListaItem;
					lineasPorGrupo?: Record<string, LineaAlumno[]>;
					clavesPorGrupo?: Record<string, string>;
					error?: string;
				};
				if (cancel) {
					return;
				}
				if (!r.ok || !data.carga || data.carga.id !== id) {
					if (!r.ok) {
						setErrorMsg(data.error ?? "No se pudo cargar la carga");
					}
					setCargaVistaFiltrada(null);
					return;
				}
				setCargaVistaFiltrada({
					carga: data.carga,
					lineasPorGrupo: data.lineasPorGrupo ?? {},
					clavesPorGrupo: data.clavesPorGrupo ?? {},
				});
			})
			.catch(() => {
				if (!cancel) {
					setErrorMsg("Error de red al cargar la carga.");
					setCargaVistaFiltrada(null);
				}
			})
			.finally(() => {
				if (!cancel) {
					setCargandoVistaFiltrada(false);
				}
			});
		return () => {
			cancel = true;
		};
	}, [modo, filtroFechaVista, cargaIdSubSeleccion, cargasPorFechaCierre]);

	useEffect(() => {
		if (modo !== "cargas") {
			return;
		}
		const gs = vistaGruposFingerprint.split(",").filter(Boolean);
		if (gs.length > 0 && !gs.includes(grupoVistaActual)) {
			setGrupoVistaActual(gs[0]!);
		}
	}, [modo, vistaGruposFingerprint, grupoVistaActual]);

	if (modo === "periodos") {
		return (
			<div className="mx-auto mt-5 max-w-4xl px-4 pb-16">
				<div className="mb-6 space-y-3 text-center text-sm text-slate-600">
					<p>
					Establece los periodos anuales de cambio de semestre para que los expedientes sean 
					Actualizados de grado automaticamente).
					</p>

				</div>
				{errorMsg ? (
					<p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</p>
				) : null}
				{okMsg ? (
					<p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{okMsg}</p>
				) : null}
				<div className="grid gap-6 sm:grid-cols-2">
					<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h3 className="text-lg font-bold text-slate-900">Primer Periodo</h3>
						<input
							type="date"
							disabled={cargandoPeriodos}
							value={primerPeriodo}
							onChange={(e) => setPrimerPeriodo(e.target.value)}
							className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 shadow-inner outline-none focus:border-slate-500"
						/>
					</div>
					<div className="rounded-2xl border border-slate-200 bg-white p-6 shadow-sm">
						<h3 className="text-lg font-bold text-slate-900">Segundo Periodo</h3>
						<input
							type="date"
							disabled={cargandoPeriodos}
							value={segundoPeriodo}
							onChange={(e) => setSegundoPeriodo(e.target.value)}
							className="mt-4 w-full rounded-xl border border-slate-300 px-3 py-2.5 text-slate-900 shadow-inner outline-none focus:border-slate-500"
						/>
					</div>
				</div>
				<div className="mt-8 flex justify-center">
					<button
						type="button"
						disabled={guardandoPeriodos || cargandoPeriodos}
						onClick={() => void guardarPeriodos()}
						className="rounded-2xl border border-slate-400 bg-slate-300 px-10 py-3 text-base font-bold text-slate-900 shadow-md transition hover:bg-slate-400 disabled:opacity-50"
					>
						{guardandoPeriodos ? "Guardando…" : "Guardar Periodos"}
					</button>
				</div>

				<div className="mt-14 rounded-2xl border border-slate-200 bg-white p-6 shadow-md">
					{periodosLista.length === 0 ? (
						<p className="mt-4 text-sm text-slate-500">
							Aún no hay ciclos en el historial. Guarda las fechas arriba al menos una vez para generar el
							registro del ciclo.
						</p>
					) : (
						<>
							<label className="mt-4 block text-sm font-semibold text-slate-700">Ciclo escolar</label>
							<select
								value={periodoIdSel}
								onChange={(e) => setPeriodoIdSel(e.target.value)}
								className="mt-1 w-full max-w-lg rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
							>
								{periodosLista.map((p) => (
									<option key={p.id} value={p.id}>
										{p.nombrePeriodo} · {p.gruposAsignados} sección(es)
									</option>
								))}
							</select>
							<div className="mt-6 flex flex-wrap items-end gap-3">
								<div className="min-w-[12rem] flex-1">
									<label className="block text-sm font-semibold text-slate-700">Añadir sección</label>
									<select
										value={seccionParaAnadir}
										onChange={(e) => setSeccionParaAnadir(e.target.value)}
										disabled={cargandoCatalogoPeriodo || mutandoPeriodoGrupo}
										className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900 disabled:opacity-60"
									>
										<option value="">
											{cargandoCatalogoPeriodo ? "Cargando catálogo…" : "Elige sección…"}
										</option>
										{seccionesDisponiblesParaPeriodo.map((c) => (
											<option key={c.key} value={c.institucionGrupoId}>
												{c.etiqueta}
											</option>
										))}
									</select>
								</div>
								<button
									type="button"
									disabled={
										!seccionParaAnadir ||
										mutandoPeriodoGrupo ||
										!periodoIdSel ||
										cargandoGruposPeriodo
									}
									onClick={() => void anadirSeccionAlPeriodo()}
									className="rounded-xl border border-slate-500 bg-slate-500 px-5 py-2 text-sm font-semibold text-white shadow-sm hover:bg-slate-600 disabled:opacity-50"
								>
									{mutandoPeriodoGrupo ? "…" : "Añadir al ciclo"}
								</button>
							</div>
							{cargandoGruposPeriodo ? (
								<p className="mt-4 text-sm text-slate-500">Cargando secciones del ciclo…</p>
							) : (
								<ul className="mt-4 space-y-2">
									{gruposPeriodo.length === 0 ? (
										<li className="text-sm text-slate-500">Ninguna sección asignada a este ciclo.</li>
									) : (
										gruposPeriodo.map((g) => (
											<li
												key={g.institucionGrupoId}
												className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2"
											>
												<span className="text-slate-900">
													{g.grado}° grupo {g.grupo}
													{g.claveAcceso ? (
														<span className="ml-2 text-xs text-slate-500">· {g.claveAcceso}</span>
													) : null}
												</span>
												<button
													type="button"
													disabled={mutandoPeriodoGrupo}
													onClick={() => void quitarSeccionDelPeriodo(g.institucionGrupoId)}
													className="rounded-lg border border-slate-400 bg-white px-3 py-1 text-sm font-medium text-slate-800 shadow-sm disabled:opacity-50"
												>
													Quitar del ciclo
												</button>
											</li>
										))
									)}
								</ul>
							)}
						</>
					)}
				</div>
			</div>
		);
	}

	const gruposActuales = vistaParaLista?.carga.gruposLetras ?? [];
	const grupoVistaResuelto = gruposActuales.includes(grupoVistaActual)
		? grupoVistaActual
		: gruposActuales[0] ?? "A";
	const lineasActuales = vistaParaLista?.lineasPorGrupo[grupoVistaResuelto] ?? [];
	const clavesGrupoVista = vistaParaLista?.clavesPorGrupo ?? {};

	return (
		<div className="mx-auto mt-5 max-w-3xl px-4 pb-24">
			{errorMsg ? (
				<p className="mb-4 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</p>
			) : null}
			{okMsg ? (
				<p className="mb-4 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{okMsg}</p>
			) : null}
			{cargandoCargas ? (
				<p className="text-center text-sm text-slate-500">Cargando…</p>
			) : null}

			<h2 className="text-center text-2xl font-bold text-slate-900">Crear Carga de Alumnos</h2>
			<div className="mt-6 flex flex-wrap items-end gap-4">
				<div className="min-w-[12rem] flex-1">
					<label className="block text-sm font-semibold text-slate-700">Grupos</label>
					<input
						value={gruposTexto}
						onChange={(e) => setGruposTexto(e.target.value)}
						placeholder="A, B, C, D, E"
						className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
					/>
				</div>
				<div className="min-w-[12rem] flex-1">
					<label className="block text-sm font-semibold text-slate-700">Fecha de cierre</label>
					<input
						type="date"
						value={fechaCierre}
						onChange={(e) => setFechaCierre(e.target.value)}
						className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
					/>
				</div>
			</div>
			{fechasCierreExistentes.length > 0 ? (
				<div className="mt-3">
					<p className="text-xs font-semibold text-slate-600">Fechas de cierre ya usadas (clic para elegir)</p>
					<div className="mt-1.5 flex flex-wrap gap-2">
						{fechasCierreExistentes.map((f) => (
							<button
								key={f}
								type="button"
								onClick={() => setFechaCierre(f)}
								className={`rounded-lg border px-2.5 py-1 text-xs font-semibold shadow-sm ${
									fechaCierre.slice(0, 10) === f
										? "border-violet-500 bg-violet-100 text-violet-900"
										: "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
								}`}
							>
								{formatearFechaMostrar(f)}
							</button>
						))}
					</div>
				</div>
			) : null}
			{letrasYaConCargaEnFecha.size > 0 ? (
				<div className="mt-3 rounded-lg border border-emerald-200 bg-emerald-50/80 px-3 py-2">
					<p className="text-xs font-semibold text-emerald-900">
						Grupos que ya tienen carga con esta fecha de cierre (clic para añadirlos al campo «Grupos» y subir más
						alumnos)
					</p>
					<div className="mt-2 flex flex-wrap gap-2">
						{[...letrasYaConCargaEnFecha].sort().map((l) => (
							<button
								key={l}
								type="button"
								onClick={() => anadirLetraAGruposSiFalta(l)}
								className="rounded-lg border border-emerald-600 bg-emerald-100 px-2.5 py-1 text-sm font-bold text-emerald-950 shadow-sm hover:bg-emerald-200"
							>
								{l}
							</button>
						))}
					</div>
				</div>
			) : null}
			<div className="mt-3 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs text-slate-600">
				<strong className="text-slate-800">Clave por grupo:</strong> al crear la carga, el sistema asigna o reutiliza
				un token en <span className="font-mono">grupo_tokens</span> (una clave por sección). Se descarga un archivo{" "}
				<span className="font-mono">.txt</span> con grupo y clave; también puedes verlas en la sección{" "}
				<span className="font-semibold">Carga de alumnos</span>.
			</div>

			<div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-md">
				<p className="mb-2 flex flex-wrap gap-x-4 gap-y-1 text-xs text-slate-600">
					<span className="inline-flex items-center gap-1.5">
						<span className="h-2.5 w-2.5 shrink-0 rounded-full bg-emerald-500" aria-hidden />
						Grupo ya usado en esta fecha (reutilizas clave / sumas alumnos)
					</span>
					<span className="inline-flex items-center gap-1.5">
						<span className="h-2.5 w-2.5 shrink-0 rounded-full bg-amber-400" aria-hidden />
						Grupo nuevo en esta carga
					</span>
				</p>
				<div className="flex flex-wrap items-center gap-2">
					{letrasCrear.map((l) => {
						const yaExiste = letrasYaConCargaEnFecha.has(l);
						const base =
							grupoEdicion === l
								? yaExiste
									? "border-emerald-700 bg-emerald-600 text-white ring-2 ring-emerald-300"
									: "border-amber-600 bg-amber-500 text-white ring-2 ring-amber-200"
								: yaExiste
									? "border-emerald-500 bg-emerald-100 text-emerald-950 hover:bg-emerald-200"
									: "border-amber-300 bg-amber-50 text-amber-950 hover:bg-amber-100";
						return (
							<button
								key={l}
								type="button"
								onClick={() => setGrupoEdicion(l)}
								className={`h-10 min-w-[2.5rem] rounded-lg border px-2 text-sm font-bold shadow-sm ${base}`}
							>
								{l}
							</button>
						);
					})}
					<label className="ml-auto cursor-pointer rounded-lg border border-slate-400 bg-slate-300 px-3 py-2 text-sm font-semibold text-slate-900 shadow-sm">
						Importar
						<input
							type="file"
							accept=".xlsx,.xls"
							className="hidden"
							onChange={(e) => {
								const f = e.target.files?.[0];
								e.target.value = "";
								if (f) {
									void importarExcel(f);
								}
							}}
						/>
					</label>
				</div>
				<p className="mt-2 text-xs text-slate-500">
					Excel: columnas nombre y grupo (primera fila puede ser encabezado). La fecha de cierre actualiza el
					vencimiento de la clave de cada grupo involucrado.
				</p>
				<div className="mt-4 space-y-2">
					{nombresGrupoActual().map((n, idx) => (
						<div key={`${grupoEdicion}-${idx}`} className="flex gap-2">
							<input
								value={n}
								onChange={(e) => setNombreEnIndice(idx, e.target.value)}
								placeholder="Nombre completo"
								className="flex-1 rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
							/>
							<button
								type="button"
								onClick={() => quitarFilaNombre(idx)}
								className="rounded-lg border border-slate-400 bg-slate-200 px-3 text-slate-800"
								aria-label="Quitar"
							>
								🗑
							</button>
						</div>
					))}
				</div>
				<div className="mt-4 flex justify-center">
					<button
						type="button"
						onClick={agregarFilaNombre}
						className="rounded-lg border border-slate-400 bg-slate-300 px-6 py-2 text-sm font-semibold text-slate-900 shadow-sm"
					>
						Agregar +
					</button>
				</div>
			</div>

			<div className="mt-8 flex justify-center">
				<button
					type="button"
					disabled={enviandoCarga}
					onClick={() => void crearCarga()}
					className="flex items-center gap-2 rounded-2xl border border-slate-500 bg-slate-400 px-8 py-3 text-base font-bold text-slate-900 shadow-lg hover:bg-slate-500 disabled:opacity-50"
				>
					{enviandoCarga ? "Creando…" : "Crear carga de Alumnos"}
				</button>
			</div>

			<h2 className="mt-16 text-center text-2xl font-bold text-slate-900">Carga de alumnos</h2>
			<div className="mx-auto mt-4 max-w-md">
				<label className="block text-sm font-semibold text-slate-700">Filtrar por fecha de cierre</label>
				<select
					value={filtroFechaVista}
					onChange={(e) => {
						setFiltroFechaVista(e.target.value);
						setCargaIdSubSeleccion(null);
					}}
					className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
				>
					<option value="">Última carga registrada</option>
					{fechasCierreExistentes.map((f) => (
						<option key={f} value={f}>
							Cierre {formatearFechaMostrar(f)}
						</option>
					))}
				</select>
			</div>
			{candidatosFechaVista.length > 1 ? (
				<div className="mx-auto mt-3 max-w-md">
					<label className="block text-xs font-semibold text-slate-600">Varias cargas con la misma fecha</label>
					<select
						value={cargaIdResueltoVista ?? ""}
						onChange={(e) => setCargaIdSubSeleccion(e.target.value || null)}
						className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm text-slate-900"
					>
						{candidatosFechaVista.map((c) => (
							<option key={c.id} value={c.id}>
								Creada {formatearFechaMostrar(c.creadoEn)} · grupos {c.gruposLetras.join(", ")}
							</option>
						))}
					</select>
				</div>
			) : null}
			<p className="mt-2 text-center text-sm text-slate-500">
				Grado de la carga: 1.° — cada alumno entra con la clave de su grupo. La papelera quita al alumno de la carga
				mostrada (y del padrón si aún no tiene cuenta); no borra otras entradas del historial.
			</p>
			{cargandoVistaFiltrada ? (
				<p className="mt-4 text-center text-sm text-slate-500">Cargando alumnos de la carga…</p>
			) : null}
			{vistaParaLista ? (
				<div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-md">
					<p className="mb-3 text-center text-xs text-slate-500">
						Cierre {formatearFechaMostrar(vistaParaLista.carga.fechaCierre)} · creada{" "}
						{formatearFechaMostrar(vistaParaLista.carga.creadoEn)}
					</p>
					<div className="flex flex-wrap gap-2">
						{gruposActuales.map((l) => (
							<button
								key={l}
								type="button"
								onClick={() => setGrupoVistaActual(l)}
								className={`flex min-h-10 min-w-[2.75rem] flex-col items-center justify-center rounded-lg border border-slate-400 px-2 py-1 text-sm font-bold shadow-sm ${
									grupoVistaResuelto === l ? "bg-slate-500 text-white" : "bg-slate-300 text-slate-900"
								}`}
							>
								<span>{l}</span>
								<span
									className={`mt-0.5 max-w-[5.5rem] truncate text-[10px] font-mono font-normal ${
										grupoVistaResuelto === l ? "text-white/90" : "text-slate-600"
									}`}
									title={clavesGrupoVista[l] ?? ""}
								>
									{clavesGrupoVista[l] ?? "—"}
								</span>
							</button>
						))}
					</div>
					<div className="mt-4 space-y-3">
						{lineasActuales.map((ln) => (
							<div
								key={ln.id}
								className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 shadow-sm"
							>
								<span className="font-medium text-slate-900">{ln.nombreCompleto}</span>
								<div className="flex gap-2">
									<button
										type="button"
										title="Ver documentos"
										onClick={() => void abrirVerDocumentos(ln.nombreCompleto, ln.padronId, ln.cuentaId)}
										className="rounded-lg border border-slate-400 bg-slate-300 p-2 text-slate-900"
									>
										📁
									</button>
									<button
										type="button"
										title="Cambiar de grupo"
										onClick={() => {
											setLineaCambiarGrupo(ln);
											setNuevoGrupoLetra("");
										}}
										className="rounded-lg border border-slate-400 bg-slate-300 p-2 text-slate-900"
									>
										⇄
									</button>
									<button
										type="button"
										title="Eliminar"
										onClick={() => void eliminarLinea(ln.id)}
										className="rounded-lg border border-slate-400 bg-slate-300 p-2 text-slate-900"
									>
										🗑
									</button>
								</div>
							</div>
						))}
						{lineasActuales.length === 0 ? (
							<p className="text-center text-sm text-slate-500">No hay alumnos en este grupo.</p>
						) : null}
					</div>
				</div>
			) : !cargandoVistaFiltrada ? (
				<p className="mt-4 text-center text-sm text-slate-500">
					{filtroFechaVista
						? "No hay cargas con esa fecha de cierre."
						: "Aún no hay cargas registradas."}
				</p>
			) : null}

			<h2 className="mt-16 text-center text-2xl font-bold text-slate-900">Historial de Carga de Alumnos</h2>
			<p className="mt-2 text-center text-sm text-slate-500">
				«Ver» consulta nombres y documentos. «Eliminar» quita el registro de la carga; alumnos sin cuenta se borran
				del padrón (si ya tienen cuenta, se conservan).
			</p>
			<div className="mt-6 space-y-3">
				{historial.map((h) => (
					<div
						key={h.id}
						className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
					>
						<span className="font-semibold text-slate-900">
							{formatearFechaMostrar(h.creadoEn)} — {formatearFechaMostrar(h.fechaCierre)}
						</span>
						<div className="flex flex-wrap gap-2">
							<button
								type="button"
								disabled={eliminandoCargaId !== null}
								onClick={() => void verHistorialCarga(h.id)}
								className="rounded-lg border border-slate-400 bg-slate-300 px-4 py-1.5 text-sm font-semibold text-slate-900 disabled:opacity-50"
							>
								Ver 👁
							</button>
							<button
								type="button"
								disabled={eliminandoCargaId !== null}
								onClick={() => void eliminarCargaHistorial(h.id)}
								className="rounded-lg border border-red-300 bg-red-100 px-4 py-1.5 text-sm font-semibold text-red-900 disabled:opacity-50"
							>
								{eliminandoCargaId === h.id ? "…" : "Eliminar"}
							</button>
						</div>
					</div>
				))}
				{historial.length === 0 ? <p className="text-center text-sm text-slate-500">Sin historial.</p> : null}
			</div>

			{historialDetalle ? (
				<div className="fixed inset-0 z-[220] flex items-center justify-center bg-black/40 p-4">
					<div className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
						<button
							type="button"
							className="mb-4 text-slate-600"
							onClick={() => {
								setHistorialDetalle(null);
								setEstatusHist(null);
							}}
						>
							← Volver
						</button>
						<h3 className="text-center text-xl font-bold text-slate-900">Historial de Archivos subidos</h3>
						<p className="mt-1 text-center text-sm text-slate-600">
							{formatearFechaMostrar(historialDetalle.carga.creadoEn)} —{" "}
							{formatearFechaMostrar(historialDetalle.carga.fechaCierre)}
						</p>
						{historialDetalle.clavesPorGrupo &&
						Object.keys(historialDetalle.clavesPorGrupo).length > 0 ? (
							<p className="mt-2 text-center text-xs font-mono text-slate-600">
								{historialDetalle.carga.gruposLetras.map((l) => (
									<span key={l} className="mx-1.5 inline-block">
										{l}: {historialDetalle.clavesPorGrupo?.[l] ?? "—"}
									</span>
								))}
							</p>
						) : null}
						<div className="mt-4 flex flex-wrap gap-2">
							{historialDetalle.carga.gruposLetras.map((l) => (
								<button
									key={l}
									type="button"
									onClick={() => setGrupoHist(l)}
									className={`h-9 min-w-[2.25rem] rounded-lg border px-2 text-sm font-bold ${
										grupoHist === l ? "bg-slate-500 text-white" : "bg-slate-300"
									}`}
								>
									{l}
								</button>
							))}
						</div>
						<div className="mt-4 space-y-2">
							{(historialDetalle.lineasPorGrupo[grupoHist] ?? []).map((ln) => (
								<div
									key={ln.id}
									className="flex items-center justify-between rounded-lg border border-slate-200 px-3 py-2"
								>
									<span className="text-slate-900">{ln.nombreCompleto}</span>
									<button
										type="button"
										className="rounded-lg border border-slate-400 bg-slate-300 p-2"
										onClick={async () => {
											const res = await fetch(
												`/api/orientador/cargas/documentos-estatus?padronId=${encodeURIComponent(ln.padronId)}`,
												{ credentials: "include" },
											);
											const data = (await res.json()) as {
												documentos?: DocEstatus[];
												cuentaId?: string | null;
											};
											if (res.ok) {
												setEstatusHist({
													nombre: ln.nombreCompleto,
													padronId: ln.padronId,
													cuentaId: data.cuentaId ?? ln.cuentaId,
													documentos: data.documentos ?? [],
												});
											}
										}}
									>
										📁
									</button>
								</div>
							))}
						</div>
						{estatusHist ? (
							<div className="mt-6 border-t border-slate-200 pt-4">
								<p className="font-semibold text-slate-900">{estatusHist.nombre}</p>
								<ul className="mt-2 space-y-1 text-sm text-slate-700">
									{estatusHist.documentos.map((d) => (
										<li key={d.tipo}>
											{d.etiqueta}:{" "}
											{d.tieneArchivo
												? d.estado ?? "pendiente"
												: "sin subir"}
										</li>
									))}
								</ul>
							</div>
						) : null}
					</div>
				</div>
			) : null}

			{lineaCambiarGrupo ? (
				<div className="fixed inset-0 z-[230] flex items-center justify-center bg-black/40 p-4">
					<div className="w-full max-w-md rounded-2xl bg-white p-6 shadow-2xl">
						<button
							type="button"
							className="text-slate-600"
							onClick={() => setLineaCambiarGrupo(null)}
						>
							←
						</button>
						<h3 className="mt-2 text-center text-xl font-bold">Cambiar de grupo</h3>
						<p className="mt-2 text-center text-slate-700">{lineaCambiarGrupo.nombreCompleto}</p>
						<div className="mt-6 flex items-center justify-center gap-4">
							<div className="text-center">
								<p className="text-xs text-slate-500">De</p>
								<p className="text-3xl font-bold">{lineaCambiarGrupo.grupoLetra}</p>
							</div>
							<span className="text-2xl">&gt;&gt;</span>
							<div className="text-center">
								<p className="text-xs text-slate-500">A</p>
								<input
									value={nuevoGrupoLetra}
									onChange={(e) => setNuevoGrupoLetra(e.target.value.toUpperCase())}
									maxLength={3}
									className="mt-1 w-16 rounded-lg border-2 border-slate-400 py-2 text-center text-2xl font-bold uppercase"
								/>
							</div>
						</div>
						<p className="mt-2 text-center text-xs text-slate-500">
							Letra debe ser una de: {gruposActuales.join(", ")}
						</p>
						<button
							type="button"
							onClick={() => void guardarCambioGrupo()}
							className="mt-6 w-full rounded-xl bg-slate-600 py-3 font-semibold text-white"
						>
							Guardar
						</button>
					</div>
				</div>
			) : null}

			{verDocs ? (
				<div className="fixed inset-0 z-[240] flex items-center justify-center bg-black/40 p-4">
					<div className="max-h-[92vh] w-full max-w-5xl overflow-y-auto rounded-2xl bg-white p-6 shadow-2xl">
						<button
							type="button"
							className="text-slate-600"
							onClick={() => {
								setVerDocs(null);
								setPreviewUrl((u) => {
									if (u) {
										URL.revokeObjectURL(u);
									}
									return null;
								});
							}}
						>
							← Volver
						</button>
						<h3 className="mt-2 text-center text-xl font-bold">Verificar Archivos subidos por el alumno</h3>
						<p className="text-center text-slate-700">{verDocs.nombre}</p>
						<div className="mt-6 grid gap-4 sm:grid-cols-3">
							{verDocs.documentos.map((doc) => (
								<div key={doc.tipo} className="rounded-xl border border-slate-200 p-4 shadow-sm">
									<p className="text-center font-bold text-slate-900">{doc.etiqueta}</p>
									<div className="mt-3 flex min-h-[140px] flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-3">
										{doc.tieneArchivo ? (
											<button
												type="button"
												onClick={() => void abrirPreview(doc.tipo)}
												className="flex flex-col items-center gap-2"
											>
												<span className="rounded border-2 border-black px-4 py-2 text-2xl font-black">
													PDF
												</span>
												<span className="text-sm text-slate-600">Vista previa</span>
											</button>
										) : (
											<span className="text-2xl font-bold text-slate-400">Sin archivo</span>
										)}
									</div>
									<div className="mt-3 grid grid-cols-2 gap-2">
										<button
											type="button"
											disabled={!verDocs.cuentaId || !doc.tieneArchivo}
											onClick={() => void verificarDoc("validar_manual", doc.tipo)}
											className="rounded-lg border border-slate-500 bg-slate-400 py-2 font-bold disabled:opacity-40"
										>
											✓
										</button>
										<button
											type="button"
											disabled={!verDocs.cuentaId || !doc.tieneArchivo}
											onClick={() => void verificarDoc("rechazar", doc.tipo)}
											className="rounded-lg border border-slate-500 bg-slate-400 py-2 font-bold disabled:opacity-40"
										>
											✕
										</button>
									</div>
								</div>
							))}
						</div>
						{previewUrl ? (
							<div className="mt-8 rounded-xl border border-slate-300 bg-slate-100 p-2">
								<p className="mb-2 text-sm font-semibold text-slate-700">{previewTitulo}</p>
								<iframe title="Vista documento" src={previewUrl} className="h-[70vh] w-full rounded-lg bg-white" />
							</div>
						) : null}
					</div>
				</div>
			) : null}
		</div>
	);
}
