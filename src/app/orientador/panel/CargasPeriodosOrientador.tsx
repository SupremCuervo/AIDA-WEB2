"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { esTipoDocumentoValido } from "@/lib/nombre-archivo";
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
	esSoloPadron?: boolean;
};

type DocEstatus = {
	tipo: string;
	etiqueta: string;
	estado: string | null;
	tieneArchivo: boolean;
};

/** Texto dentro de cada recuadro del modal «Verificar archivos subidos». */
function mensajeEstadoDocumentoEnTarjeta(doc: DocEstatus): {
	titulo: string;
	detalle: string;
	claseFondo: string;
	claseBorde: string;
	claseTitulo: string;
} {
	if (!doc.tieneArchivo) {
		return {
			titulo: "Sin archivo",
			detalle: "Este documento aún no tiene archivo subido por el alumno.",
			claseFondo: "bg-slate-100",
			claseBorde: "border-slate-200",
			claseTitulo: "text-slate-700",
		};
	}
	const e = (doc.estado ?? "").trim().toLowerCase();
	switch (e) {
		case "validado":
			return {
				titulo: "Documento aceptado",
				detalle: "Marcaste este archivo como correcto; el alumno lo verá como aceptado.",
				claseFondo: "bg-emerald-50",
				claseBorde: "border-emerald-200",
				claseTitulo: "text-emerald-900",
			};
		case "rechazado":
			return {
				titulo: "Documento rechazado",
				detalle: "Marcaste este archivo como incorrecto; el alumno podrá subir otro archivo.",
				claseFondo: "bg-red-50",
				claseBorde: "border-red-200",
				claseTitulo: "text-red-900",
			};
		case "pendiente_revision_manual":
			return {
				titulo: "Pendiente de tu revisión",
				detalle: "El alumno ya subió archivo: usa ✓ para aceptar o ✕ para rechazar.",
				claseFondo: "bg-amber-50",
				claseBorde: "border-amber-200",
				claseTitulo: "text-amber-900",
			};
		default:
			return {
				titulo: "Archivo registrado",
				detalle:
					e !== ""
						? `Estado en sistema: ${e}. Revisa con ✓ o ✕ si aplica.`
						: "Hay archivo asociado; revisa con ✓ o ✕ si aplica.",
				claseFondo: "bg-slate-50",
				claseBorde: "border-slate-200",
				claseTitulo: "text-slate-800",
			};
	}
}

function fechaInputDesdeIso(iso: string | null | undefined): string {
	if (!iso || typeof iso !== "string") {
		return "";
	}
	return iso.slice(0, 10);
}

/** Fecha YYYY-MM-DD desde ISO o texto de BD (evita desajustes al comparar plazos). */
function fechaSoloDia(v: string | null | undefined): string {
	if (!v || typeof v !== "string") {
		return "";
	}
	const s = v.trim().slice(0, 10);
	return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : "";
}

function formatearFechaMostrar(iso: string): string {
	const s = iso.slice(0, 10);
	const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s);
	if (!m) {
		return iso;
	}
	return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Letras A–Z en orden de aparición, sin duplicados (ignora números y otros caracteres). */
function letrasUnicasEnOrden(valor: string): string[] {
	const visto = new Set<string>();
	const orden: string[] = [];
	for (const ch of valor.toUpperCase()) {
		if (ch >= "A" && ch <= "Z" && !visto.has(ch)) {
			visto.add(ch);
			orden.push(ch);
		}
	}
	return orden;
}

function formatearListaGruposLetras(valor: string): string {
	return letrasUnicasEnOrden(valor).join(", ");
}

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

type CarreraPeriodoUi = {
	id: string;
	codigo: string;
	nombre: string;
};

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

/** Vista de carga actual para filtrar tokens en el modal. `null` = sin carga en contexto. */
export type ContextoModalTokensCargas = {
	fechaCierre: string;
	gradoCarga: number;
	cargaId: string;
	gruposLetras: string[];
} | null;

type PropsCargasPeriodos = {
	modo: ModoPanel;
	/** Abre el modal de tokens con el periodo de la carga visible (fecha de cierre + grado). */
	onAbrirModalTokens?: (ctx: ContextoModalTokensCargas) => void;
};

export default function CargasPeriodosOrientador({ modo, onAbrirModalTokens }: PropsCargasPeriodos) {
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
	const [ayudaImportarAbierta, setAyudaImportarAbierta] = useState(false);

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
	const [previewMime, setPreviewMime] = useState<string | null>(null);
	const [previewTitulo, setPreviewTitulo] = useState("");
	const [previewCargando, setPreviewCargando] = useState(false);

	const [historialDetalle, setHistorialDetalle] = useState<{
		carga: CargaListaItem;
		lineasPorGrupo: Record<string, LineaAlumno[]>;
		clavesPorGrupo?: Record<string, string>;
	} | null>(null);
	const [historialFechaDraft, setHistorialFechaDraft] = useState("");
	const [guardandoFechaHistorial, setGuardandoFechaHistorial] = useState(false);
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
	const [cargandoGruposPeriodo, setCargandoGruposPeriodo] = useState(false);
	const [carrerasPeriodo, setCarrerasPeriodo] = useState<CarreraPeriodoUi[]>([]);
	const [cargandoCarrerasPeriodo, setCargandoCarrerasPeriodo] = useState(false);
	const [clavesPorGrupoUltima, setClavesPorGrupoUltima] = useState<Record<string, string>>({});

	const [filtroFechaVista, setFiltroFechaVista] = useState("");
	const [vistaCargaTick, setVistaCargaTick] = useState(0);
	const [cargaIdSubSeleccion, setCargaIdSubSeleccion] = useState<string | null>(null);
	const [cargaIdCrearExistente, setCargaIdCrearExistente] = useState("");
	const [cargaVistaFiltrada, setCargaVistaFiltrada] = useState<{
		carga: CargaListaItem;
		lineasPorGrupo: Record<string, LineaAlumno[]>;
		clavesPorGrupo: Record<string, string>;
	} | null>(null);
	const [cargandoVistaFiltrada, setCargandoVistaFiltrada] = useState(false);
	const [lineaEliminarPendiente, setLineaEliminarPendiente] = useState<{
		id: string;
		nombreCompleto: string;
	} | null>(null);

	const avisoCargaRef = useRef<HTMLDivElement>(null);
	const previewRef = useRef<HTMLDivElement>(null);

	const desplazarAAvisoCarga = useCallback(() => {
		window.requestAnimationFrame(() => {
			avisoCargaRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	}, []);

	const letrasCrear = useMemo(() => letrasUnicasEnOrden(gruposTexto), [gruposTexto]);

	useEffect(() => {
		if (modo !== "cargas") {
			return;
		}
		if (letrasCrear.length === 0) {
			return;
		}
		if (!letrasCrear.includes(grupoEdicion)) {
			setGrupoEdicion(letrasCrear[0]);
		}
	}, [modo, letrasCrear, grupoEdicion]);

	useEffect(() => {
		if (!ayudaImportarAbierta) {
			return;
		}
		const cerrar = (e: KeyboardEvent) => {
			if (e.key === "Escape") {
				setAyudaImportarAbierta(false);
			}
		};
		window.addEventListener("keydown", cerrar);
		return () => window.removeEventListener("keydown", cerrar);
	}, [ayudaImportarAbierta]);

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
			setCargandoCarrerasPeriodo(true);
			try {
				const res = await fetch("/api/orientador/carreras", { credentials: "include" });
				const data = (await res.json()) as { carreras?: CarreraPeriodoUi[] };
				if (!cancel && res.ok) {
					setCarrerasPeriodo(data.carreras ?? []);
				}
			} finally {
				if (!cancel) {
					setCargandoCarrerasPeriodo(false);
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
			const filas = data.filas ?? [];
			const actuales = letrasUnicasEnOrden(gruposTexto);
			const letrasEnArchivo = [...new Set(filas.map((r) => r.grupoLetra).filter((g) => g.length > 0))];
			const visto = new Set(actuales);
			const letrasCombinadas = [...actuales];
			for (const L of letrasEnArchivo) {
				if (!visto.has(L)) {
					visto.add(L);
					letrasCombinadas.push(L);
				}
			}
			if (letrasCombinadas.length > 0) {
				setGruposTexto(letrasCombinadas.join(", "));
			}

			const manualPorGrupo = { ...nombresPorGrupo };
			const claves = new Set<string>();
			for (const g of letrasCombinadas) {
				for (const n of manualPorGrupo[g] ?? []) {
					const t = n.trim();
					if (t) {
						claves.add(`${t.toLowerCase()}|${g}`);
					}
				}
			}
			const merged = { ...manualPorGrupo };
			for (const row of filas) {
				const g = row.grupoLetra;
				if (!letrasCombinadas.includes(g)) {
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
			const anadidosDesdeExcel = letrasEnArchivo.filter((L) => !actuales.includes(L));
			if (filas.length === 0) {
				setOkMsg("El archivo no trae filas con nombre y grupo válidos.");
			} else if (anadidosDesdeExcel.length > 0) {
				setOkMsg(
					`Se añadieron al campo Grupos: ${anadidosDesdeExcel.sort().join(", ")}. Nombres listos (sin duplicar). Solo elige la fecha de cierre y crea la carga.`,
				);
			} else {
				setOkMsg(
					"Nombres mezclados (sin duplicar). Revisa cada pestaña de grupo. Solo elige la fecha de cierre y crea la carga.",
				);
			}
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
		const fechaNormCrear = fechaSoloDia(fechaCierre.trim());
		if (!fechaNormCrear) {
			setErrorMsg("Indica la fecha de cierre.");
			desplazarAAvisoCarga();
			return;
		}
		if (letrasCrear.length === 0) {
			setErrorMsg("Indica al menos una letra de grupo (ej. A, B, C).");
			desplazarAAvisoCarga();
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
					fechaCierre: fechaNormCrear,
					gradoCarga: 1,
					alumnos,
					cargaId: cargaIdCrearExistente || undefined,
				}),
			});
			const data = (await res.json()) as {
				ok?: boolean;
				error?: string;
				fusionada?: boolean;
				alumnosRegistrados?: number;
				tokensPorGrupo?: { grupoLetra: string; claveAcceso: string }[];
				fechaCierre?: string;
				gradoCarga?: number;
			};
			if (!res.ok) {
				setErrorMsg(data.error ?? "No se pudo crear la carga");
				desplazarAAvisoCarga();
				return;
			}
			const reg = typeof data.alumnosRegistrados === "number" ? data.alumnosRegistrados : alumnos.length;
			const sufijoTxt = " Se descargó el .txt con la clave de cada grupo.";
			if (data.fusionada) {
				setOkMsg(
					reg === 0
						? `Se añadieron grupo(s) al mismo plazo (sin duplicar la carga). Sin alumnos nuevos.${sufijoTxt}`
						: `Se fusionó con la carga de este plazo: ${reg} alumno${reg === 1 ? "" : "s"} registrado(s).${sufijoTxt}`,
				);
			} else {
				setOkMsg(
					reg === 0
						? `Carga creada con ${letrasCrear.length} grupo(s) y claves; sin alumnos aún.${sufijoTxt}`
						: `Carga creada (${reg} alumno${reg === 1 ? "" : "s"}).${sufijoTxt}`,
				);
			}
			setTimeout(() => setOkMsg(""), DURACION_MENSAJE_EMERGENTE_MS);
			setNombresPorGrupo({});
			if (data.tokensPorGrupo && data.fechaCierre) {
				descargarTxtClavesGrupos(data.tokensPorGrupo, data.fechaCierre, data.gradoCarga ?? 1);
			}
			await refrescarCargas();
			window.setTimeout(() => desplazarAAvisoCarga(), 0);
		} catch {
			setErrorMsg("Error de red.");
			desplazarAAvisoCarga();
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
		setErrorMsg("");
		if (verDocs) {
			await abrirVerDocumentos(verDocs.nombre, verDocs.padronId, verDocs.cuentaId);
		}
	}

	async function abrirPreview(tipo: string, etiquetaLegible: string) {
		const cId = verDocs?.cuentaId;
		if (!cId) {
			setErrorMsg("No hay cuenta activa del alumno para mostrar vista previa.");
			return;
		}
		setPreviewTitulo(etiquetaLegible || tipo);
		setPreviewCargando(true);
		setPreviewMime(null);
		setPreviewUrl((prev) => {
			if (prev) {
				URL.revokeObjectURL(prev);
			}
			return null;
		});
		try {
			const res = await fetch(
				`/api/orientador/documento/descargar?cuentaId=${encodeURIComponent(cId)}&tipo=${encodeURIComponent(tipo)}&inline=1`,
				{ credentials: "include" },
			);
			if (!res.ok) {
				const d = (await res.json().catch(() => ({}))) as { error?: string };
				setErrorMsg(d.error ?? "No se pudo cargar la vista previa del documento.");
				return;
			}
			const buf = await res.arrayBuffer();
			const headerCt = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
			let mime =
				headerCt !== "" && headerCt !== "application/octet-stream"
					? headerCt
					: "application/octet-stream";
			if (mime === "application/octet-stream" && esTipoDocumentoValido(tipo)) {
				mime = "application/pdf";
			}
			const blob = new Blob([buf], { type: mime });
			const u = URL.createObjectURL(blob);
			setPreviewMime(mime);
			setPreviewUrl((prev) => {
				if (prev) {
					URL.revokeObjectURL(prev);
				}
				return u;
			});
		} catch {
			setErrorMsg("Error de red al cargar la vista previa.");
		} finally {
			setPreviewCargando(false);
		}
	}

	useEffect(() => {
		return () => {
			if (previewUrl) {
				URL.revokeObjectURL(previewUrl);
			}
		};
	}, [previewUrl]);

	useEffect(() => {
		if (!previewUrl) {
			return;
		}
		window.requestAnimationFrame(() => {
			previewRef.current?.scrollIntoView({ behavior: "smooth", block: "start" });
		});
	}, [previewUrl]);

	async function guardarCambioGrupo() {
		if (!lineaCambiarGrupo) {
			return;
		}
		const letra = nuevoGrupoLetra.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 1);
		if (!letra || !/^[A-Z]$/.test(letra)) {
			setErrorMsg("Indica una sola letra de grupo (A–Z).");
			return;
		}
		const cargaIdVista = vistaParaLista?.carga.id ?? "";
		const payload: { lineaId: string; nuevoGrupoLetra: string; cargaId?: string } = {
			lineaId: lineaCambiarGrupo.id,
			nuevoGrupoLetra: letra,
		};
		if (lineaCambiarGrupo.id.startsWith("padron:")) {
			if (!cargaIdVista) {
				setErrorMsg("No se pudo determinar la carga activa. Recarga la página o elige una fecha de cierre.");
				return;
			}
			payload.cargaId = cargaIdVista;
		}
		const res = await fetch("/api/orientador/cargas/linea", {
			method: "PATCH",
			credentials: "include",
			headers: { "Content-Type": "application/json" },
			body: JSON.stringify(payload),
		});
		const d = (await res.json()) as { error?: string };
		if (!res.ok) {
			setErrorMsg(d.error ?? "No se pudo cambiar de grupo");
			return;
		}
		setLineaCambiarGrupo(null);
		setNuevoGrupoLetra("");
		await refrescarCargas();
		setVistaCargaTick((t) => t + 1);
	}

	async function eliminarLinea(lineaId: string) {
		const cargaIdVista = vistaParaLista?.carga.id ?? "";
		const q = new URLSearchParams();
		q.set("lineaId", lineaId);
		if (lineaId.startsWith("padron:")) {
			if (!cargaIdVista) {
				setErrorMsg("No se pudo determinar la carga activa. Recarga la página o elige una fecha de cierre.");
				return;
			}
			q.set("cargaId", cargaIdVista);
		}
		const res = await fetch(`/api/orientador/cargas/linea?${q.toString()}`, {
			method: "DELETE",
			credentials: "include",
		});
		const d = (await res.json()) as { error?: string };
		if (!res.ok) {
			setErrorMsg(d.error ?? "No se pudo eliminar");
			return;
		}
		await refrescarCargas();
		setVistaCargaTick((t) => t + 1);
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
		setHistorialFechaDraft(fechaInputDesdeIso(data.carga.fechaCierre));
		const g0 = data.carga.gruposLetras[0] ?? "A";
		setGrupoHist(g0);
	}

	async function guardarFechaHistorialCarga() {
		if (!historialDetalle) {
			return;
		}
		const f = historialFechaDraft.trim().slice(0, 10);
		if (!/^\d{4}-\d{2}-\d{2}$/.test(f)) {
			setErrorMsg("La fecha debe ser válida (YYYY-MM-DD).");
			return;
		}
		setGuardandoFechaHistorial(true);
		setErrorMsg("");
		try {
			const res = await fetch(`/api/orientador/cargas/${historialDetalle.carga.id}`, {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ fechaCierre: f }),
			});
			const d = (await res.json()) as {
				error?: string;
				carga?: CargaListaItem;
				clavesPorGrupo?: Record<string, string>;
			};
			if (!res.ok) {
				setErrorMsg(d.error ?? "No se pudo guardar la fecha");
				return;
			}
			if (d.carga) {
				setHistorialDetalle((prev) =>
					prev
						? {
								...prev,
								carga: d.carga!,
								clavesPorGrupo: d.clavesPorGrupo ?? prev.clavesPorGrupo,
							}
						: null,
				);
				setHistorialFechaDraft(fechaInputDesdeIso(d.carga.fechaCierre));
			}
			setOkMsg("Fecha de cierre actualizada (también en las claves de grupo).");
			setTimeout(() => setOkMsg(""), DURACION_MENSAJE_EMERGENTE_MS);
			await refrescarCargas();
		} catch {
			setErrorMsg("Error de red al guardar la fecha.");
		} finally {
			setGuardandoFechaHistorial(false);
		}
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

	function anadirLetraAGruposSiFalta(letra: string) {
		const L = letra.trim().toUpperCase();
		if (!L || L.length !== 1 || L < "A" || L > "Z") {
			return;
		}
		const actuales = letrasUnicasEnOrden(gruposTexto);
		if (actuales.includes(L)) {
			setGrupoEdicion(L);
			return;
		}
		setGruposTexto(formatearListaGruposLetras(actuales.join("") + L));
		setGrupoEdicion(L);
	}

	const fechasCierreExistentes = useMemo(() => {
		const u = new Set<string>();
		for (const h of historial) {
			const d = fechaSoloDia(h.fechaCierre);
			if (d) {
				u.add(d);
			}
		}
		return [...u].sort((a, b) => (a < b ? 1 : -1));
	}, [historial]);

	const cargasPorFechaCierre = useMemo(() => {
		const m = new Map<string, CargaListaItem[]>();
		for (const h of historial) {
			const k = fechaSoloDia(h.fechaCierre);
			if (!k) {
				continue;
			}
			const arr = m.get(k) ?? [];
			arr.push(h);
			m.set(k, arr);
		}
		for (const arr of m.values()) {
			arr.sort((a, b) => (a.creadoEn < b.creadoEn ? 1 : -1));
		}
		return m;
	}, [historial]);

	const fechaCierreNormFormulario = fechaSoloDia(fechaCierre.trim());
	const letrasYaConCargaEnFecha = useMemo(() => {
		const s = new Set<string>();
		if (!fechaCierreNormFormulario) {
			return s;
		}
		for (const h of historial) {
			if (fechaSoloDia(h.fechaCierre) !== fechaCierreNormFormulario) {
				continue;
			}
			for (const l of h.gruposLetras) {
				s.add(String(l).toUpperCase());
			}
		}
		return s;
	}, [historial, fechaCierreNormFormulario]);

	const cargasEnFechaFormulario = useMemo(() => {
		if (!fechaCierreNormFormulario) {
			return [] as CargaListaItem[];
		}
		return cargasPorFechaCierre.get(fechaCierreNormFormulario) ?? [];
	}, [fechaCierreNormFormulario, cargasPorFechaCierre]);

	useEffect(() => {
		if (cargasEnFechaFormulario.length === 0) {
			if (cargaIdCrearExistente !== "") {
				setCargaIdCrearExistente("");
			}
			return;
		}
		if (!cargaIdCrearExistente || !cargasEnFechaFormulario.some((c) => c.id === cargaIdCrearExistente)) {
			setCargaIdCrearExistente(cargasEnFechaFormulario[0]?.id ?? "");
		}
	}, [cargasEnFechaFormulario, cargaIdCrearExistente]);

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

	const contextoModalTokensDesdeVista = useMemo((): ContextoModalTokensCargas => {
		if (modo !== "cargas") {
			return null;
		}
		if (!filtroFechaVista) {
			if (!cargaActual?.carga) {
				return null;
			}
			const fc = fechaSoloDia(cargaActual.carga.fechaCierre);
			if (!fc) {
				return null;
			}
			return {
				fechaCierre: fc,
				gradoCarga: cargaActual.carga.gradoCarga,
				cargaId: cargaActual.carga.id,
				gruposLetras: cargaActual.carga.gruposLetras ?? [],
			};
		}
		const cand = candidatosFechaVista;
		if (cand.length === 0) {
			return null;
		}
		const id = cargaIdResueltoVista;
		const sel = (id ? cand.find((c) => c.id === id) : null) ?? cand[0];
		if (!sel) {
			return null;
		}
		const fc = fechaSoloDia(sel.fechaCierre);
		if (!fc) {
			return null;
		}
		return {
			fechaCierre: fc,
			gradoCarga: sel.gradoCarga,
			cargaId: sel.id,
			gruposLetras: sel.gruposLetras ?? [],
		};
	}, [modo, filtroFechaVista, cargaActual, candidatosFechaVista, cargaIdResueltoVista]);

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
	}, [modo, filtroFechaVista, cargaIdSubSeleccion, cargasPorFechaCierre, vistaCargaTick]);

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
			<div className="mx-auto mt-5 w-full max-w-none pb-16">
				<div className="mb-6 space-y-3 text-center text-sm text-slate-600">
					<p>
						Establece los periodos anuales de cambio de semestre para que los expedientes sean actualizados de grado
						automaticamente.
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
						className="rounded-2xl border-2 border-[#7C3AED] bg-[#EDE9FE] px-10 py-3 text-base font-bold text-[#5B21B6] shadow-md transition hover:bg-[#DDD6FE] hover:shadow-lg disabled:opacity-50"
					>
						{guardandoPeriodos ? "Guardando…" : "Guardar Periodos"}
					</button>
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
		<div className="mx-auto mt-5 w-full max-w-none pb-24">
			<div
				ref={avisoCargaRef}
				className={`scroll-mt-28 space-y-3 ${errorMsg || okMsg ? "mb-4" : ""}`}
				aria-live="polite"
				aria-atomic="true"
			>
				{errorMsg ? (
					<p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorMsg}</p>
				) : null}
				{okMsg ? (
					<p className="rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{okMsg}</p>
				) : null}
			</div>
			{cargandoCargas ? (
				<p className="text-center text-sm text-slate-500">Cargando…</p>
			) : null}

			<div className="mt-4 grid grid-cols-1 gap-10 lg:grid-cols-2 lg:items-start lg:gap-8 xl:gap-10">
				<div className="min-w-0 rounded-2xl border border-slate-200 bg-white p-4 shadow-md sm:p-5 lg:sticky lg:top-28 lg:max-h-[calc(100dvh-8rem)] lg:overflow-y-auto">
					<h2 className="text-center text-xl font-bold text-slate-900 sm:text-2xl lg:text-left">
						Crear Carga de Alumnos
					</h2>
					<div className="mt-6 flex flex-wrap items-end gap-4">
				<div className="min-w-[12rem] flex-1">
					<label className="block text-sm font-semibold text-slate-700">Ingresa los grupos</label>
					<input
						value={gruposTexto}
						onChange={(e) => setGruposTexto(formatearListaGruposLetras(e.target.value))}
						placeholder="Escribe letras (ej. B luego C → B, C)"
						autoComplete="off"
						inputMode="text"
						className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-slate-900"
					/>
				</div>
				<div className="min-w-[12rem] flex-1">
					<label className="block text-sm font-semibold text-slate-700">Fecha de cierre</label>
					<input
						type="date"
						value={fechaCierreNormFormulario}
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
									fechaCierreNormFormulario === f
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
			{cargasEnFechaFormulario.length > 0 ? (
				<div className="mt-3 rounded-lg border border-violet-200 bg-violet-50/80 px-3 py-2">
					<label className="block text-xs font-semibold text-violet-900" htmlFor="aida-carga-existente-select">
						Carga existente a ampliar (misma fecha)
					</label>
					<select
						id="aida-carga-existente-select"
						value={cargaIdCrearExistente}
						onChange={(e) => setCargaIdCrearExistente(e.target.value)}
						className="mt-1 w-full rounded-lg border border-violet-300 bg-white px-3 py-2 text-sm text-slate-900"
					>
						{cargasEnFechaFormulario.map((c) => (
							<option key={c.id} value={c.id}>
								{`${formatearFechaMostrar(c.creadoEn)} · grupos: ${(c.gruposLetras ?? []).join(", ") || "—"}`}
							</option>
						))}
					</select>
					<p className="mt-1 text-[11px] text-violet-800">
						Al crear, se agregan grupos/alumnos a esta carga y se conserva su fecha de cierre.
					</p>
				</div>
			) : null}
			<div className="mt-8 rounded-2xl border border-slate-200 bg-white p-5 shadow-md">
				<div className="flex flex-wrap items-center gap-2">
					{letrasCrear.map((l) => {
						const yaExiste = letrasYaConCargaEnFecha.has(l);
						const base =
							grupoEdicion === l
								? yaExiste
									? "border-emerald-700 bg-emerald-600 text-white ring-2 ring-emerald-300"
									: "border-[#6D28D9] bg-[#7C3AED] text-white ring-2 ring-[#DDD6FE]"
								: yaExiste
									? "border-emerald-500 bg-emerald-100 text-emerald-950 hover:bg-emerald-200"
									: "border-[#C4B5FD] bg-[#EDE9FE] text-[#5B21B6] hover:bg-[#DDD6FE]";
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
					<div className="ml-auto flex items-center gap-2">
						<label className="cursor-pointer rounded-lg border-2 border-[#2563EB] bg-[#DBEAFE] px-3 py-2 text-sm font-semibold text-[#1E40AF] shadow-sm transition hover:bg-[#BFDBFE]">
							Importar
							<input
								type="file"
								accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
								className="hidden"
								aria-label="Importar Excel"
								onChange={(e) => {
									const f = e.target.files?.[0];
									e.target.value = "";
									if (f) {
										void importarExcel(f);
									}
								}}
							/>
						</label>
						<button
							type="button"
							className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full border-2 border-[#7C3AED] bg-[#EDE9FE] text-lg font-bold leading-none text-[#5B21B6] shadow-sm transition hover:bg-[#DDD6FE]"
							aria-label="Ayuda: cómo importar desde Excel"
							onClick={() => setAyudaImportarAbierta(true)}
						>
							?
						</button>
					</div>
				</div>
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
								className="rounded-lg border-2 border-[#2563EB] bg-[#DBEAFE] px-3 py-2 text-[#1E40AF] transition hover:bg-[#BFDBFE]"
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
						className="rounded-lg border-2 border-[#7C3AED] bg-[#EDE9FE] px-6 py-2 text-sm font-semibold text-[#5B21B6] shadow-sm transition hover:bg-[#DDD6FE]"
					>
						Agregar +
					</button>
				</div>
			</div>

			<div className="mt-8 flex flex-col items-center gap-4">
				<button
					type="button"
					disabled={enviandoCarga}
					onClick={() => void crearCarga()}
					className="flex items-center gap-2 rounded-2xl border-2 border-[#7C3AED] bg-[#EDE9FE] px-8 py-3 text-base font-bold text-[#5B21B6] shadow-md transition hover:bg-[#DDD6FE] hover:shadow-lg disabled:opacity-50"
				>
					{enviandoCarga ? "Creando…" : "Crear carga de Alumnos"}
				</button>
			</div>
				</div>

				<div className="min-w-0 flex flex-col gap-12">
					<section className="min-w-0">
			<h2 className="text-center text-xl font-bold text-slate-900 sm:text-2xl lg:text-left">Carga de alumnos</h2>
			<div className="mt-4 w-full px-0">
				<div className="flex flex-col items-stretch gap-3 sm:flex-row sm:items-end sm:gap-4">
					<label className="flex min-w-[12rem] flex-1 flex-col gap-1 text-xs font-semibold text-slate-700">
						Fecha de carga visible
						<select
							value={filtroFechaVista}
							onChange={(e) => {
								setFiltroFechaVista(e.target.value);
								setCargaIdSubSeleccion(null);
								setVistaCargaTick((t) => t + 1);
							}}
							className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
						>
							<option value="">Ultima carga</option>
							{fechasCierreExistentes.map((f) => (
								<option key={f} value={f}>
									{formatearFechaMostrar(f)}
								</option>
							))}
						</select>
					</label>
					{filtroFechaVista ? (
						<label className="flex min-w-[14rem] flex-1 flex-col gap-1 text-xs font-semibold text-slate-700">
							Carga
							<select
								value={cargaIdResueltoVista ?? ""}
								onChange={(e) => {
									setCargaIdSubSeleccion(e.target.value || null);
									setVistaCargaTick((t) => t + 1);
								}}
								className="rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900"
							>
								{candidatosFechaVista.map((c) => (
									<option key={c.id} value={c.id}>
										{`Creada ${formatearFechaMostrar(c.creadoEn)} · grupos ${(c.gruposLetras ?? []).join(", ")}`}
									</option>
								))}
							</select>
						</label>
					) : null}
					{onAbrirModalTokens ? (
						<button
							type="button"
							onClick={() => onAbrirModalTokens(contextoModalTokensDesdeVista)}
							title="Claves por grupo de la carga visible"
							className="shrink-0 rounded-xl border-2 border-[#6D28D9] bg-[#EDE9FE] px-5 py-2.5 text-sm font-bold text-[#5B21B6] shadow-sm transition hover:bg-[#DDD6FE] sm:mb-px"
						>
							Tokens
						</button>
					) : null}
				</div>
			</div>
			{vistaParaLista ? (
				<div className="mt-6 rounded-2xl border-2 border-[#C4B5FD] bg-[#EDE9FE] p-5 shadow-md">
					<p className="mb-3 text-center text-xs font-medium text-[#5B21B6]">
						Cierre {formatearFechaMostrar(vistaParaLista.carga.fechaCierre)} · creada{" "}
						{formatearFechaMostrar(vistaParaLista.carga.creadoEn)}
					</p>
					<div className="flex flex-wrap gap-2">
						{gruposActuales.map((l) => (
							<button
								key={l}
								type="button"
								onClick={() => setGrupoVistaActual(l)}
								className={`flex min-h-10 min-w-[2.75rem] flex-col items-center justify-center rounded-lg border-2 px-2 py-1 text-sm font-bold shadow-sm transition ${
									grupoVistaResuelto === l
										? "border-[#6D28D9] bg-[#7C3AED] text-white"
										: "border-[#DDD6FE] bg-[#F5F3FF] text-[#5B21B6] hover:bg-[#EDE9FE]"
								}`}
							>
								<span>{l}</span>
								<span
									className={`mt-0.5 max-w-[5.5rem] truncate text-[10px] font-mono font-normal ${
										grupoVistaResuelto === l ? "text-white/90" : "text-[#6D28D9]"
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
								className="flex flex-wrap items-center justify-between gap-3 rounded-xl border-2 border-[#DDD6FE] bg-[#F5F3FF] px-4 py-3 shadow-sm"
							>
								<span className="font-medium text-[#4C1D95]">{ln.nombreCompleto}</span>
								<div className="flex gap-2">
									<button
										type="button"
										title="Ver documentos"
										onClick={() => void abrirVerDocumentos(ln.nombreCompleto, ln.padronId, ln.cuentaId)}
										className="rounded-lg border-2 border-[#C4B5FD] bg-[#EDE9FE] p-2 text-[#5B21B6] transition hover:bg-[#DDD6FE]"
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
										className="rounded-lg border-2 border-[#C4B5FD] bg-[#EDE9FE] p-2 text-[#5B21B6] transition hover:bg-[#DDD6FE]"
									>
										⇄
									</button>
									<button
										type="button"
										title="Eliminar"
										onClick={() =>
											setLineaEliminarPendiente({
												id: ln.id,
												nombreCompleto: ln.nombreCompleto,
											})
										}
										className="rounded-lg border-2 border-[#C4B5FD] bg-[#EDE9FE] p-2 text-[#5B21B6] transition hover:bg-[#DDD6FE]"
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
			) : (
				<p className="mt-4 text-center text-sm text-slate-500">Aun no hay cargas registradas.</p>
			)}
					</section>

					<section className="min-w-0">
			<h2 className="text-center text-xl font-bold text-slate-900 sm:text-2xl lg:text-left">
				Historial de Carga de Alumnos
			</h2>
			<div className="mt-6 space-y-3">
				{historial.map((h) => (
					<div
						key={h.id}
						className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-slate-200 bg-white px-4 py-3 shadow-sm"
					>
						<span className="font-semibold text-slate-900">
							{formatearFechaMostrar(h.creadoEn)} — {formatearFechaMostrar(h.fechaCierre)}
						</span>
						<button
							type="button"
							onClick={() => void verHistorialCarga(h.id)}
							className="rounded-lg border-2 border-[#7C3AED] bg-[#EDE9FE] px-4 py-1.5 text-sm font-semibold text-[#5B21B6] transition hover:bg-[#DDD6FE]"
						>
							Ver
						</button>
					</div>
				))}
				{historial.length === 0 ? <p className="text-center text-sm text-slate-500">Sin historial.</p> : null}
			</div>
					</section>
				</div>
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
							Creada {formatearFechaMostrar(historialDetalle.carga.creadoEn)}
						</p>
						<div className="mt-4 rounded-xl border border-slate-200 bg-slate-50 px-3 py-3">
							<label className="block text-xs font-semibold text-slate-700" htmlFor="aida-hist-fecha-cierre">
								Fecha de cierre de acceso (alumnos)
							</label>
							<div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center">
								<input
									id="aida-hist-fecha-cierre"
									type="date"
									value={historialFechaDraft}
									onChange={(e) => setHistorialFechaDraft(e.target.value)}
									className="w-full rounded-lg border border-slate-300 bg-white px-3 py-2 text-slate-900 sm:max-w-[11rem]"
								/>
								<button
									type="button"
									disabled={guardandoFechaHistorial}
									onClick={() => void guardarFechaHistorialCarga()}
									className="rounded-lg border border-violet-600 bg-violet-100 px-4 py-2 text-sm font-bold text-violet-900 hover:bg-violet-200 disabled:opacity-50"
								>
									{guardandoFechaHistorial ? "Guardando…" : "Guardar fecha"}
								</button>
							</div>
							<p className="mt-2 text-xs text-slate-600">
								Actualiza el plazo en esta carga y en las claves de los grupos vinculados.
							</p>
						</div>
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

			{lineaEliminarPendiente ? (
				<div className="fixed inset-0 z-[235] flex items-center justify-center bg-black/45 p-4">
					<div className="w-full max-w-md rounded-2xl border border-[#C4B5FD] bg-white p-6 shadow-2xl">
						<h3 className="text-center text-lg font-bold text-slate-900">Confirmar eliminacion</h3>
						<p className="mt-3 text-center text-sm text-slate-700">
							¿Seguro que lo quieres eliminar?
						</p>
						<p className="mt-1 text-center text-sm font-semibold text-slate-900">
							{lineaEliminarPendiente.nombreCompleto}
						</p>
						<div className="mt-5 flex items-center justify-center gap-3">
							<button
								type="button"
								onClick={() => setLineaEliminarPendiente(null)}
								className="rounded-xl border-2 border-[#93C5FD] bg-[#DBEAFE] px-5 py-2 text-sm font-semibold text-[#1E40AF] transition hover:bg-[#BFDBFE]"
							>
								Cancelar
							</button>
							<button
								type="button"
								onClick={() => {
									const id = lineaEliminarPendiente.id;
									setLineaEliminarPendiente(null);
									void eliminarLinea(id);
								}}
								className="rounded-xl border-2 border-[#C4B5FD] bg-[#EDE9FE] px-5 py-2 text-sm font-semibold text-[#5B21B6] transition hover:bg-[#DDD6FE]"
							>
								Eliminar
							</button>
						</div>
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
									onChange={(e) =>
										setNuevoGrupoLetra(
											e.target.value.replace(/[^A-Za-z]/g, "").toUpperCase().slice(0, 1),
										)
									}
									maxLength={1}
									inputMode="text"
									autoComplete="off"
									aria-label="Letra del grupo destino"
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
							className="mt-6 w-full rounded-xl border-2 border-[#7C3AED] bg-[#EDE9FE] py-3 text-base font-bold text-[#5B21B6] transition hover:bg-[#DDD6FE]"
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
								setPreviewMime(null);
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
						{errorMsg.trim() !== "" ? (
							<p className="mx-auto mt-3 max-w-2xl rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-700">
								{errorMsg}
							</p>
						) : null}
						<div className="mt-6 grid gap-6 lg:grid-cols-[minmax(0,1fr)_minmax(0,1.1fr)]">
							<div className="grid gap-4 sm:grid-cols-2">
								{verDocs.documentos.map((doc) => {
									const estadoTarjeta = mensajeEstadoDocumentoEnTarjeta(doc);
									return (
									<div key={doc.tipo} className="rounded-xl border border-slate-200 p-4 shadow-sm">
										<p className="text-center font-bold text-slate-900">{doc.etiqueta}</p>
										<div
											className={`mt-3 rounded-lg border px-3 py-2.5 text-left ${estadoTarjeta.claseFondo} ${estadoTarjeta.claseBorde}`}
											role="status"
											aria-live="polite"
										>
											<p className={`text-sm font-bold ${estadoTarjeta.claseTitulo}`}>
												{estadoTarjeta.titulo}
											</p>
											<p className="mt-1 text-xs leading-snug text-slate-700">{estadoTarjeta.detalle}</p>
										</div>
										<div className="mt-3 flex min-h-[140px] flex-col items-center justify-center rounded-lg border border-slate-200 bg-slate-50 p-3">
											{doc.tieneArchivo ? (
												<button
													type="button"
													onClick={() => void abrirPreview(doc.tipo, doc.etiqueta)}
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
												className="rounded-lg border-2 border-[#C4B5FD] bg-[#EDE9FE] py-2 font-bold text-[#5B21B6] transition hover:bg-[#DDD6FE] disabled:opacity-40"
											>
												✓
											</button>
											<button
												type="button"
												disabled={!verDocs.cuentaId || !doc.tieneArchivo}
												onClick={() => void verificarDoc("rechazar", doc.tipo)}
												className="rounded-lg border-2 border-[#93C5FD] bg-[#DBEAFE] py-2 font-bold text-[#1E40AF] transition hover:bg-[#BFDBFE] disabled:opacity-40"
											>
												✕
											</button>
										</div>
									</div>
									);
								})}
							</div>
							<div ref={previewRef} className="rounded-xl border border-slate-300 bg-slate-100 p-2">
								<p className="mb-2 text-sm font-semibold text-slate-700">
									{previewTitulo || "Vista previa"}
								</p>
								<div className="h-[70vh] w-full overflow-auto rounded-lg border border-slate-200 bg-white">
									{previewCargando ? (
										<p className="p-6 text-center text-sm text-slate-600">Cargando vista previa…</p>
									) : previewUrl && previewMime ? (
										previewMime.startsWith("image/") ? (
											/* eslint-disable-next-line @next/next/no-img-element -- blob URL de vista previa */
											<img
												src={previewUrl}
												alt={previewTitulo}
												className="mx-auto h-full w-auto max-w-full object-contain"
											/>
										) : (
											<iframe
												title={`Vista previa ${previewTitulo}`}
												src={previewUrl}
												className="h-full w-full border-0 bg-white"
											/>
										)
									) : (
										<p className="p-6 text-center text-sm text-slate-500">
											Selecciona un documento para ver su vista previa.
										</p>
									)}
								</div>
							</div>
						</div>
					</div>
				</div>
			) : null}
			{ayudaImportarAbierta
				? createPortal(
						<div
							className="fixed inset-0 z-[260] flex items-center justify-center bg-slate-900/55 p-4"
							onClick={() => setAyudaImportarAbierta(false)}
							role="presentation"
						>
							<div
								className="w-full max-w-md rounded-2xl border-2 border-[#C4B5FD] bg-white p-6 shadow-2xl"
								onClick={(e) => e.stopPropagation()}
								role="dialog"
								aria-modal="true"
								aria-labelledby="titulo-ayuda-importar-excel"
							>
								<h2 id="titulo-ayuda-importar-excel" className="text-lg font-bold text-[#5B21B6]">
									Importar desde Excel
								</h2>
								<p className="mt-4 text-sm leading-relaxed text-slate-700">
									Para poder importar correctamente se debe hacer en una hoja de Excel y poner la columna nombre
									y la columna grupo.
								</p>
								<button
									type="button"
									className="mt-6 w-full rounded-xl border-2 border-[#7C3AED] bg-[#EDE9FE] py-2.5 text-sm font-bold text-[#5B21B6] transition hover:bg-[#DDD6FE]"
									onClick={() => setAyudaImportarAbierta(false)}
								>
									Entendido
								</button>
							</div>
						</div>,
						document.body,
					)
				: null}
		</div>
	);
}
