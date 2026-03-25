"use client";

import Link from "next/link";
import { useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
	IconoBasura,
	IconoCalendario,
	IconoCarpeta,
	IconoDocumento,
	IconoFlechaAtras,
	IconoGuardar,
	IconoLlave,
	IconoMas,
	IconoOjo,
	IconoSubir,
	IconoTabla,
	IconoUsuario,
} from "@/app/alumno/aida-iconos";
import { confirmarAccionDestructiva } from "@/lib/orientador/confirmar-accion-destructiva";
import { alumnoRequiereCarrera } from "@/lib/padron/requiere-carrera";

type GrupoResumen = {
	/** UUID de `grupo_tokens`; null si la sección aún no tiene token. */
	id: string | null;
	/** UUID de `institucion_grupos`; null en tokens huérfanos (sin fila en catálogo). */
	institucionGrupoId: string | null;
	tieneToken: boolean;
	grado: string;
	grupo: string;
	claveAcceso: string;
	fechaLimiteEntrega: string | null;
	creadoEn?: string | null;
	totalAlumnos: number;
	conCuenta: number;
	conExpediente: number;
	/** Grados que aplican a los alumnos (resuelto por fila: padrón o enlace del grupo). */
	gradoResumen: string;
};

type GrupoAlumnoResumen = {
	id: string;
	grupoTokenId: string | null;
	/** Null en token huérfano sin sección en catálogo. */
	institucionGrupoId: string | null;
	grado: string;
	grupo: string;
	claveAcceso: string;
	fechaLimiteEntrega: string | null;
	creadoEn?: string;
	totalAlumnos: number;
	conExpediente: number;
	gradoResumen: string;
	/** Desde 2.° grado: alumnos con carrera asignada en padrón. */
	conCarrera: number;
	/** IDs de carrera presentes en esta fila (grado+grupo+token). */
	carreraIds: string[];
};

type FilaTokenEditable = {
	grupoTexto: string;
	claveAcceso: string;
	/** Vacío = sin fecha límite; si no, YYYY-MM-DD (último día válido del token). */
	fechaLimite: string;
};

type FilaModalToken = {
	id: string;
	grupo: string;
	token: string;
};

type FilaModalPadron = {
	id: string;
	nombre: string;
	grupo: string;
};

type CarreraFiltro = { id: string; codigo: string; nombre: string };

type PeriodoFila = {
	id: string;
	/** nombre_anios o AAAA-AAAA derivado de las fechas de semestre */
	nombrePeriodo: string;
	primerPeriodoFecha?: string | null;
	segundoPeriodoFecha?: string | null;
	actualizadoEn?: string | null;
	gruposAsignados: number;
};

type GrupoEnPeriodo = {
	institucionGrupoId: string;
	grupoTokenId: string | null;
	grupo: string;
	grado: string;
	claveAcceso: string;
};

type AlumnoHistorialPeriodo = {
	padronId: string;
	nombreCompleto: string;
	gradoMostrado: string;
	cuentaId: string | null;
};

type InactivoFila = {
	padronId: string;
	nombreCompleto: string;
	grupoTokenId: string;
	grupoLetra: string;
	gradoMostrado: string;
	carreraNombre: string | null;
	archivoMuertoEn: string;
	cuentaId: string | null;
	tieneCuenta: boolean;
};

const TIPOS_DESCARGA_ORIENTADOR: { tipo: string; etiqueta: string }[] = [
	{ tipo: "acta_nacimiento", etiqueta: "Acta de nacimiento" },
	{ tipo: "curp", etiqueta: "CURP" },
	{ tipo: "ine_tutor", etiqueta: "INE del tutor" },
	{ tipo: "comprobante_domicilio", etiqueta: "Comprobante de domicilio" },
	{ tipo: "certificado_medico", etiqueta: "Certificado médico" },
];

function sinAcentos(texto: string): string {
	return texto.normalize("NFD").replace(/\p{M}/gu, "");
}

/** Búsqueda insensible a mayúsculas y acentos (apellido o nombre, etc.). */
function coincideBusquedaNombre(haystack: string, needle: string): boolean {
	const n = needle.trim();
	if (!n) {
		return true;
	}
	const h = sinAcentos(haystack).toLowerCase();
	const q = sinAcentos(n).toLowerCase();
	return h.includes(q);
}

/** fecha YYYY-MM-DD → texto corto es-MX */
function formatearFechaCorta(iso: string): string {
	if (!iso || !/^\d{4}-\d{2}-\d{2}$/.test(iso)) {
		return iso;
	}
	const [y, m, d] = iso.split("-").map((x) => Number.parseInt(x, 10));
	const dt = new Date(y, m - 1, d);
	return dt.toLocaleDateString("es-MX", { day: "2-digit", month: "2-digit", year: "numeric" });
}

/** Agrupa tokens por su grado estructural (tabla grupo_tokens), no por gradoResumen del padrón (que puede mezclar 1·2). */
function gruposAgrupadosPorGradoToken(grupos: GrupoResumen[]): [string, GrupoResumen[]][] {
	const ordenados = [...grupos].sort((a, b) => {
		const ga = Number.parseInt(String(a.grado), 10) || 0;
		const gb = Number.parseInt(String(b.grado), 10) || 0;
		if (ga !== gb) {
			return ga - gb;
		}
		return String(a.grupo).localeCompare(String(b.grupo), "es");
	});
	const map = new Map<string, GrupoResumen[]>();
	for (const g of ordenados) {
		const k = String(g.grado ?? "").trim() || "sin-grado";
		const arr = map.get(k) ?? [];
		arr.push(g);
		map.set(k, arr);
	}
	return [...map.entries()].sort((a, b) => {
		if (a[0] === "sin-grado") {
			return 1;
		}
		if (b[0] === "sin-grado") {
			return -1;
		}
		return (Number.parseInt(a[0], 10) || 0) - (Number.parseInt(b[0], 10) || 0);
	});
}

function etiquetaOptgroupGradoToken(gradoKey: string): string {
	if (gradoKey === "sin-grado") {
		return "Sin grado en token";
	}
	return `${gradoKey}.° grado`;
}

/** Clave estable para filas de edición (token id o prefijo de sección sin token). */
function claveFilaResumen(g: GrupoResumen): string {
	if (g.id) {
		return g.id;
	}
	if (g.institucionGrupoId) {
		return `ig:${g.institucionGrupoId}`;
	}
	return `ext:${g.grado}:${g.grupo}`;
}

function textoGrupoParaTokenRow(g: GrupoResumen): string {
	if (String(g.grado).trim() === "1") {
		return String(g.grupo).toUpperCase();
	}
	return `${String(g.grado).trim()}${String(g.grupo).toUpperCase()}`;
}

function gradoNumericoResumen(grado: string): number {
	return Number.parseInt(String(grado ?? "").trim(), 10);
}

function descomponerGradoGrupoCliente(valor: string): { grado: string; grupo: string } | null {
	const limpio = valor.trim().replace(/\s+/g, "");
	const soloLetra = /^[a-zA-Z]$/u.exec(limpio);
	if (soloLetra) {
		return { grado: "1", grupo: soloLetra[0].toUpperCase() };
	}
	return null;
}

export default function OrientadorPanelGruposPage() {
	const router = useRouter();
	const [grupos, setGrupos] = useState<GrupoResumen[]>([]);
	const [gruposAlumnos, setGruposAlumnos] = useState<GrupoAlumnoResumen[]>([]);
	/** Tokens existentes (Paso 1: manual o XLSX). Paso 2 solo lista esto, no el catálogo sin token. */
	const gruposConToken = useMemo(
		() => grupos.filter((g) => g.tieneToken && g.id),
		[grupos],
	);

	/** Periodo y archivo: secciones del catálogo (con o sin token). */
	const gruposParaPeriodo = useMemo(
		() => grupos.filter((g) => g.institucionGrupoId),
		[grupos],
	);

	const [cargando, setCargando] = useState(true);
	const [error, setError] = useState("");
	const [nuevoGradoGrupo, setNuevoGradoGrupo] = useState("");
	const [nuevaClaveToken, setNuevaClaveToken] = useState("");
	const [xmlTokenFile, setXmlTokenFile] = useState<File | null>(null);
	const [tokenCargando, setTokenCargando] = useState(false);
	const [tokenError, setTokenError] = useState("");
	const [tokenOk, setTokenOk] = useState("");
	const tokenOkTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
	const [tokenRows, setTokenRows] = useState<Record<string, FilaTokenEditable>>({});

	function cancelarTokenOkTemporal() {
		if (tokenOkTimeoutRef.current !== null) {
			clearTimeout(tokenOkTimeoutRef.current);
			tokenOkTimeoutRef.current = null;
		}
	}

	function mostrarTokenOkTemporal(mensaje: string) {
		cancelarTokenOkTemporal();
		setTokenOk(mensaje);
		tokenOkTimeoutRef.current = setTimeout(() => {
			setTokenOk("");
			tokenOkTimeoutRef.current = null;
		}, 5000);
	}
	const [seccionActiva, setSeccionActiva] = useState<
		"lista_alumnos" | "alumnos" | "carga" | "periodo" | "plantillas"
	>("lista_alumnos");
	const [grupoBajarId, setGrupoBajarId] = useState("");
	const [bajarCargando, setBajarCargando] = useState(false);
	const [bajarMensaje, setBajarMensaje] = useState("");
	const [bajarError, setBajarError] = useState("");

	const [inactivoNombre, setInactivoNombre] = useState("");
	const inactivoNombreRef = useRef(inactivoNombre);
	inactivoNombreRef.current = inactivoNombre;
	const [inactivoGrupoId, setInactivoGrupoId] = useState("");
	const [inactivoCarreraId, setInactivoCarreraId] = useState("");
	const [carrerasFiltro, setCarrerasFiltro] = useState<CarreraFiltro[]>([]);
	const [nuevaCarreraNombre, setNuevaCarreraNombre] = useState("");
	const [carreraNombreEdit, setCarreraNombreEdit] = useState<Record<string, string>>({});
	const [carreraGuardandoId, setCarreraGuardandoId] = useState<string | null>(null);
	const [carreraCreando, setCarreraCreando] = useState(false);
	const [carreraGestionError, setCarreraGestionError] = useState("");
	const [carreraGestionOk, setCarreraGestionOk] = useState("");
	const [periodosLista, setPeriodosLista] = useState<PeriodoFila[]>([]);
	const [periodosCargando, setPeriodosCargando] = useState(false);
	const [periodosError, setPeriodosError] = useState("");
	const [historialModalPeriodo, setHistorialModalPeriodo] = useState<PeriodoFila | null>(null);
	const [historialGrupos, setHistorialGrupos] = useState<GrupoEnPeriodo[]>([]);
	const [historialGrupoSel, setHistorialGrupoSel] = useState("");
	const [historialAlumnos, setHistorialAlumnos] = useState<AlumnoHistorialPeriodo[]>([]);
	const [historialCargandoGrupos, setHistorialCargandoGrupos] = useState(false);
	const [historialCargandoAlumnos, setHistorialCargandoAlumnos] = useState(false);
	const [semestrePrimer, setSemestrePrimer] = useState("");
	const [semestreSegundo, setSemestreSegundo] = useState("");
	const identificadorSemestreAnios = useMemo(() => {
		const p = semestrePrimer.trim();
		const s = semestreSegundo.trim();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(p) || !/^\d{4}-\d{2}-\d{2}$/.test(s)) {
			return null;
		}
		return `${p.slice(0, 4)}-${s.slice(0, 4)}`;
	}, [semestrePrimer, semestreSegundo]);
	const [semestreGuardando, setSemestreGuardando] = useState(false);
	const [semestreMensaje, setSemestreMensaje] = useState("");
	const [semestreError, setSemestreError] = useState("");
	const [periodoGestionSelId, setPeriodoGestionSelId] = useState("");
	const [periodoGestionGrupos, setPeriodoGestionGrupos] = useState<GrupoEnPeriodo[]>([]);
	const [grupoParaAgregarAlPeriodo, setGrupoParaAgregarAlPeriodo] = useState("");
	const [periodoGestionCargando, setPeriodoGestionCargando] = useState(false);
	const [periodoGestionError, setPeriodoGestionError] = useState("");
	const [periodoGestionOk, setPeriodoGestionOk] = useState("");
	const [inactivosLista, setInactivosLista] = useState<InactivoFila[]>([]);
	const [inactivosCargando, setInactivosCargando] = useState(false);
	const [inactivosError, setInactivosError] = useState("");
	const [inactivoDocSel, setInactivoDocSel] = useState<Record<string, string>>({});
	const [reactivarTrabajo, setReactivarTrabajo] = useState<string | null>(null);

	type FilaPlantilla = {
		id: string;
		titulo: string;
		nombre_archivo: string;
		creado_en: string;
	};
	const [plantillasLista, setPlantillasLista] = useState<FilaPlantilla[]>([]);
	const [plantillasCargando, setPlantillasCargando] = useState(false);
	const [plantillasError, setPlantillasError] = useState("");
	const [plantillaTitulo, setPlantillaTitulo] = useState("");
	const [plantillaArchivo, setPlantillaArchivo] = useState<File | null>(null);
	const [plantillaSubiendo, setPlantillaSubiendo] = useState(false);
	const [plantillaOk, setPlantillaOk] = useState("");
	const [modalEscanearAbierto, setModalEscanearAbierto] = useState(false);
	const searchParams = useSearchParams();
	const [xmlPadronFile, setXmlPadronFile] = useState<File | null>(null);
	const [xmlPadronCargando, setXmlPadronCargando] = useState(false);
	const [xmlPadronError, setXmlPadronError] = useState("");
	const [xmlPadronOk, setXmlPadronOk] = useState("");
	const [modalTokensAbierto, setModalTokensAbierto] = useState(false);
	const [filasModalTokens, setFilasModalTokens] = useState<FilaModalToken[]>([]);
	const [modalPadronAbierto, setModalPadronAbierto] = useState(false);
	const [filasModalPadron, setFilasModalPadron] = useState<FilaModalPadron[]>([]);

	const [filtroGrupoLetra, setFiltroGrupoLetra] = useState("");
	const [filtroGrado, setFiltroGrado] = useState("");
	/** Vacío = todas; __sin_carrera__ = filas 2.°+ con alumnos sin carrera; id = al menos un alumno con esa carrera. */
	const [filtroCarreraAlumnosId, setFiltroCarreraAlumnosId] = useState("");
	/** Vacío = todos los periodos; UUID = solo secciones asignadas a ese periodo. */
	const [filtroPeriodoAlumnosId, setFiltroPeriodoAlumnosId] = useState("");
	const [idsIgPeriodoAlumnosFiltro, setIdsIgPeriodoAlumnosFiltro] = useState<Set<string> | null>(null);
	const [cargandoIgPeriodoAlumnosFiltro, setCargandoIgPeriodoAlumnosFiltro] = useState(false);
	/** null = todos; 0–5 = exacto en columna «Con archivo». */
	const [archivoExactoBoton, setArchivoExactoBoton] = useState<number | null>(null);
	const [archivoExactoOtro, setArchivoExactoOtro] = useState("");

	const archivoExactoDeseado = useMemo((): number | null => {
		const o = archivoExactoOtro.trim();
		if (o !== "") {
			if (!/^\d+$/.test(o)) {
				return null;
			}
			return Number.parseInt(o, 10);
		}
		return archivoExactoBoton;
	}, [archivoExactoBoton, archivoExactoOtro]);

	const filtroArchivoOtroInvalido = useMemo(() => {
		const o = archivoExactoOtro.trim();
		return o !== "" && !/^\d+$/.test(o);
	}, [archivoExactoOtro]);

	const gruposAlumnosConAlumnos = useMemo(
		() => gruposAlumnos.filter((g) => g.totalAlumnos > 0),
		[gruposAlumnos],
	);

	const gruposFiltrados = useMemo(() => {
		if (filtroArchivoOtroInvalido) {
			return [];
		}
		return gruposAlumnos.filter((g) => {
			if (g.totalAlumnos <= 0) {
				return false;
			}
			const pid = filtroPeriodoAlumnosId.trim();
			if (pid !== "" && !cargandoIgPeriodoAlumnosFiltro && idsIgPeriodoAlumnosFiltro !== null) {
				const ig = g.institucionGrupoId;
				if (!ig || !idsIgPeriodoAlumnosFiltro.has(ig)) {
					return false;
				}
			}
			const letra = filtroGrupoLetra.trim();
			if (letra && !coincideBusquedaNombre(g.grupo, letra)) {
				return false;
			}
			const grado = filtroGrado.trim();
			if (grado && !coincideBusquedaNombre(g.gradoResumen, grado)) {
				return false;
			}
			const carreraF = filtroCarreraAlumnosId.trim();
			if (carreraF === "__sin_carrera__") {
				if (
					!alumnoRequiereCarrera(g.gradoResumen) ||
					g.totalAlumnos === 0 ||
					g.conCarrera >= g.totalAlumnos
				) {
					return false;
				}
			} else if (carreraF !== "") {
				if (!g.carreraIds.includes(carreraF)) {
					return false;
				}
			}
			if (archivoExactoDeseado !== null && g.conExpediente !== archivoExactoDeseado) {
				return false;
			}
			return true;
		});
	}, [
		gruposAlumnos,
		filtroPeriodoAlumnosId,
		idsIgPeriodoAlumnosFiltro,
		cargandoIgPeriodoAlumnosFiltro,
		filtroGrupoLetra,
		filtroGrado,
		filtroCarreraAlumnosId,
		archivoExactoDeseado,
		filtroArchivoOtroInvalido,
	]);

	/** Filas de la pestaña Alumnos agrupadas por grado escolar (1.° … 6.°). */
	const gruposAlumnosAgrupadosPorGrado = useMemo((): [string, GrupoAlumnoResumen[]][] => {
		const m = new Map<string, GrupoAlumnoResumen[]>();
		for (const g of gruposFiltrados) {
			const k = String(g.grado ?? "").trim() || String(g.gradoResumen ?? "").trim();
			if (!/^\d+$/.test(k)) {
				const otros = m.get("__otros__") ?? [];
				otros.push(g);
				m.set("__otros__", otros);
				continue;
			}
			const arr = m.get(k) ?? [];
			arr.push(g);
			m.set(k, arr);
		}
		const entradas = [...m.entries()].filter(([clave]) => clave !== "__otros__");
		entradas.sort((a, b) => Number.parseInt(a[0], 10) - Number.parseInt(b[0], 10));
		const otros = m.get("__otros__");
		if (otros && otros.length > 0) {
			entradas.push(["__otros__", otros]);
		}
		return entradas;
	}, [gruposFiltrados]);

	const carreraNombrePorId = useMemo(() => {
		const m = new Map<string, string>();
		for (const c of carrerasFiltro) {
			m.set(c.id, c.nombre);
		}
		return m;
	}, [carrerasFiltro]);

	useEffect(() => {
		const next: Record<string, string> = {};
		for (const c of carrerasFiltro) {
			next[c.id] = c.nombre;
		}
		setCarreraNombreEdit(next);
	}, [carrerasFiltro]);

	function limpiarFiltros() {
		setFiltroGrupoLetra("");
		setFiltroGrado("");
		setFiltroCarreraAlumnosId("");
		setFiltroPeriodoAlumnosId("");
		setIdsIgPeriodoAlumnosFiltro(null);
		setArchivoExactoBoton(null);
		setArchivoExactoOtro("");
	}

	function seleccionarArchivoExacto(n: number | null) {
		setArchivoExactoBoton(n);
		setArchivoExactoOtro("");
	}

	async function crearCarrera() {
		const nombre = nuevaCarreraNombre.trim().replace(/\s+/g, " ");
		if (!nombre) {
			setCarreraGestionError("Escribe el nombre de la nueva carrera.");
			return;
		}
		setCarreraCreando(true);
		setCarreraGestionError("");
		setCarreraGestionOk("");
		try {
			const res = await fetch("/api/orientador/carreras", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ nombre }),
			});
			const data = (await res.json()) as { error?: string; carrera?: CarreraFiltro };
			if (!res.ok) {
				setCarreraGestionError(data.error ?? "No se pudo crear la carrera");
				return;
			}
			setCarreraGestionOk(`Carrera creada: ${data.carrera?.nombre ?? nombre}`);
			setNuevaCarreraNombre("");
			await cargarCarrerasCatalogo();
		} catch {
			setCarreraGestionError("Error de red al crear carrera");
		} finally {
			setCarreraCreando(false);
		}
	}

	async function guardarNombreCarrera(carreraId: string) {
		const nombre = (carreraNombreEdit[carreraId] ?? "").trim().replace(/\s+/g, " ");
		if (!nombre) {
			setCarreraGestionError("El nombre de carrera no puede estar vacío.");
			return;
		}
		setCarreraGuardandoId(carreraId);
		setCarreraGestionError("");
		setCarreraGestionOk("");
		try {
			const res = await fetch("/api/orientador/carreras", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ carreraId, nombre }),
			});
			const data = (await res.json()) as { error?: string; carrera?: CarreraFiltro };
			if (!res.ok) {
				setCarreraGestionError(data.error ?? "No se pudo actualizar la carrera");
				return;
			}
			setCarreraGestionOk(`Carrera actualizada: ${data.carrera?.nombre ?? nombre}`);
			await cargarCarrerasCatalogo();
		} catch {
			setCarreraGestionError("Error de red al actualizar carrera");
		} finally {
			setCarreraGuardandoId(null);
		}
	}

	const cargar = useCallback(async () => {
		setCargando(true);
		setError("");
		try {
			const res = await fetch("/api/orientador/grupos", { credentials: "include" });
			const data = (await res.json()) as {
				grupos?: GrupoResumen[];
				gruposAlumnos?: GrupoAlumnoResumen[];
				error?: string;
			};
			if (res.status === 401) {
				router.replace("/orientador");
				return;
			}
			if (!res.ok) {
				setError(data.error ?? "Error al cargar");
				setGrupos([]);
				setGruposAlumnos([]);
				return;
			}
			setGrupos(data.grupos ?? []);
			setGruposAlumnos(data.gruposAlumnos ?? []);
		} catch {
			setError("Error de red");
			setGrupos([]);
			setGruposAlumnos([]);
		} finally {
			setCargando(false);
		}
	}, [router]);

	useEffect(() => {
		void cargar();
	}, [cargar]);

	useEffect(() => {
		if (seccionActiva !== "alumnos") {
			return;
		}
		const pid = filtroPeriodoAlumnosId.trim();
		if (pid === "") {
			setIdsIgPeriodoAlumnosFiltro(null);
			setCargandoIgPeriodoAlumnosFiltro(false);
			return;
		}
		let cancelado = false;
		setCargandoIgPeriodoAlumnosFiltro(true);
		void (async () => {
			try {
				const res = await fetch(`/api/orientador/periodos-academicos/${pid}/grupos`, {
					credentials: "include",
				});
				const d = (await res.json()) as { grupos?: GrupoEnPeriodo[]; error?: string };
				if (cancelado) {
					return;
				}
				if (!res.ok) {
					setIdsIgPeriodoAlumnosFiltro(new Set());
					return;
				}
				const ids = new Set((d.grupos ?? []).map((x) => String(x.institucionGrupoId)));
				setIdsIgPeriodoAlumnosFiltro(ids);
			} catch {
				if (!cancelado) {
					setIdsIgPeriodoAlumnosFiltro(new Set());
				}
			} finally {
				if (!cancelado) {
					setCargandoIgPeriodoAlumnosFiltro(false);
				}
			}
		})();
		return () => {
			cancelado = true;
		};
	}, [seccionActiva, filtroPeriodoAlumnosId]);

	const cargarInactivos = useCallback(async () => {
		setInactivosCargando(true);
		setInactivosError("");
		try {
			const p = new URLSearchParams();
			const nombreQ = inactivoNombreRef.current.trim();
			if (nombreQ) {
				p.set("nombre", nombreQ);
			}
			if (inactivoGrupoId.trim()) {
				p.set("grupoTokenId", inactivoGrupoId.trim());
			}
			if (inactivoCarreraId.trim()) {
				p.set("carreraId", inactivoCarreraId.trim());
			}
			const res = await fetch(`/api/orientador/archivo-muerto/alumnos?${p.toString()}`, {
				credentials: "include",
			});
			const data = (await res.json()) as { alumnos?: InactivoFila[]; error?: string };
			if (res.status === 401) {
				router.replace("/orientador");
				return;
			}
			if (!res.ok) {
				setInactivosError(data.error ?? "Error al cargar");
				setInactivosLista([]);
				return;
			}
			setInactivosLista(data.alumnos ?? []);
		} catch {
			setInactivosError("Error de red");
			setInactivosLista([]);
		} finally {
			setInactivosCargando(false);
		}
	}, [inactivoGrupoId, inactivoCarreraId, router]);

	const cargarCarrerasCatalogo = useCallback(async () => {
		try {
			const r = await fetch("/api/orientador/carreras", { credentials: "include" });
			const d = (await r.json()) as { carreras?: CarreraFiltro[] };
			if (r.ok) {
				setCarrerasFiltro(d.carreras ?? []);
			}
		} catch {
			setCarrerasFiltro([]);
		}
	}, []);

	const cargarPeriodosLista = useCallback(async () => {
		setPeriodosCargando(true);
		setPeriodosError("");
		try {
			const res = await fetch("/api/orientador/periodos-academicos", { credentials: "include" });
			const d = (await res.json()) as { periodos?: PeriodoFila[]; error?: string };
			if (!res.ok) {
				setPeriodosError(d.error ?? "No se pudieron cargar los periodos");
				setPeriodosLista([]);
				return;
			}
			setPeriodosLista(d.periodos ?? []);
		} catch {
			setPeriodosError("Error de red");
			setPeriodosLista([]);
		} finally {
			setPeriodosCargando(false);
		}
	}, []);

	const cargarSemestreFechas = useCallback(async () => {
		setSemestreError("");
		try {
			const res = await fetch("/api/orientador/semestre-fechas", { credentials: "include" });
			const d = (await res.json()) as {
				primerPeriodoFecha?: string | null;
				segundoPeriodoFecha?: string | null;
				nombrePeriodoAnios?: string | null;
				error?: string;
			};
			if (!res.ok) {
				setSemestreError(d.error ?? "No se pudieron leer las fechas de semestre");
				return;
			}
			setSemestrePrimer(d.primerPeriodoFecha ?? "");
			setSemestreSegundo(d.segundoPeriodoFecha ?? "");
		} catch {
			setSemestreError("Error de red");
		}
	}, []);

	async function guardarSemestreFechas() {
		setSemestreGuardando(true);
		setSemestreError("");
		try {
			const res = await fetch("/api/orientador/semestre-fechas", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					primerPeriodoFecha: semestrePrimer.trim() || null,
					segundoPeriodoFecha: semestreSegundo.trim() || null,
				}),
			});
			const d = (await res.json()) as {
				error?: string;
				nombrePeriodoAnios?: string | null;
				nuevoCicloSemestre?: boolean;
			};
			if (!res.ok) {
				setSemestreMensaje("");
				setSemestreError(d.error ?? "No se pudo guardar");
				return;
			}
			if (d.nuevoCicloSemestre && d.nombrePeriodoAnios) {
				setSemestreMensaje(
					`Nuevo periodo «${d.nombrePeriodoAnios}» creado en la base de datos. El anterior (otro nombre AAAA-AAAA) se conserva; sus grupos siguen ligados a ese registro.`,
				);
			} else {
				setSemestreMensaje(
					d.nombrePeriodoAnios
						? `Guardado en la base de datos. Periodo «${d.nombrePeriodoAnios}» (años de cada fecha).`
						: "Guardado en la base de datos. Cuando indiques las dos fechas, el nombre será AAAA-AAAA según cada año.",
				);
			}
			await cargarSemestreFechas();
			await cargarPeriodosLista();
		} catch {
			setSemestreMensaje("");
			setSemestreError("Error de red");
		} finally {
			setSemestreGuardando(false);
		}
	}

	async function agregarGrupoAlPeriodoSeleccionado() {
		const pid = periodoGestionSelId.trim();
		const gid = grupoParaAgregarAlPeriodo.trim();
		if (!pid) {
			setPeriodoGestionError("Elige el periodo (nombre del ciclo de semestre guardado arriba).");
			return;
		}
		if (!gid) {
			setPeriodoGestionError("Elige un grupo para agregar.");
			return;
		}
		setPeriodoGestionCargando(true);
		setPeriodoGestionError("");
		setPeriodoGestionOk("");
		try {
			const res = await fetch(`/api/orientador/periodos-academicos/${pid}/grupos`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ institucionGrupoId: gid }),
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setPeriodoGestionError(d.error ?? "No se pudo agregar el grupo");
				return;
			}
			setPeriodoGestionOk("Grupo agregado al periodo.");
			setGrupoParaAgregarAlPeriodo("");
			const resG = await fetch(`/api/orientador/periodos-academicos/${pid}/grupos`, {
				credentials: "include",
			});
			const dg = (await resG.json()) as { grupos?: GrupoEnPeriodo[] };
			setPeriodoGestionGrupos(dg.grupos ?? []);
			await cargarPeriodosLista();
		} catch {
			setPeriodoGestionError("Error de red");
		} finally {
			setPeriodoGestionCargando(false);
		}
	}

	async function quitarGrupoDelPeriodoSeleccionado(institucionGrupoId: string) {
		const pid = periodoGestionSelId.trim();
		if (!pid) {
			return;
		}
		setPeriodoGestionCargando(true);
		setPeriodoGestionError("");
		try {
			const res = await fetch(`/api/orientador/periodos-academicos/${pid}/grupos`, {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ institucionGrupoId }),
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setPeriodoGestionError(d.error ?? "No se pudo quitar el grupo");
				return;
			}
			setPeriodoGestionGrupos((prev) => prev.filter((g) => g.institucionGrupoId !== institucionGrupoId));
			await cargarPeriodosLista();
		} catch {
			setPeriodoGestionError("Error de red");
		} finally {
			setPeriodoGestionCargando(false);
		}
	}

	async function abrirHistorialPeriodo(p: PeriodoFila) {
		setHistorialModalPeriodo(p);
		setHistorialCargandoGrupos(true);
		setHistorialGrupos([]);
		setHistorialGrupoSel("");
		setHistorialAlumnos([]);
		try {
			const res = await fetch(`/api/orientador/periodos-academicos/${p.id}/grupos`, {
				credentials: "include",
			});
			const d = (await res.json()) as { grupos?: GrupoEnPeriodo[]; error?: string };
			if (!res.ok) {
				setHistorialGrupos([]);
				return;
			}
			const g = d.grupos ?? [];
			setHistorialGrupos(g);
			setHistorialGrupoSel(g[0]?.institucionGrupoId ?? "");
		} catch {
			setHistorialGrupos([]);
		} finally {
			setHistorialCargandoGrupos(false);
		}
	}

	useEffect(() => {
		if (!historialModalPeriodo || historialGrupoSel === "") {
			setHistorialAlumnos([]);
			return;
		}
		let cancelado = false;
		void (async () => {
			setHistorialCargandoAlumnos(true);
			try {
				const res = await fetch(
					`/api/orientador/periodos-academicos/${historialModalPeriodo.id}/alumnos?institucionGrupoId=${encodeURIComponent(historialGrupoSel)}`,
					{ credentials: "include" },
				);
				const d = (await res.json()) as { alumnos?: AlumnoHistorialPeriodo[] };
				if (!cancelado) {
					setHistorialAlumnos(d.alumnos ?? []);
				}
			} catch {
				if (!cancelado) {
					setHistorialAlumnos([]);
				}
			} finally {
				if (!cancelado) {
					setHistorialCargandoAlumnos(false);
				}
			}
		})();
		return () => {
			cancelado = true;
		};
	}, [historialModalPeriodo, historialGrupoSel]);

	useEffect(() => {
		if (seccionActiva !== "periodo" || periodoGestionSelId === "") {
			if (seccionActiva !== "periodo") {
				setPeriodoGestionGrupos([]);
			}
			return;
		}
		let cancelado = false;
		void (async () => {
			setPeriodoGestionCargando(true);
			setPeriodoGestionError("");
			try {
				const res = await fetch(`/api/orientador/periodos-academicos/${periodoGestionSelId}/grupos`, {
					credentials: "include",
				});
				const d = (await res.json()) as { grupos?: GrupoEnPeriodo[]; error?: string };
				if (!cancelado) {
					if (!res.ok) {
						setPeriodoGestionError(d.error ?? "No se pudieron cargar los grupos");
						setPeriodoGestionGrupos([]);
					} else {
						setPeriodoGestionGrupos(d.grupos ?? []);
					}
				}
			} catch {
				if (!cancelado) {
					setPeriodoGestionGrupos([]);
					setPeriodoGestionError("Error de red");
				}
			} finally {
				if (!cancelado) {
					setPeriodoGestionCargando(false);
				}
			}
		})();
		return () => {
			cancelado = true;
		};
	}, [seccionActiva, periodoGestionSelId]);

	useEffect(() => {
		if (seccionActiva !== "carga" && seccionActiva !== "periodo" && seccionActiva !== "alumnos") {
			return;
		}
		void cargarPeriodosLista();
	}, [seccionActiva, cargarPeriodosLista]);

	useEffect(() => {
		if (seccionActiva !== "periodo" && seccionActiva !== "carga") {
			return;
		}
		if (periodosCargando) {
			return;
		}
		if (periodosLista.length === 0) {
			if (periodoGestionSelId) {
				setPeriodoGestionSelId("");
			}
			return;
		}
		const ids = new Set(periodosLista.map((p) => p.id));
		if (periodoGestionSelId && !ids.has(periodoGestionSelId)) {
			setPeriodoGestionSelId(periodosLista[0].id);
			return;
		}
		if (!periodoGestionSelId && periodosLista.length === 1) {
			setPeriodoGestionSelId(periodosLista[0].id);
		}
	}, [seccionActiva, periodosLista, periodoGestionSelId, periodosCargando]);

	useEffect(() => {
		if (seccionActiva !== "periodo") {
			return;
		}
		void cargarSemestreFechas();
	}, [seccionActiva, cargarSemestreFechas]);

	useEffect(() => {
		if (
			seccionActiva !== "lista_alumnos" &&
			seccionActiva !== "alumnos" &&
			seccionActiva !== "carga" &&
			seccionActiva !== "periodo"
		) {
			return;
		}
		void cargarCarrerasCatalogo();
	}, [seccionActiva, cargarCarrerasCatalogo]);

	useEffect(() => {
		if (seccionActiva !== "carga") {
			return;
		}
		void cargarInactivos();
	}, [seccionActiva, inactivoGrupoId, inactivoCarreraId, cargarInactivos]);

	const cargarPlantillas = useCallback(async () => {
		setPlantillasCargando(true);
		setPlantillasError("");
		try {
			const res = await fetch("/api/orientador/plantillas", { credentials: "include" });
			const data = (await res.json()) as {
				plantillas?: FilaPlantilla[];
				error?: string;
			};
			if (res.status === 401) {
				router.replace("/orientador");
				return;
			}
			if (!res.ok) {
				setPlantillasError(data.error ?? "Error al cargar plantillas");
				setPlantillasLista([]);
				return;
			}
			setPlantillasLista(data.plantillas ?? []);
		} catch {
			setPlantillasError("Error de red");
			setPlantillasLista([]);
		} finally {
			setPlantillasCargando(false);
		}
	}, [router]);

	useEffect(() => {
		if (seccionActiva !== "plantillas") {
			return;
		}
		void cargarPlantillas();
	}, [seccionActiva, cargarPlantillas]);

	useEffect(() => {
		const s = searchParams.get("seccion");
		if (
			s === "lista_alumnos" ||
			s === "alumnos" ||
			s === "carga" ||
			s === "periodo" ||
			s === "plantillas"
		) {
			setSeccionActiva(s);
		}
	}, [searchParams]);

	useEffect(() => {
		return () => {
			cancelarTokenOkTemporal();
		};
	}, []);

	useEffect(() => {
		if (!modalTokensAbierto && !modalPadronAbierto) {
			return;
		}
		function onEscape(e: KeyboardEvent) {
			if (e.key === "Escape") {
				setModalTokensAbierto(false);
				setModalPadronAbierto(false);
			}
		}
		window.addEventListener("keydown", onEscape);
		return () => window.removeEventListener("keydown", onEscape);
	}, [modalTokensAbierto, modalPadronAbierto]);

	useEffect(() => {
		setTokenRows((prev) => {
			const next: Record<string, FilaTokenEditable> = {};
			for (const g of grupos) {
				const k = claveFilaResumen(g);
				const grupoTextoInicial = g.tieneToken && g.id ? textoGrupoParaTokenRow(g) : g.grupo.toUpperCase();
				next[k] = prev[k] ?? {
					grupoTexto: grupoTextoInicial,
					claveAcceso: g.claveAcceso,
					fechaLimite: g.fechaLimiteEntrega ? g.fechaLimiteEntrega.slice(0, 10) : "",
				};
			}
			return next;
		});
	}, [grupos]);

	async function importarPadronXml() {
		if (!xmlPadronFile) {
			setXmlPadronError("Selecciona un archivo .xlsx");
			setXmlPadronOk("");
			return;
		}
		setXmlPadronCargando(true);
		setXmlPadronError("");
		setXmlPadronOk("");
		try {
			const form = new FormData();
			form.append("archivo", xmlPadronFile);
			const res = await fetch("/api/orientador/importar-alumnos-xml", {
				method: "POST",
				credentials: "include",
				body: form,
			});
			const data = (await res.json()) as {
				error?: string;
				resumen?: {
					filasDetectadas: number;
					filasRelacionadas: number;
					filasGuardadas: number;
					filasSinGrupo: number;
				};
			};
			if (!res.ok) {
				setXmlPadronError(data.error ?? "No se pudo importar el XLSX");
				return;
			}
			const r = data.resumen;
			setXmlPadronOk(
				r
					? `XLSX procesado: detectadas ${r.filasDetectadas}, relacionadas ${r.filasRelacionadas}, guardadas ${r.filasGuardadas}, sin grupo ${r.filasSinGrupo}.`
					: "XLSX importado correctamente.",
			);
			setXmlPadronFile(null);
			const input = document.getElementById("xml-padron-file") as HTMLInputElement | null;
			if (input) {
				input.value = "";
			}
			await cargar();
		} catch {
			setXmlPadronError("Error de red al importar XLSX");
		} finally {
			setXmlPadronCargando(false);
		}
	}

	async function crearTokenGrupo() {
		const gg = descomponerGradoGrupoCliente(nuevoGradoGrupo);
		if (!gg) {
			setTokenError("Formato inválido. Solo 1.°: escribe una letra (A, B, C…).");
			cancelarTokenOkTemporal();
			setTokenOk("");
			return;
		}
		if (!nuevaClaveToken.trim()) {
			setTokenError("El token es obligatorio para crear el grupo.");
			cancelarTokenOkTemporal();
			setTokenOk("");
			return;
		}
		setTokenCargando(true);
		setTokenError("");
		cancelarTokenOkTemporal();
		setTokenOk("");
		try {
			const res = await fetch("/api/orientador/grupo-token", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					grado: gg.grado,
					grupo: gg.grupo,
					claveAcceso: nuevaClaveToken.trim(),
				}),
			});
			const data = (await res.json()) as { error?: string; claveAcceso?: string };
			if (!res.ok) {
				setTokenError(data.error ?? "No se pudo crear el token");
				return;
			}
			mostrarTokenOkTemporal(`Token creado: ${data.claveAcceso ?? "OK"}`);
			setNuevoGradoGrupo("");
			setNuevaClaveToken("");
			await cargar();
		} catch {
			setTokenError("Error de red al crear token");
		} finally {
			setTokenCargando(false);
		}
	}

	async function guardarTokenGrupo(id: string) {
		const row = tokenRows[id];
		if (!row) {
			return;
		}
		setTokenCargando(true);
		setTokenError("");
		cancelarTokenOkTemporal();
		setTokenOk("");
		try {
			const res = await fetch("/api/orientador/grupo-token", {
				method: "PUT",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					id,
					grupoTexto: row.grupoTexto,
					claveAcceso: row.claveAcceso,
				}),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setTokenError(data.error ?? "No se pudo actualizar el token");
				return;
			}
			const fechaTxt = (row.fechaLimite ?? "").trim();
			const resFecha = await fetch("/api/orientador/grupo-fecha-limite", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					grupoTokenId: id,
					fechaLimiteEntrega: fechaTxt === "" ? null : fechaTxt,
				}),
			});
			const dataFecha = (await resFecha.json()) as { error?: string };
			if (!resFecha.ok) {
				setTokenError(
					dataFecha.error ??
						"El token se guardó, pero no la fecha límite. Revisa el formato (YYYY-MM-DD) o inténtalo de nuevo.",
				);
				await cargar();
				return;
			}
			mostrarTokenOkTemporal(
				`Guardado: ${row.grupoTexto.toUpperCase()}${fechaTxt ? ` · cierre ${fechaTxt}` : " · sin fecha límite"}.`,
			);
			await cargar();
		} catch {
			setTokenError("Error de red al guardar token");
		} finally {
			setTokenCargando(false);
		}
	}

	async function eliminarTokenGrupo(id: string, claveAcceso: string) {
		const refToken = claveAcceso.trim() || "este token";
		const ok = confirmarAccionDestructiva(
			`Vas a eliminar el token / clave «${refToken}» y todo su padrón de alumnos asociado. Es una acción fuerte.`,
		);
		if (!ok) {
			return;
		}
		setTokenCargando(true);
		setTokenError("");
		cancelarTokenOkTemporal();
		setTokenOk("");
		try {
			const res = await fetch("/api/orientador/grupo-token", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ id }),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setTokenError(data.error ?? "No se pudo eliminar el token");
				return;
			}
			mostrarTokenOkTemporal(`Token ${refToken} eliminado.`);
			await cargar();
		} catch {
			setTokenError("Error de red al eliminar token");
		} finally {
			setTokenCargando(false);
		}
	}

	function abrirModalTokens() {
		setFilasModalTokens([{ id: crypto.randomUUID(), grupo: "", token: "" }]);
		setTokenError("");
		setModalTokensAbierto(true);
	}

	function agregarFilaModalToken() {
		setFilasModalTokens((prev) => [...prev, { id: crypto.randomUUID(), grupo: "", token: "" }]);
	}

	function quitarFilaModalToken(id: string) {
		setFilasModalTokens((prev) => (prev.length <= 1 ? prev : prev.filter((f) => f.id !== id)));
	}

	async function enviarModalTokens() {
		setTokenCargando(true);
		setTokenError("");
		cancelarTokenOkTemporal();
		setTokenOk("");
		try {
			const res = await fetch("/api/orientador/grupo-token/lote", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					filas: filasModalTokens.map((f) => ({ grupo: f.grupo, token: f.token })),
				}),
			});
			const data = (await res.json()) as {
				error?: string;
				guardadas?: number;
				omitidas?: number;
			};
			if (!res.ok) {
				setTokenError(data.error ?? "No se pudo enviar la tabla");
				return;
			}
			mostrarTokenOkTemporal(
				`Tabla enviada: ${data.guardadas ?? 0} fila(s) guardada(s).` +
					(data.omitidas ? ` Omitidas: ${data.omitidas}.` : ""),
			);
			setModalTokensAbierto(false);
			await cargar();
		} catch {
			setTokenError("Error de red al enviar la tabla");
		} finally {
			setTokenCargando(false);
		}
	}

	function abrirModalPadron() {
		setFilasModalPadron([{ id: crypto.randomUUID(), nombre: "", grupo: "" }]);
		setXmlPadronError("");
		setModalPadronAbierto(true);
	}

	function agregarFilaModalPadron() {
		setFilasModalPadron((prev) => [...prev, { id: crypto.randomUUID(), nombre: "", grupo: "" }]);
	}

	function quitarFilaModalPadron(id: string) {
		setFilasModalPadron((prev) => (prev.length <= 1 ? prev : prev.filter((f) => f.id !== id)));
	}

	async function enviarModalPadron() {
		setXmlPadronCargando(true);
		setXmlPadronError("");
		setXmlPadronOk("");
		try {
			const res = await fetch("/api/orientador/importar-alumnos-lote", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					filas: filasModalPadron.map((f) => ({
						nombreCompleto: f.nombre,
						grupo: f.grupo,
					})),
				}),
			});
			const data = (await res.json()) as {
				error?: string;
				resumen?: {
					recibidas: number;
					guardadas: number;
					omitidas: number;
					sinGrupoCoincidente: number;
				};
			};
			if (!res.ok) {
				setXmlPadronError(data.error ?? "No se pudo enviar la tabla");
				return;
			}
			const r = data.resumen;
			setXmlPadronOk(
				r
					? `Padrón: ${r.guardadas} guardada(s). Omitidas: ${r.omitidas}. Sin grupo coincidente: ${r.sinGrupoCoincidente}.`
					: "Padrón actualizado.",
			);
			setModalPadronAbierto(false);
			await cargar();
		} catch {
			setXmlPadronError("Error de red al enviar la tabla");
		} finally {
			setXmlPadronCargando(false);
		}
	}

	async function importarTokensXml() {
		if (!xmlTokenFile) {
			setTokenError("Selecciona un XLSX de tokens");
			cancelarTokenOkTemporal();
			setTokenOk("");
			return;
		}
		setTokenCargando(true);
		setTokenError("");
		cancelarTokenOkTemporal();
		setTokenOk("");
		try {
			const form = new FormData();
			form.append("archivo", xmlTokenFile);
			const res = await fetch("/api/orientador/grupo-token/importar-xml", {
				method: "POST",
				credentials: "include",
				body: form,
			});
			const data = (await res.json()) as { error?: string; filas?: number };
			if (!res.ok) {
				setTokenError(data.error ?? "No se pudo importar el XLSX de tokens");
				return;
			}
			mostrarTokenOkTemporal(`XLSX importado: ${data.filas ?? 0} token(s).`);
			setXmlTokenFile(null);
			const input = document.getElementById("xml-token-file") as HTMLInputElement | null;
			if (input) {
				input.value = "";
			}
			await cargar();
		} catch {
			setTokenError("Error de red al importar tokens XLSX");
		} finally {
			setTokenCargando(false);
		}
	}

	async function archivarGrupoABajar() {
		if (!grupoBajarId.trim()) {
			setBajarError("Elige un grupo.");
			return;
		}
		if (
			!confirmarAccionDestructiva(
				"Vas a enviar a archivo muerto a todos los alumnos activos de este grupo. Los datos se conservan, pero dejarán de verse en listas activas y ninguno podrá entrar hasta reactivar uno a uno desde Inactivos.",
			)
		) {
			return;
		}
		setBajarCargando(true);
		setBajarError("");
		setBajarMensaje("");
		try {
			const res = await fetch("/api/orientador/archivo-muerto/archivar", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ grupoTokenId: grupoBajarId.trim() }),
			});
			const d = (await res.json()) as { error?: string; archivados?: number };
			if (!res.ok) {
				setBajarError(d.error ?? "No se pudo archivar");
				return;
			}
			setBajarMensaje(`Listo: ${d.archivados ?? 0} expediente(s) en archivo muerto.`);
			await cargar();
		} catch {
			setBajarError("Error de red");
		} finally {
			setBajarCargando(false);
		}
	}

	async function reactivarInactivo(padronId: string) {
		setReactivarTrabajo(padronId);
		setInactivosError("");
		try {
			const res = await fetch("/api/orientador/archivo-muerto/reactivar", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ padronId }),
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setInactivosError(d.error ?? "No se pudo reactivar");
				return;
			}
			await cargarInactivos();
			await cargar();
		} catch {
			setInactivosError("Error de red");
		} finally {
			setReactivarTrabajo(null);
		}
	}

	async function subirPlantillaMuro(opciones?: { redirectWizard?: boolean }) {
		if (!plantillaArchivo || plantillaArchivo.size === 0) {
			setPlantillasError("Selecciona un PDF.");
			return;
		}
		setPlantillaSubiendo(true);
		setPlantillasError("");
		setPlantillaOk("");
		try {
			const fd = new FormData();
			fd.set("archivo", plantillaArchivo);
			if (plantillaTitulo.trim()) {
				fd.set("titulo", plantillaTitulo.trim());
			}
			const res = await fetch("/api/orientador/plantillas", {
				method: "POST",
				body: fd,
				credentials: "include",
			});
			const d = (await res.json()) as { error?: string; titulo?: string; id?: string };
			if (!res.ok) {
				setPlantillasError(d.error ?? "No se pudo subir");
				return;
			}
			if (opciones?.redirectWizard && d.id) {
				setModalEscanearAbierto(false);
				setPlantillaArchivo(null);
				setPlantillaTitulo("");
				const input = document.getElementById("plantilla-pdf-file-modal") as HTMLInputElement | null;
				if (input) {
					input.value = "";
				}
				const input2 = document.getElementById("plantilla-pdf-file") as HTMLInputElement | null;
				if (input2) {
					input2.value = "";
				}
				router.push(`/orientador/panel/plantillas/${d.id}/editar?wizard=1`);
				await cargarPlantillas();
				return;
			}
			setPlantillaOk(`Plantilla «${d.titulo ?? "sin título"}» publicada.`);
			setPlantillaArchivo(null);
			setPlantillaTitulo("");
			const input = document.getElementById("plantilla-pdf-file") as HTMLInputElement | null;
			if (input) {
				input.value = "";
			}
			await cargarPlantillas();
		} catch {
			setPlantillasError("Error de red");
		} finally {
			setPlantillaSubiendo(false);
		}
	}

	async function eliminarPlantillaMuro(id: string, etiqueta: string) {
		if (
			!confirmarAccionDestructiva(
				`Vas a quitar del muro la plantilla «${etiqueta}» y su PDF en almacenamiento. El resto de orientadores dejará de verla.`,
			)
		) {
			return;
		}
		setPlantillasError("");
		try {
			const res = await fetch(`/api/orientador/plantillas/${id}`, {
				method: "DELETE",
				credentials: "include",
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setPlantillasError(d.error ?? "No se pudo eliminar");
				return;
			}
			await cargarPlantillas();
		} catch {
			setPlantillasError("Error de red");
		}
	}

	return (
		<div>
			<div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
			</div>
			<div className="mx-auto mt-3 flex max-w-6xl justify-center px-4 sm:px-6">
				<div className="w-full rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-2 shadow-sm sm:w-fit">
					<div className="flex flex-wrap items-center justify-center gap-2">
						<button
							type="button"
							onClick={() => setSeccionActiva("lista_alumnos")}
							className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
								seccionActiva === "lista_alumnos"
									? "border-transparent bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white shadow-md shadow-[#2563EB]/25"
									: "border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B] hover:border-[#DBEAFE] hover:bg-[#EFF6FF]"
							}`}
						>
							<IconoTabla className="h-4 w-4 shrink-0 opacity-90" />
							Lista Alumnos
						</button>
						<button
							type="button"
							onClick={() => setSeccionActiva("alumnos")}
							className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
								seccionActiva === "alumnos"
									? "border-transparent bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white shadow-md shadow-[#2563EB]/25"
									: "border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B] hover:border-[#DBEAFE] hover:bg-[#EFF6FF]"
							}`}
						>
							<IconoUsuario className="h-4 w-4 shrink-0 opacity-90" />
							Alumnos
						</button>
						<button
							type="button"
							onClick={() => setSeccionActiva("carga")}
							className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
								seccionActiva === "carga"
									? "border-transparent bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white shadow-md shadow-[#2563EB]/25"
									: "border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B] hover:border-[#DBEAFE] hover:bg-[#EFF6FF]"
							}`}
						>
							<IconoSubir className="h-4 w-4 shrink-0 opacity-90" />
							Carga
						</button>
						<button
							type="button"
							onClick={() => setSeccionActiva("periodo")}
							className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
								seccionActiva === "periodo"
									? "border-transparent bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white shadow-md shadow-[#2563EB]/25"
									: "border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B] hover:border-[#DBEAFE] hover:bg-[#EFF6FF]"
							}`}
						>
							<IconoCalendario className="h-4 w-4 shrink-0 opacity-90" />
							Periodo
						</button>
						<button
							type="button"
							onClick={() => setSeccionActiva("plantillas")}
							className={`inline-flex items-center gap-2 rounded-lg border px-3 py-1.5 text-sm font-semibold transition ${
								seccionActiva === "plantillas"
									? "border-transparent bg-gradient-to-r from-[#2563EB] to-[#7C3AED] text-white shadow-md shadow-[#2563EB]/25"
									: "border-[#E2E8F0] bg-[#F8FAFC] text-[#1E293B] hover:border-[#DBEAFE] hover:bg-[#EFF6FF]"
							}`}
						>
							<IconoDocumento className="h-4 w-4 shrink-0 opacity-90" />
							Muro de plantillas
						</button>
					</div>
				</div>
			</div>

			{seccionActiva === "lista_alumnos" ? (
				<>
					<div className="mt-5 rounded-2xl border border-[#E2E8F0] bg-gradient-to-br from-[#FFFFFF] via-[#F8FAFC] to-[#EFF6FF] p-3 shadow-lg shadow-[#2563EB]/[0.07] sm:p-5">
						<div className="flex flex-col gap-3">
							<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
								<div className="flex gap-3">
									<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#2563EB] to-[#7C3AED] text-white shadow-md shadow-[#2563EB]/30">
										<IconoLlave className="h-6 w-6" />
									</div>
									<div>
										<p className="bg-gradient-to-r from-[#2563EB] to-[#7C3AED] bg-clip-text text-[11px] font-bold uppercase tracking-wide text-transparent">
											Control de acceso
										</p>
										<h2 className="text-base font-bold text-[#1E293B]">Tokens de grupo</h2>

									</div>
								</div>
							</div>
							<div className="grid gap-3 lg:grid-cols-2">
								<div className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-3 shadow-sm">
									<p className="mb-2 flex items-center gap-2 text-xs font-bold text-[#1E293B]">
										<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]">
											<IconoMas className="h-4 w-4" />
										</span>
										Paso 1: Agregar token manual
									</p>
									<div className="flex flex-wrap items-center gap-2">
										<input
											type="text"
											placeholder="Letra (1.°)"
											maxLength={1}
											value={nuevoGradoGrupo}
											onChange={(e) =>
												setNuevoGradoGrupo(e.target.value.toUpperCase().replace(/\s+/g, "").slice(0, 1))
											}
											className="w-28 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-sm text-[#1E293B] outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#DBEAFE]"
										/>
										<input
											type="text"
											placeholder="Token (obligatorio)"
											value={nuevaClaveToken}
											onChange={(e) => setNuevaClaveToken(e.target.value.toUpperCase())}
											className="w-40 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-sm text-[#1E293B] outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#DBEAFE]"
										/>
										<button
											type="button"
											onClick={() => void crearTokenGrupo()}
											disabled={tokenCargando}
											className="inline-flex items-center gap-1.5 rounded-lg border border-[#2563EB] bg-[#2563EB] px-3 py-1.5 text-sm font-semibold text-white shadow-md shadow-[#2563EB]/25 transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
										>
											<IconoMas className="h-4 w-4" />
											Agregar
										</button>
									</div>
								</div>
								<div className="rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-3 shadow-sm">
									<p className="mb-2 flex items-center gap-2 text-xs font-bold text-[#1E293B]">
										<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F5F3FF] text-[#7C3AED]">
											<IconoDocumento className="h-4 w-4" />
										</span>
										(opcional): Importar XLSX
									</p>
									<div className="flex flex-wrap items-center gap-2">
										<label htmlFor="xml-token-file" className="sr-only">
											Archivo XLSX de tokens
										</label>
										<input
											id="xml-token-file"
											type="file"
											accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
											onChange={(e) => setXmlTokenFile(e.target.files?.[0] ?? null)}
											className="block w-full max-w-md rounded-lg border border-[#93C5FD] border-dashed bg-[#EFF6FF]/80 px-3 py-2 text-sm text-[#1E293B] file:mr-3 file:rounded-lg file:border-0 file:bg-[#2563EB] file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white hover:file:bg-[#1D4ED8]"
										/>
										<button
											type="button"
											onClick={() => void importarTokensXml()}
											disabled={tokenCargando}
											className="inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-1.5 text-sm font-semibold text-[#1E293B] transition hover:border-[#CBD5E1] hover:bg-white disabled:cursor-not-allowed disabled:opacity-60"
										>
											<IconoSubir className="h-4 w-4 text-[#2563EB]" />
											Importar XLSX
										</button>
										<button
											type="button"
											onClick={abrirModalTokens}
											disabled={tokenCargando}
											className="inline-flex items-center gap-1.5 rounded-lg border border-[#C4B5FD] bg-[#F5F3FF] px-3 py-1.5 text-sm font-semibold text-[#6D28D9] transition hover:border-[#A78BFA] hover:bg-[#EDE9FE] disabled:cursor-not-allowed disabled:opacity-60"
										>
											<IconoTabla className="h-4 w-4" />
											Tabla
										</button>
									</div>
									<p className="mt-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1.5 text-[11px] text-[#64748B]">
										Columnas esperadas: <strong>grupo</strong> (solo letra de <strong>1.°</strong>) y{" "}
										<strong>token</strong> (o <strong>clave</strong>). En 2.°–6.° no hay token de acceso.
									</p>
								</div>
							</div>
						</div>
						{tokenError ? (
							<p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
								{tokenError}
							</p>
						) : null}
						{tokenOk ? (
							<p className="mt-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900">
								{tokenOk}
							</p>
						) : null}
						<div className="mt-4 overflow-x-auto rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-sm">
							<div className="flex items-start gap-2 border-b border-[#E2E8F0] bg-gradient-to-r from-[#EFF6FF] to-[#F5F3FF]/80 px-3 py-2.5 text-xs font-medium text-[#64748B]">
								<IconoTabla className="mt-0.5 h-4 w-4 shrink-0 text-[#2563EB]" />
								<span>
									<strong className="text-[#1E293B]">Paso 2:</strong> Solo <strong>1.°</strong> usa token de acceso.
									Las secciones de 2.°–6.° no aparecen aquí (no llevan token). Si ves una fila de 2.°–6.° con
									clave, es un registro antiguo: usa <strong>Eliminar</strong>.
								</span>
							</div>
							<table className="w-full min-w-[720px] text-left text-sm">
								<thead className="bg-[#F8FAFC] text-[#64748B]">
									<tr>
										<th className="px-3 py-2.5 font-semibold text-[#1E293B]">Grado</th>
										<th className="px-3 py-2.5 font-semibold text-[#1E293B]">Grupo</th>
										<th className="px-3 py-2.5 font-semibold text-[#1E293B]">Token de acceso</th>
										<th className="px-3 py-2.5 font-semibold text-[#1E293B]">Fecha límite</th>
										<th className="px-3 py-2.5 font-semibold text-[#1E293B]">Acciones</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-[#E2E8F0] bg-[#FFFFFF]">
									{gruposConToken.length === 0 ? (
										<tr>
											<td colSpan={5} className="px-3 py-6 text-center text-sm text-[#64748B]">
												Aún no hay tokens. Usa <strong>Paso 1</strong> (Agregar o importar XLSX) para crear uno.
											</td>
										</tr>
									) : null}
									{gruposConToken.map((g) => {
										const k = claveFilaResumen(g);
										const baseRow = {
											grupoTexto: tokenRows[k]?.grupoTexto ?? textoGrupoParaTokenRow(g),
											claveAcceso: tokenRows[k]?.claveAcceso ?? g.claveAcceso,
											fechaLimite:
												tokenRows[k]?.fechaLimite ??
												(g.fechaLimiteEntrega ? g.fechaLimiteEntrega.slice(0, 10) : ""),
										};
										const gn = gradoNumericoResumen(g.grado);
										if (gn !== 1) {
											return (
												<tr key={`token-row-${k}`} className="bg-amber-50/50 hover:bg-[#F8FAFC]/80">
													<td className="px-3 py-2 tabular-nums font-medium text-amber-900">
														{String(g.grado).trim()}.°
													</td>
													<td className="px-3 py-2 font-medium text-amber-950">{g.grupo}</td>
													<td className="px-3 py-2" colSpan={2}>
														<p className="text-xs text-amber-900/90">
															<code className="rounded bg-white px-1 py-0.5 font-mono">{g.claveAcceso}</code>
															<span className="ml-2 text-amber-800">
																— En 2.°–6.° no debe haber token; elimínalo si es heredado.
															</span>
														</p>
													</td>
													<td className="px-3 py-2">
														<button
															type="button"
															disabled={tokenCargando}
															className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
															onClick={() => void eliminarTokenGrupo(g.id!, g.claveAcceso)}
														>
															<IconoBasura className="h-3.5 w-3.5" />
															Eliminar
														</button>
													</td>
												</tr>
											);
										}
										return (
											<tr key={`token-row-${k}`} className="hover:bg-[#F8FAFC]/80">
												<td className="px-3 py-2 tabular-nums text-[#64748B]">{String(g.grado).trim()}.°</td>
												<td className="px-3 py-2">
													<input
														type="text"
														maxLength={1}
														value={baseRow.grupoTexto}
														onChange={(e) =>
															setTokenRows((prev) => ({
																...prev,
																[k]: {
																	...(prev[k] ?? {
																		grupoTexto: textoGrupoParaTokenRow(g),
																		claveAcceso: g.claveAcceso,
																		fechaLimite: g.fechaLimiteEntrega
																			? g.fechaLimiteEntrega.slice(0, 10)
																			: "",
																	}),
																	grupoTexto: e.target.value.toUpperCase().replace(/\s+/g, "").slice(0, 1),
																},
															}))
														}
														title="Solo letra del grupo en 1.°"
														className="w-20 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1 outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#DBEAFE]"
													/>
												</td>
												<td className="px-3 py-2">
													<input
														type="text"
														value={baseRow.claveAcceso}
														onChange={(e) =>
															setTokenRows((prev) => ({
																...prev,
																[k]: {
																	...(prev[k] ?? {
																		grupoTexto: textoGrupoParaTokenRow(g),
																		claveAcceso: g.claveAcceso,
																		fechaLimite: g.fechaLimiteEntrega
																			? g.fechaLimiteEntrega.slice(0, 10)
																			: "",
																	}),
																	claveAcceso: e.target.value.toUpperCase(),
																},
															}))
														}
														className="w-36 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1 font-mono text-xs outline-none focus:border-[#2563EB] focus:ring-2 focus:ring-[#DBEAFE]"
													/>
												</td>
												<td className="px-3 py-2">
													<input
														type="date"
														value={baseRow.fechaLimite}
														onChange={(e) =>
															setTokenRows((prev) => ({
																...prev,
																[k]: {
																	...(prev[k] ?? {
																		grupoTexto: textoGrupoParaTokenRow(g),
																		claveAcceso: g.claveAcceso,
																		fechaLimite: g.fechaLimiteEntrega
																			? g.fechaLimiteEntrega.slice(0, 10)
																			: "",
																	}),
																	fechaLimite: e.target.value,
																},
															}))
														}
														className="min-w-[9.5rem] rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1 text-xs outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#EDE9FE]"
														title="Último día en que el token permite acceso (vacío = sin cierre automático)"
													/>
												</td>
												<td className="px-3 py-2">
													<div className="flex flex-wrap items-center gap-2">
														<button
															type="button"
															disabled={tokenCargando}
															onClick={() => void guardarTokenGrupo(g.id!)}
															className="inline-flex items-center gap-1 rounded-lg border border-[#2563EB] bg-[#2563EB] px-2.5 py-1 text-xs font-semibold text-white shadow-sm transition hover:bg-[#1D4ED8] disabled:opacity-60"
														>
															<IconoGuardar className="h-3.5 w-3.5" />
															Guardar
														</button>
														<button
															type="button"
															disabled={tokenCargando}
															className="inline-flex items-center gap-1 text-xs font-semibold text-red-600 hover:text-red-700 hover:underline disabled:opacity-50"
															onClick={() => void eliminarTokenGrupo(g.id!, g.claveAcceso)}
														>
															<IconoBasura className="h-3.5 w-3.5" />
															Eliminar
														</button>
													</div>
												</td>
											</tr>
										);
									})}
								</tbody>
							</table>
						</div>
					</div>

					<div className="mt-5 rounded-2xl border border-violet-200 bg-violet-50/70 p-4 shadow-sm">
						<div className="flex flex-wrap items-center justify-between gap-2">
							<div>
								<h3 className="text-sm font-semibold text-violet-900">Gestionar carreras</h3>
								<p className="text-xs text-violet-900/80">
									Aquí puedes agregar una carrera nueva o cambiar el nombre de una carrera existente.
								</p>
							</div>
						</div>
						<div className="mt-3 flex flex-wrap items-end gap-2">
							<div className="min-w-[16rem] flex-1">
								<label htmlFor="nueva-carrera-nombre" className="block text-xs font-medium text-violet-900">
									Nueva carrera
								</label>
								<input
									id="nueva-carrera-nombre"
									type="text"
									autoComplete="off"
									placeholder="Ej. Logística"
									value={nuevaCarreraNombre}
									onChange={(e) => setNuevaCarreraNombre(e.target.value)}
									className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
								/>
							</div>
							<button
								type="button"
								disabled={carreraCreando}
								onClick={() => void crearCarrera()}
								className="rounded-lg border border-violet-700 bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
							>
								{carreraCreando ? "Creando…" : "Agregar carrera"}
							</button>
						</div>
						{carreraGestionError ? (
							<p className="mt-2 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
								{carreraGestionError}
							</p>
						) : null}
						{carreraGestionOk ? (
							<p className="mt-2 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-800">
								{carreraGestionOk}
							</p>
						) : null}
						<div className="mt-3 overflow-x-auto rounded-xl border border-violet-100 bg-white">
							<table className="w-full min-w-[520px] text-left text-sm">
								<thead className="border-b border-violet-100 bg-violet-50/60">
									<tr>
										<th className="px-3 py-2 font-semibold text-violet-900">Código</th>
										<th className="px-3 py-2 font-semibold text-violet-900">Nombre</th>
										<th className="px-3 py-2 font-semibold text-violet-900" />
									</tr>
								</thead>
								<tbody className="divide-y divide-violet-50">
									{carrerasFiltro.length === 0 ? (
										<tr>
											<td colSpan={3} className="px-3 py-6 text-center text-xs text-slate-500">
												No hay carreras registradas.
											</td>
										</tr>
									) : (
										carrerasFiltro.map((c) => (
											<tr key={c.id}>
												<td className="px-3 py-2">
													<code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">{c.codigo}</code>
												</td>
												<td className="px-3 py-2">
													<input
														type="text"
														autoComplete="off"
														value={carreraNombreEdit[c.id] ?? ""}
														onChange={(e) =>
															setCarreraNombreEdit((prev) => ({
																...prev,
																[c.id]: e.target.value,
															}))
														}
														className="w-full rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
													/>
												</td>
												<td className="px-3 py-2 text-right">
													<button
														type="button"
														disabled={carreraGuardandoId === c.id}
														onClick={() => void guardarNombreCarrera(c.id)}
														className="rounded-lg border border-violet-700 bg-violet-700 px-3 py-1.5 text-xs font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
													>
														{carreraGuardandoId === c.id ? "Guardando…" : "Guardar"}
													</button>
												</td>
											</tr>
										))
									)}
								</tbody>
							</table>
						</div>
					</div>

					<div className="mt-5 rounded-2xl border border-[#E2E8F0] bg-gradient-to-br from-[#FFFFFF] via-[#F8FAFC] to-[#F5F3FF] p-3 shadow-lg shadow-[#7C3AED]/[0.06] sm:p-5">
						<div className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
							<div className="flex gap-3">
								<div className="flex h-12 w-12 shrink-0 items-center justify-center rounded-xl bg-gradient-to-br from-[#7C3AED] to-[#2563EB] text-white shadow-md">
									<IconoUsuario className="h-6 w-6" />
								</div>
								<div>
									<p className="bg-gradient-to-r from-[#7C3AED] to-[#2563EB] bg-clip-text text-[11px] font-bold uppercase tracking-wide text-transparent">
										Carga masiva
									</p>
									<h2 className="text-base font-bold text-[#1E293B]">Importar (XLSX)</h2>
									<p className="text-xs text-[#64748B]">
										Sube alumnos {" "}
										con
										<code className="ml-1 rounded border border-[#E2E8F0] bg-[#FFFFFF] px-1 text-[#1E293B]">
											nombre_completo
										</code>{" "}
										y
										<code className="ml-1 rounded border border-[#E2E8F0] bg-[#FFFFFF] px-1 text-[#1E293B]">grupo</code>{" "}
										
									</p>
								</div>
							</div>
							<div className="flex flex-wrap items-center gap-2">
								<button
									type="button"
									onClick={importarPadronXml}
									disabled={xmlPadronCargando}
									className="inline-flex items-center gap-1.5 rounded-lg border border-[#2563EB] bg-[#2563EB] px-3 py-1.5 text-sm font-semibold text-white shadow-md shadow-[#2563EB]/20 transition hover:bg-[#1D4ED8] disabled:cursor-not-allowed disabled:opacity-60"
								>
									<IconoSubir className="h-4 w-4" />
									{xmlPadronCargando ? "Importando…" : "Subir XLSX"}
								</button>
								<button
									type="button"
									onClick={abrirModalPadron}
									disabled={xmlPadronCargando}
									className="inline-flex items-center gap-1.5 rounded-lg border border-[#C4B5FD] bg-[#EDE9FE] px-3 py-1.5 text-sm font-semibold text-[#6D28D9] transition hover:bg-[#DDD6FE] disabled:cursor-not-allowed disabled:opacity-60"
								>
									<IconoTabla className="h-4 w-4" />
									Tabla
								</button>
							</div>
						</div>
						<div className="mt-4 rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-3 shadow-sm">

							<label htmlFor="xml-padron-file" className="sr-only">
								Archivo XLSX de alumnos
							</label>
							<input
								id="xml-padron-file"
								type="file"
								accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
								onChange={(e) => setXmlPadronFile(e.target.files?.[0] ?? null)}
								className={`block w-full max-w-md rounded-xl px-3 py-2 text-sm text-[#1E293B] file:mr-3 file:rounded-lg file:border-0 file:px-3 file:py-1.5 file:text-sm file:font-semibold file:text-white transition ${
									xmlPadronFile
										? "border-2 border-[#C4B5FD] bg-[#F5F3FF] file:bg-[#7C3AED] hover:file:bg-[#6D28D9]"
										: "border-2 border-dashed border-[#93C5FD] bg-[#EFF6FF]/90 file:bg-[#2563EB] hover:file:bg-[#1D4ED8]"
								}`}
							/>
							{xmlPadronFile ? (
								<p className="mt-2 flex items-center gap-2 text-xs text-[#6D28D9]" title={xmlPadronFile.name}>
									<IconoDocumento className="h-4 w-4 shrink-0" />
									<span>
										Archivo seleccionado: <span className="font-semibold">{xmlPadronFile.name}</span>
									</span>
								</p>
							) : (
								<p className="mt-2 text-xs text-[#64748B]">Selecciona un archivo de Excel para comenzar.</p>
							)}
							<p className="mt-2 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-2 py-1.5 text-[11px] text-[#64748B]">
								Columnas esperadas: <strong>nombreCompleto</strong> y <strong>grupo</strong>
								.El grupo es solo letra. Debe coincidir con
								un token ya creado. Mismo nombre en el mismo grupo no se duplica.
							</p>
						</div>
						{xmlPadronError ? (
							<p className="mt-3 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700" role="alert">
								{xmlPadronError}
							</p>
						) : null}
						{xmlPadronOk ? (
							<p className="mt-3 rounded-lg border border-teal-200 bg-teal-50 px-3 py-2 text-xs font-medium text-teal-900">
								{xmlPadronOk}
							</p>
						) : null}
					</div>
				</>
			) : null}

			{seccionActiva === "alumnos" ? (
				<>
					{!cargando && gruposAlumnos.length > 0 ? (
						<div className="mt-6 flex justify-center px-2 sm:px-0">
							<div className="w-fit max-w-full rounded-xl border border-emerald-200/80 bg-gradient-to-br from-white to-emerald-50/40 px-2 py-1.5 shadow-sm ring-1 ring-emerald-100/60 sm:px-3">
								<div className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1">
									<label htmlFor="filtro-grupo" className="sr-only">
										Buscar por grupo
									</label>
									<input
										id="filtro-grupo"
										type="text"
										autoComplete="off"
										placeholder="Grupo"
										title="Letra o texto del grupo"
										value={filtroGrupoLetra}
										onChange={(e) => setFiltroGrupoLetra(e.target.value)}
										className="w-[4.5rem] shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 sm:text-sm"
									/>
									<label htmlFor="filtro-grado" className="sr-only">
										Buscar por grado
									</label>
									<input
										id="filtro-grado"
										type="text"
										autoComplete="off"
										placeholder="Grado"
										title="Número o texto del grado"
										value={filtroGrado}
										onChange={(e) => setFiltroGrado(e.target.value)}
										className="w-[4.5rem] shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none placeholder:text-slate-400 focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 sm:text-sm"
									/>
									<label htmlFor="filtro-periodo-alumnos" className="sr-only">
										Filtrar por periodo académico
									</label>
									<select
										id="filtro-periodo-alumnos"
										value={filtroPeriodoAlumnosId}
										onChange={(e) => setFiltroPeriodoAlumnosId(e.target.value)}
										disabled={periodosCargando}
										className="max-w-[13rem] shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 sm:max-w-[16rem] sm:text-sm"
										title="Solo grupos cuya sección está asignada a ese periodo (pestaña Periodo)"
									>
										<option value="">Todos los periodos</option>
										{periodosLista.map((p) => (
											<option key={p.id} value={p.id}>
												{p.nombrePeriodo}
												{typeof p.gruposAsignados === "number" ? ` (${p.gruposAsignados})` : ""}
											</option>
										))}
									</select>
									<label htmlFor="filtro-carrera-alumnos" className="sr-only">
										Filtrar por carrera
									</label>
									<select
										id="filtro-carrera-alumnos"
										value={filtroCarreraAlumnosId}
										onChange={(e) => setFiltroCarreraAlumnosId(e.target.value)}
										className="max-w-[11rem] shrink-0 rounded-md border border-slate-300 bg-white px-2 py-1 text-xs text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500 sm:max-w-[14rem] sm:text-sm"
										title="Solo filas donde haya alumnos con esa carrera (desde 2.° grado)"
									>
										<option value="">Todas las carreras</option>
										<option value="__sin_carrera__">Sin carrera (2.°+)</option>
										{carrerasFiltro.map((c) => (
											<option key={c.id} value={c.id}>
												{c.nombre}
											</option>
										))}
									</select>
									<span className="hidden h-4 w-px shrink-0 bg-emerald-200/80 sm:block" aria-hidden />
									<div
										className="flex flex-wrap items-center justify-center gap-x-1 gap-y-1"
										role="group"
										aria-label="Filtrar por alumnos con archivo (columna Con archivo)"
									>
										<span
											className="shrink-0 text-[10px] font-medium uppercase tracking-wide text-slate-500"
											title="Coincide con el número de la columna «Con archivo»"
										>
											Con archivo
										</span>
										<button
											type="button"
											onClick={() => seleccionarArchivoExacto(null)}
											className={`rounded border px-1.5 py-0.5 text-[11px] font-medium sm:px-2 sm:py-1 sm:text-xs ${
												archivoExactoBoton === null && archivoExactoOtro.trim() === ""
													? "border-emerald-600 bg-emerald-600 text-white"
													: "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
											}`}
										>
											Todos
										</button>
										{[0, 1, 2, 3, 4, 5].map((n) => (
											<button
												key={n}
												type="button"
												onClick={() => seleccionarArchivoExacto(n)}
												className={`min-w-[1.75rem] rounded border px-1.5 py-0.5 text-[11px] font-semibold tabular-nums sm:min-w-[2rem] sm:px-2 sm:py-1 sm:text-xs ${
													archivoExactoBoton === n && archivoExactoOtro.trim() === ""
														? "border-emerald-600 bg-emerald-600 text-white"
														: "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
												}`}
											>
												{n}
											</button>
										))}
										<label htmlFor="filtro-archivo-otro" className="sr-only">
											Otro número exacto para Con archivo
										</label>
										<input
											id="filtro-archivo-otro"
											type="text"
											inputMode="numeric"
											autoComplete="off"
											placeholder="Otro"
											title="Número exacto (sustituye a los botones). Solo dígitos."
											value={archivoExactoOtro}
											onChange={(e) => {
												setArchivoExactoOtro(e.target.value);
												if (e.target.value.trim() !== "") {
													setArchivoExactoBoton(null);
												}
											}}
											aria-invalid={filtroArchivoOtroInvalido}
											className={`w-[2.75rem] shrink-0 rounded border bg-white px-1 py-0.5 text-center text-[11px] tabular-nums text-slate-900 outline-none focus:ring-1 sm:w-[3rem] sm:px-2 sm:py-1 sm:text-xs ${
												filtroArchivoOtroInvalido
													? "border-red-400 focus:border-red-500 focus:ring-red-500"
													: "border-slate-300 focus:border-emerald-500 focus:ring-emerald-500"
											}`}
										/>
									</div>
									<span className="hidden h-4 w-px shrink-0 bg-emerald-200/80 sm:block" aria-hidden />
									<p
										className="shrink-0 text-[11px] tabular-nums text-slate-600 sm:text-xs"
										title="Filas visibles / grupos con al menos un alumno en padrón"
									>
										<span className="font-semibold text-slate-800">{gruposFiltrados.length}</span>
										<span className="mx-0.5 text-slate-400">/</span>
										{gruposAlumnosConAlumnos.length}
										{cargandoIgPeriodoAlumnosFiltro && filtroPeriodoAlumnosId.trim() !== "" ? (
											<span className="ml-1 text-[10px] text-slate-500">(periodo…)</span>
										) : null}
									</p>
									<button
										type="button"
										onClick={limpiarFiltros}
										className="shrink-0 rounded border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-medium text-emerald-900 hover:bg-emerald-50 sm:py-1 sm:text-xs"
									>
										Limpiar
									</button>
								</div>
								{filtroArchivoOtroInvalido ? (
									<p className="mt-1 text-center text-[10px] text-red-600" role="alert">
										«Otro»: solo dígitos.
									</p>
								) : null}
							</div>
						</div>
					) : null}

					{cargando ? (
				<p className="mt-8 text-slate-500">Cargando grupos…</p>
			) : error ? (
				<p className="mt-8 text-red-600" role="alert">
					{error}
				</p>
			) : gruposAlumnos.length === 0 ? (
				<p className="mt-8 rounded-xl border border-amber-200 bg-amber-50 px-4 py-3 text-sm text-amber-950">
					No hay <strong>tokens</strong> con padrón aún. Si ya ves secciones en <strong>Tokens de grupo</strong>, crea la
					clave por fila (Crear token) o usa <strong>Paso 1</strong>. Los alumnos se enlazan en{" "}
					<code className="rounded bg-white px-1">padron_alumnos</code> vía <code className="rounded bg-white px-1">grupo_token_id</code>.
				</p>
			) : gruposAlumnosConAlumnos.length === 0 ? (
				<p className="mt-8 rounded-xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-800">
					Hay secciones o tokens, pero <strong>ninguna fila tiene alumnos</strong> en el padrón (todos en 0). Importa o
					registra alumnos para ver grupos aquí.
				</p>
			) : gruposFiltrados.length === 0 ? (
				<p
					className={`mt-8 rounded-xl border px-4 py-3 text-sm ${
						filtroArchivoOtroInvalido
							? "border-red-200 bg-red-50 text-red-900"
							: "border-slate-200 bg-slate-50 text-slate-700"
					}`}
					role={filtroArchivoOtroInvalido ? "alert" : undefined}
				>
					{filtroArchivoOtroInvalido ? (
						<>Corrige el campo «Otro» (solo dígitos) o bórralo. </>
					) : (
						<>Ningún grupo coincide con los filtros. </>
					)}
					<button
						type="button"
						className="font-medium text-emerald-800 underline"
						onClick={limpiarFiltros}
					>
						Limpiar
					</button>
				</p>
			) : (
				<div className="mt-8 space-y-10">
					{gruposAlumnosAgrupadosPorGrado.map(([claveGrado, filas]) => {
						const idGradoSeccion =
							claveGrado === "__otros__" ? "otros" : claveGrado;
						const tituloGrado =
							claveGrado === "__otros__"
								? "Otros (grado no numérico)"
								: `Grado ${claveGrado}.°`;
						return (
							<section
								key={claveGrado}
								aria-labelledby={`titulo-grado-alumnos-${idGradoSeccion}`}
								className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm"
							>
								<div className="border-b border-slate-200 bg-gradient-to-r from-emerald-50 to-slate-50 px-4 py-3">
									<h2
										id={`titulo-grado-alumnos-${idGradoSeccion}`}
										className="text-base font-bold text-slate-900"
									>
										{tituloGrado}
									</h2>
									<p className="mt-0.5 text-xs text-slate-600">
										{filas.length} fila{filas.length === 1 ? "" : "s"} (grupo · token) en este grado.
									</p>
								</div>
								<div className="overflow-x-auto">
									<table className="w-full min-w-[720px] text-left text-sm">
										<thead className="border-b border-slate-200 bg-slate-50">
											<tr>
												<th className="px-4 py-3 font-semibold text-slate-600">Grupo</th>
												<th className="px-4 py-3 font-semibold text-slate-600">Clave acceso</th>
												<th className="px-4 py-3 font-semibold text-slate-600">Alumnos</th>
												<th
													className="px-4 py-3 font-semibold text-slate-600"
													title="Desde 2.° grado: cuántos tienen carrera asignada / total en esta fila"
												>
													Carrera
												</th>
												<th className="px-4 py-3 font-semibold text-slate-600">Con archivo</th>
												<th className="px-4 py-3 font-semibold text-slate-600" />
											</tr>
										</thead>
										<tbody className="divide-y divide-slate-100">
											{filas.map((g) => (
												<tr key={g.id} className="hover:bg-emerald-50/30">
													<td className="px-4 py-3">{g.grupo}</td>
													<td className="px-4 py-3">
														<code className="rounded bg-slate-100 px-1.5 py-0.5 text-xs">
															{g.claveAcceso}
														</code>
													</td>
													<td className="px-4 py-3 tabular-nums">{g.totalAlumnos}</td>
													<td className="px-4 py-3 text-slate-800">
														{alumnoRequiereCarrera(g.gradoResumen) ? (
															g.carreraIds.length > 0 ? (
																<span title="Carreras detectadas en este grado y grupo">
																	{g.carreraIds
																		.map((id) => carreraNombrePorId.get(id) ?? "Carrera asignada")
																		.join(", ")}
																</span>
															) : (
																<span className="text-slate-400">Sin carrera</span>
															)
														) : (
															<span className="text-slate-400">—</span>
														)}
													</td>
													<td className="px-4 py-3 tabular-nums">{g.conExpediente}</td>
													<td className="px-4 py-3">
														<Link
															href={`/orientador/panel/grupo/${g.grupoTokenId ?? g.institucionGrupoId}`}
															className="font-medium text-emerald-700 hover:underline"
														>
															Ver alumnos
														</Link>
													</td>
												</tr>
											))}
										</tbody>
									</table>
								</div>
							</section>
						);
					})}
				</div>
					)}
				</>
			) : null}

			{seccionActiva === "carga" ? (
				<div className="mx-auto mt-8 max-w-6xl space-y-8 px-4 sm:px-6">
					<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
						<h2 className="text-center text-lg font-semibold text-slate-900">Historial de carga de alumnos</h2>
						<p className="mx-auto mt-2 max-w-2xl text-center text-xs text-slate-500">
							Los <strong>periodos</strong> son el ciclo de semestre guardado en <strong>Periodo</strong> (nombre tipo
							AAAA-AAAA). Allí asignas qué grupos pertenecen a ese ciclo. Al pulsar <strong>Ver</strong> se listan los
							alumnos activos del padrón de esos grupos (estado actual).
						</p>
						{periodosError ? (
							<p className="mt-3 text-center text-sm text-red-600" role="alert">
								{periodosError}
							</p>
						) : null}
						<div className="mt-5 space-y-3">
							{periodosCargando ? (
								<p className="text-center text-sm text-slate-500">Cargando periodos…</p>
							) : periodosLista.length === 0 ? (
								<p className="rounded-xl border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
									No hay ciclo de semestre en la base. Ve a <strong>Periodo</strong>, guarda <strong>Primer</strong> y{" "}
									<strong>Segundo periodo</strong> y luego asocia grupos a ese nombre (AAAA-AAAA).
								</p>
							) : (
								periodosLista.map((p) => (
									<div
										key={p.id}
										className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-slate-100 bg-slate-50/90 px-4 py-3 shadow-sm"
									>
										<p className="text-sm font-medium text-slate-800">
											<span className="font-semibold tabular-nums text-slate-900">{p.nombrePeriodo}</span>
											<span className="ml-2 text-xs font-normal text-slate-500">
												({p.gruposAsignados} grupo{p.gruposAsignados === 1 ? "" : "s"})
											</span>
										</p>
										<button
											type="button"
											onClick={() => void abrirHistorialPeriodo(p)}
											className="inline-flex items-center gap-2 rounded-lg border border-slate-300 bg-white px-3 py-1.5 text-sm font-medium text-slate-700 shadow-sm hover:bg-slate-100"
										>
											Ver
											<IconoOjo className="h-4 w-4" />
										</button>
									</div>
								))
							)}
						</div>
					</div>

					<div className="mx-auto max-w-2xl">
					<div className="rounded-2xl border border-amber-200 bg-amber-50/50 p-5 shadow-sm">
						<h2 className="text-lg font-semibold text-amber-950">Bajar expedientes (archivo muerto)</h2>
						<p className="mt-2 text-sm text-amber-950/90">
							Los alumnos dejan de verse en listas activas y <strong>no podrán iniciar sesión</strong>. Los datos y
							archivos siguen en la base y en el storage. Puedes buscarlos en la tabla de{" "}
							<strong>Inactivos</strong> más abajo y reactivarlos o descargar documentos.
						</p>
						<p className="mt-2 text-xs text-amber-900/80">
							También puedes archivar <strong>por alumno</strong> desde <strong>Ver alumnos</strong> del grupo.
						</p>
						<p className="mt-3 rounded-lg border border-amber-200/80 bg-white/60 px-3 py-2 text-xs leading-relaxed text-amber-950/90">
							<strong>Importante:</strong> este menú <strong>no muestra una lista de alumnos</strong>. Solo indica
							qué grupo vas a pasar a archivo muerto al pulsar el botón. Para ver los alumnos activos antes de
							archivar, ve a la pestaña <strong>Alumnos</strong> y entra en <strong>Ver alumnos</strong>.
						</p>
						<div className="mt-4 flex flex-col gap-3 sm:flex-row sm:items-end">
							<div className="min-w-0 flex-1">
								<label htmlFor="grupo-bajar" className="block text-xs font-medium text-amber-900">
									Grupo (token)
								</label>
								<select
									id="grupo-bajar"
									value={grupoBajarId}
									onChange={(e) => setGrupoBajarId(e.target.value)}
									className="mt-1 w-full rounded-lg border border-amber-300 bg-white px-2 py-2 text-sm text-slate-900"
								>
									<option value="">— Elige grupo —</option>
									{gruposAgrupadosPorGradoToken(gruposConToken).map(([gradoKey, lista]) => (
										<optgroup key={`bajar-og-${gradoKey}`} label={etiquetaOptgroupGradoToken(gradoKey)}>
											{lista.map((g) => (
												<option key={g.id!} value={g.id!}>
													Grupo {g.grupo} — {g.claveAcceso}
												</option>
											))}
										</optgroup>
									))}
								</select>
							</div>
							<button
								type="button"
								disabled={bajarCargando || gruposConToken.length === 0}
								onClick={() => void archivarGrupoABajar()}
								className="rounded-lg border border-amber-800 bg-amber-800 px-4 py-2 text-sm font-medium text-white hover:bg-amber-900 disabled:opacity-50"
							>
								{bajarCargando ? "Procesando…" : "Archivar todo el grupo"}
							</button>
						</div>
						{bajarError ? (
							<p className="mt-3 text-sm text-red-700" role="alert">
								{bajarError}
							</p>
						) : null}
						{bajarMensaje ? (
							<p className="mt-3 text-sm text-emerald-800">{bajarMensaje}</p>
						) : null}
					</div>
					</div>

					<div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-sm sm:p-5">
						<h2 className="text-lg font-semibold text-slate-900">Inactivos (archivo muerto)</h2>
						<p className="mt-1 text-sm text-slate-600">
							Búsqueda por nombre, grupo o carrera. Descarga un PDF concreto o el expediente completo (ZIP).
						</p>
						<p className="mt-2 rounded-lg border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-relaxed text-slate-700">
							<strong>Solo ves expedientes ya archivados</strong> (archivo muerto). Los alumnos que siguen activos no
							aparecen aquí: siguen en <strong>Alumnos → Ver alumnos</strong>. Si eliges un grupo y la tabla queda
							vacía, en ese grupo todavía no hay nadie dado de baja en archivo muerto.
						</p>
						<p className="mt-2 text-xs text-slate-500">
							Grupo y carrera actualizan la lista al cambiarlos. Si filtras por <strong>nombre</strong>, escribe y
							pulsa <strong>Aplicar filtros</strong>.
						</p>
						<div className="mt-4 flex flex-wrap items-end gap-3">
							<div>
								<label htmlFor="inactivo-nombre" className="block text-xs font-medium text-slate-600">
									Nombre
								</label>
								<input
									id="inactivo-nombre"
									type="search"
									value={inactivoNombre}
									onChange={(e) => setInactivoNombre(e.target.value)}
									placeholder="Contiene…"
									className="mt-1 w-44 rounded-lg border border-slate-300 px-2 py-1.5 text-sm sm:w-52"
								/>
							</div>
							<div>
								<label htmlFor="inactivo-grupo" className="block text-xs font-medium text-slate-600">
									Grupo
								</label>
								<select
									id="inactivo-grupo"
									value={inactivoGrupoId}
									onChange={(e) => setInactivoGrupoId(e.target.value)}
									className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
								>
									<option value="">Todos</option>
									{gruposAgrupadosPorGradoToken(gruposConToken).map(([gradoKey, lista]) => (
										<optgroup key={`inact-og-${gradoKey}`} label={etiquetaOptgroupGradoToken(gradoKey)}>
											{lista.map((g) => (
												<option key={g.id!} value={g.id!}>
													Grupo {g.grupo} — {g.claveAcceso}
												</option>
											))}
										</optgroup>
									))}
								</select>
							</div>
							<div>
								<label htmlFor="inactivo-carrera" className="block text-xs font-medium text-slate-600">
									Carrera
								</label>
								<select
									id="inactivo-carrera"
									value={inactivoCarreraId}
									onChange={(e) => setInactivoCarreraId(e.target.value)}
									className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
								>
									<option value="">Todas</option>
									{carrerasFiltro.map((c) => (
										<option key={c.id} value={c.id}>
											{c.nombre}
										</option>
									))}
								</select>
							</div>
							<button
								type="button"
								onClick={() => void cargarInactivos()}
								disabled={inactivosCargando}
								className="rounded-lg border border-slate-600 bg-slate-700 px-3 py-2 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
							>
								{inactivosCargando ? "…" : "Aplicar filtros"}
							</button>
						</div>
						{inactivosError ? (
							<p className="mt-3 text-sm text-red-600" role="alert">
								{inactivosError}
							</p>
						) : null}
						{inactivosCargando ? (
							<p className="mt-4 text-sm text-slate-500">Cargando…</p>
						) : (
							<div className="mt-4 overflow-x-auto rounded-lg border border-slate-100">
								<table className="w-full min-w-[960px] text-left text-sm">
									<thead className="border-b border-slate-200 bg-slate-50">
										<tr>
											<th className="px-3 py-2 font-semibold text-slate-600">Nombre</th>
											<th className="px-3 py-2 font-semibold text-slate-600">Grupo</th>
											<th className="px-3 py-2 font-semibold text-slate-600">Grado</th>
											<th className="px-3 py-2 font-semibold text-slate-600">Carrera</th>
											<th className="px-3 py-2 font-semibold text-slate-600">Archivado</th>
											<th className="px-3 py-2 font-semibold text-slate-600">Descargas</th>
											<th className="px-3 py-2 font-semibold text-slate-600" />
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100">
										{inactivosLista.length === 0 ? (
											<tr>
												<td colSpan={7} className="px-3 py-6 text-center text-slate-600">
													<p className="font-medium text-slate-700">
														{inactivoGrupoId.trim()
															? "Ningún alumno archivado en el grupo seleccionado."
															: "No hay registros inactivos con estos filtros."}
													</p>
													<p className="mx-auto mt-2 max-w-lg text-sm text-slate-500">
														{inactivoGrupoId.trim()
															? "Los alumnos activos de ese grupo siguen en la pestaña Alumnos (Ver alumnos). Cuando archivés a alguien o a todo el grupo, aparecerá aquí."
															: "Prueba otro filtro o confirma que ya existen expedientes dados de baja en archivo muerto."}
													</p>
												</td>
											</tr>
										) : (
											inactivosLista.map((row) => (
												<tr key={row.padronId} className="hover:bg-slate-50/80">
													<td className="px-3 py-2 font-medium text-slate-900">{row.nombreCompleto}</td>
													<td className="px-3 py-2">{row.grupoLetra}</td>
													<td className="px-3 py-2 tabular-nums">{row.gradoMostrado}</td>
													<td className="px-3 py-2 text-slate-700">
														{row.carreraNombre ?? "—"}
													</td>
													<td className="px-3 py-2 text-xs text-slate-600">
														{row.archivoMuertoEn
															? new Date(row.archivoMuertoEn).toLocaleString()
															: "—"}
													</td>
													<td className="px-3 py-2">
														{row.tieneCuenta && row.cuentaId ? (
															<div className="flex max-w-[14rem] flex-col gap-1">
																<a
																	href={`/api/orientador/expediente-zip?cuentaId=${encodeURIComponent(row.cuentaId)}`}
																	className="text-xs font-medium text-emerald-700 underline"
																>
																	Expediente completo (ZIP)
																</a>
																<div className="flex flex-wrap items-center gap-1">
																	<select
																		value={inactivoDocSel[row.padronId] ?? "acta_nacimiento"}
																		onChange={(e) =>
																			setInactivoDocSel((prev) => ({
																				...prev,
																				[row.padronId]: e.target.value,
																			}))
																		}
																		className="max-w-[9rem] rounded border border-slate-300 px-1 py-0.5 text-[11px]"
																	>
																		{TIPOS_DESCARGA_ORIENTADOR.map((t) => (
																			<option key={t.tipo} value={t.tipo}>
																				{t.etiqueta}
																			</option>
																		))}
																	</select>
																	<a
																		href={`/api/orientador/documento/descargar?cuentaId=${encodeURIComponent(row.cuentaId)}&tipo=${encodeURIComponent(inactivoDocSel[row.padronId] ?? "acta_nacimiento")}`}
																		className="text-[11px] font-medium text-sky-700 underline"
																	>
																		Descargar PDF/archivo
																	</a>
																</div>
															</div>
														) : (
															<span className="text-xs text-slate-400">Sin cuenta / sin archivos</span>
														)}
													</td>
													<td className="px-3 py-2">
														<button
															type="button"
															disabled={reactivarTrabajo === row.padronId}
															onClick={() => void reactivarInactivo(row.padronId)}
															className="text-xs font-medium text-violet-700 underline hover:text-violet-900 disabled:opacity-50"
														>
															{reactivarTrabajo === row.padronId ? "…" : "Reactivar"}
														</button>
													</td>
												</tr>
											))
										)}
									</tbody>
								</table>
							</div>
						)}
					</div>
				</div>
			) : null}

			{seccionActiva === "periodo" ? (
				<div className="mx-auto mt-8 max-w-6xl space-y-8 px-4 sm:px-6">
					<div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm">
						<p className="text-center text-sm text-slate-700">
							Establece los periodos anuales de cambio de semestre para que los expedientes puedan actualizarse de
							grado automáticamente (proceso programado aparte según estas fechas).
						</p>
						<p className="mx-auto mt-2 max-w-xl text-center text-xs text-slate-500">
							Al guardar, el sistema registra un <strong>nombre de periodo</strong> con los años de cada fecha (ej. 2 feb
							2030 y 4 feb 2034 → <strong>2030-2034</strong>) para identificar ese ciclo.
						</p>
						{identificadorSemestreAnios ? (
							<p className="mt-3 text-center text-sm font-medium text-slate-800">
								Vista previa (tras pulsar «Guardar periodos» quedará en la base):{" "}
								<span className="rounded-md bg-slate-100 px-2 py-0.5 font-mono tabular-nums text-slate-900">
									{identificadorSemestreAnios}
								</span>
							</p>
						) : null}
						<div className="mt-6 grid gap-4 sm:grid-cols-2">
							<div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
								<p className="text-sm font-semibold text-slate-800">Primer periodo</p>
								<label htmlFor="semestre-primer" className="sr-only">
									Fecha primer periodo
								</label>
								<input
									id="semestre-primer"
									type="date"
									value={semestrePrimer}
									onChange={(e) => setSemestrePrimer(e.target.value)}
									className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
								/>
							</div>
							<div className="rounded-xl border border-slate-200 bg-slate-50/80 p-4">
								<p className="text-sm font-semibold text-slate-800">Segundo periodo</p>
								<label htmlFor="semestre-segundo" className="sr-only">
									Fecha segundo periodo
								</label>
								<input
									id="semestre-segundo"
									type="date"
									value={semestreSegundo}
									onChange={(e) => setSemestreSegundo(e.target.value)}
									className="mt-2 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
								/>
							</div>
						</div>
						<div className="mt-4 flex justify-center">
							<button
								type="button"
								disabled={semestreGuardando}
								onClick={() => void guardarSemestreFechas()}
								className="inline-flex items-center gap-2 rounded-xl border border-slate-600 bg-slate-700 px-6 py-2.5 text-sm font-medium text-white hover:bg-slate-800 disabled:opacity-60"
							>
								<IconoGuardar className="h-4 w-4" />
								{semestreGuardando ? "Guardando…" : "Guardar periodos"}
							</button>
						</div>
						{semestreError ? (
							<p className="mt-3 text-center text-sm text-red-600" role="alert">
								{semestreError}
							</p>
						) : null}
						{semestreMensaje ? (
							<p className="mt-3 text-center text-sm text-emerald-800">{semestreMensaje}</p>
						) : null}
					</div>

					<div className="rounded-2xl border border-violet-200 bg-violet-50/60 p-5 shadow-sm">
						<h2 className="text-lg font-semibold text-violet-950">Periodos académicos y grupos</h2>
						<p className="mt-1 text-sm text-violet-900/90">
							El periodo es el <strong>mismo registro</strong> que guardas arriba con «Guardar periodos» (nombre{" "}
							<strong>AAAA-AAAA</strong> en base de datos). Elige ese nombre y asocia grupos (tokens). El historial en{" "}
							<strong>Carga</strong> usa esta asociación.
						</p>
						<div className="mt-5">
							<label htmlFor="periodo-gestion-sel" className="block text-xs font-medium text-violet-900">
								Periodo (nombre del ciclo de semestre) para asignar grupos
							</label>
							<select
								id="periodo-gestion-sel"
								value={periodoGestionSelId}
								onChange={(e) => setPeriodoGestionSelId(e.target.value)}
								className="mt-1 max-w-full rounded-lg border border-violet-200 bg-white px-2 py-2 text-sm sm:max-w-xl"
							>
								<option value="">— Elige el periodo —</option>
								{periodosLista.map((p) => (
									<option key={p.id} value={p.id}>
										{p.nombrePeriodo} ({p.gruposAsignados} grupo{p.gruposAsignados === 1 ? "" : "s"})
									</option>
								))}
							</select>
						</div>
						{periodoGestionError ? (
							<p className="mt-3 text-sm text-red-700" role="alert">
								{periodoGestionError}
							</p>
						) : null}
						{periodoGestionOk ? <p className="mt-3 text-sm text-emerald-800">{periodoGestionOk}</p> : null}
						<div className="mt-4 flex flex-wrap items-end gap-3">
							<div className="min-w-[12rem] flex-1">
								<label htmlFor="grupo-agregar-periodo" className="block text-xs font-medium text-violet-900">
									Agregar grupo
								</label>
								<p className="mt-1 text-[11px] text-violet-800/90">
									Cada token va por <strong>grado del grupo</strong> (1.°, 2.°, …): la misma letra A en 1.° y en 2.° son filas distintas.
								</p>
								<select
									id="grupo-agregar-periodo"
									value={grupoParaAgregarAlPeriodo}
									onChange={(e) => setGrupoParaAgregarAlPeriodo(e.target.value)}
									disabled={!periodoGestionSelId}
									className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-2 py-2 text-sm disabled:opacity-50"
								>
									<option value="">— Sección (grado + grupo) —</option>
									{gruposAgrupadosPorGradoToken(gruposParaPeriodo).map(([gradoKey, lista]) => (
										<optgroup key={`periodo-og-${gradoKey}`} label={etiquetaOptgroupGradoToken(gradoKey)}>
											{lista.map((g) => (
												<option key={g.institucionGrupoId!} value={g.institucionGrupoId!}>
													Grupo {g.grupo} — {g.claveAcceso || "sin clave"}
												</option>
											))}
										</optgroup>
									))}
								</select>
							</div>
							<button
								type="button"
								disabled={!periodoGestionSelId || periodoGestionCargando}
								onClick={() => void agregarGrupoAlPeriodoSeleccionado()}
								className="rounded-lg border border-violet-600 bg-violet-600 px-4 py-2 text-sm font-medium text-white hover:bg-violet-700 disabled:opacity-50"
							>
								Agregar al periodo
							</button>
						</div>
						{periodoGestionSelId ? (
							<div className="mt-4">
								<p className="text-xs font-medium text-violet-900">Grupos en este periodo</p>
								{periodoGestionCargando ? (
									<p className="mt-2 text-sm text-slate-500">Cargando…</p>
								) : periodoGestionGrupos.length === 0 ? (
									<p className="mt-2 text-sm text-slate-600">Ningún grupo asignado aún.</p>
								) : (
									<ul className="mt-2 flex flex-wrap gap-2">
										{periodoGestionGrupos.map((g) => (
											<li
												key={g.institucionGrupoId}
												className="inline-flex items-center gap-2 rounded-full border border-violet-200 bg-white px-3 py-1 text-sm"
											>
												<span title={g.claveAcceso ? `Clave ${g.claveAcceso}` : "Sin clave (solo sección)"}>
													{String(g.grado).trim() || "—"}.° · Grupo {g.grupo}
												</span>
												<button
													type="button"
													disabled={periodoGestionCargando}
													onClick={() => void quitarGrupoDelPeriodoSeleccionado(g.institucionGrupoId)}
													className="text-xs font-medium text-red-700 underline hover:text-red-900"
												>
													Quitar
												</button>
											</li>
										))}
									</ul>
								)}
							</div>
						) : null}
					</div>
				</div>
			) : null}

			{seccionActiva === "plantillas" ? (
				<div className="mx-auto mt-8 max-w-6xl px-4 sm:px-6">
					<div className="rounded-2xl border border-indigo-100 bg-white p-4 shadow-sm sm:p-5">
						<div className="flex flex-wrap items-start justify-between gap-3">
							<div>
								<h2 className="text-lg font-semibold text-slate-900">Muro de plantillas</h2>
								<p className="mt-1 max-w-2xl text-sm text-slate-600">
									Crea plantillas desde un PDF, define los campos de texto sobre el documento y luego
									<strong> ocupa</strong> la plantilla para rellenar expedientes (manual o con datos del alumno).
								</p>
							</div>
							<button
								type="button"
								onClick={() => {
									setPlantillasError("");
									setModalEscanearAbierto(true);
								}}
								className="inline-flex shrink-0 items-center gap-2 rounded-xl border border-indigo-600 bg-indigo-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm hover:bg-indigo-700"
							>
								<IconoSubir className="h-4 w-4" />
								Escanear
							</button>
						</div>

						{plantillasError ? (
							<p className="mt-4 text-sm text-red-600" role="alert">
								{plantillasError}
							</p>
						) : null}
						{plantillaOk ? (
							<p className="mt-4 text-sm text-emerald-800">{plantillaOk}</p>
						) : null}

						<h3 className="mt-8 text-sm font-semibold text-slate-800">Plantillas disponibles</h3>
						{plantillasCargando ? (
							<p className="mt-3 text-sm text-slate-500">Cargando…</p>
						) : plantillasLista.length === 0 ? (
							<p className="mt-3 rounded-xl border border-dashed border-slate-200 bg-slate-50/80 px-4 py-8 text-center text-sm text-slate-600">
								Aún no hay plantillas. Pulsa <strong>Escanear</strong> para subir un PDF y definir campos.
							</p>
						) : (
							<ul className="mt-4 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
								{plantillasLista.map((p) => (
									<li
										key={p.id}
										className="flex flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-sm transition hover:border-indigo-200 hover:shadow-md"
									>
										<div className="relative flex min-h-[11rem] flex-1 flex-col items-center justify-center gap-2 bg-gradient-to-b from-slate-50 to-white px-4 py-6">
											<span
												className="absolute right-1 top-1/2 origin-center -translate-y-1/2 rotate-90 text-[10px] font-medium uppercase tracking-wide text-slate-400"
												aria-hidden
											>
												Vista previa
											</span>
											<IconoDocumento className="h-14 w-14 text-slate-800" aria-hidden />
											<p className="text-center text-sm font-semibold text-slate-900">{p.titulo}</p>
											<a
												href={`/api/orientador/plantillas/${p.id}/pdf`}
												target="_blank"
												rel="noreferrer"
												className="text-xs font-medium text-indigo-600 underline hover:text-indigo-800"
											>
												Abrir PDF
											</a>
										</div>
										<div className="border-t border-slate-100 px-3 py-3">
											<p className="truncate text-[11px] text-slate-500" title={p.nombre_archivo}>
												{p.nombre_archivo}
											</p>
											<div className="mt-3 flex flex-wrap gap-2">
												<Link
													href={`/orientador/panel/plantillas/${p.id}/editar?usar=1`}
													className="flex-1 rounded-lg border border-slate-300 bg-slate-100 px-3 py-2 text-center text-sm font-medium text-slate-900 hover:bg-slate-200"
												>
													Ocupar
												</Link>
												<Link
													href={`/orientador/panel/plantillas/${p.id}/editar`}
													className="rounded-lg border border-indigo-200 bg-indigo-50 px-3 py-2 text-sm font-medium text-indigo-800 hover:bg-indigo-100"
												>
													Editar
												</Link>
												<button
													type="button"
													onClick={() => void eliminarPlantillaMuro(p.id, p.titulo)}
													className="rounded-lg px-2 py-2 text-sm text-red-700 hover:underline"
												>
													Eliminar
												</button>
											</div>
										</div>
									</li>
								))}
							</ul>
						)}
					</div>

					{modalEscanearAbierto ? (
						<div
							className="fixed inset-0 z-[60] flex items-center justify-center bg-slate-900/50 p-4"
							role="presentation"
							onClick={() => setModalEscanearAbierto(false)}
						>
							<div
								role="dialog"
								aria-modal="true"
								aria-labelledby="modal-escanear-titulo"
								className="w-full max-w-md rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
								onClick={(e) => e.stopPropagation()}
							>
								<div className="flex items-center gap-2">
									<button
										type="button"
										className="rounded-lg p-1 text-slate-600 hover:bg-slate-100"
										onClick={() => setModalEscanearAbierto(false)}
										aria-label="Cerrar"
									>
										<IconoFlechaAtras className="h-6 w-6" />
									</button>
									<h2 id="modal-escanear-titulo" className="flex-1 text-center text-lg font-semibold text-slate-900">
										Escanear y Crear Plantilla
									</h2>
								</div>
								<p className="mt-2 text-center text-xs text-slate-500">
									En la web: sube el documento en PDF. Luego definirás los campos de texto sobre el documento.
								</p>
								<div className="mt-4 space-y-3">
									<div>
										<label htmlFor="plantilla-titulo-modal" className="block text-xs font-medium text-slate-600">
											Nombre
										</label>
										<input
											id="plantilla-titulo-modal"
											type="text"
											value={plantillaTitulo}
											onChange={(e) => setPlantillaTitulo(e.target.value)}
											placeholder="Ej. Formato de constancia"
											className="mt-1 w-full rounded-lg border border-slate-300 px-3 py-2 text-sm"
										/>
									</div>
									<div>
										<label htmlFor="plantilla-pdf-file-modal" className="block text-xs font-medium text-slate-600">
											Archivo PDF
										</label>
										<input
											id="plantilla-pdf-file-modal"
											type="file"
											accept="application/pdf,.pdf"
											onChange={(e) => {
												const f = e.target.files?.[0] ?? null;
												setPlantillaArchivo(f);
											}}
											className="mt-1 block w-full text-sm file:mr-2 file:rounded-md file:border-0 file:bg-indigo-100 file:px-2 file:py-1 file:text-indigo-800"
										/>
									</div>
								</div>
								<div className="mt-6 flex flex-wrap justify-end gap-2">
									<button
										type="button"
										onClick={() => setModalEscanearAbierto(false)}
										className="rounded-lg border border-slate-300 px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
									>
										Cancelar
									</button>
									<button
										type="button"
										disabled={plantillaSubiendo}
										onClick={() => void subirPlantillaMuro({ redirectWizard: true })}
										className="inline-flex items-center gap-2 rounded-lg border border-indigo-600 bg-indigo-600 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-700 disabled:opacity-50"
									>
										<IconoDocumento className="h-4 w-4" />
										{plantillaSubiendo ? "Subiendo…" : "Subir y definir espacios"}
									</button>
								</div>
							</div>
						</div>
					) : null}
				</div>
			) : null}

			{historialModalPeriodo ? (
				<div
					className="fixed inset-0 z-[55] flex items-center justify-center bg-slate-900/50 p-4"
					role="presentation"
					onClick={() => setHistorialModalPeriodo(null)}
				>
					<div
						role="dialog"
						aria-modal="true"
						aria-labelledby="historial-archivos-titulo"
						className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-5 shadow-xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="relative pt-1">
							<button
								type="button"
								className="absolute left-0 top-0 rounded-lg p-1.5 text-slate-600 hover:bg-slate-100"
								onClick={() => setHistorialModalPeriodo(null)}
								aria-label="Volver al historial de periodos"
							>
								<IconoFlechaAtras className="h-6 w-6" />
							</button>
							<h2
								id="historial-archivos-titulo"
								className="text-center text-lg font-semibold text-slate-900"
							>
								Historial de archivos subidos
							</h2>
							<p className="mt-2 text-center text-base font-semibold tabular-nums text-slate-800">
								{historialModalPeriodo.nombrePeriodo}
							</p>
							{historialModalPeriodo.primerPeriodoFecha && historialModalPeriodo.segundoPeriodoFecha ? (
								<p className="mt-1 text-center text-xs text-slate-500">
									Fechas de semestre: {formatearFechaCorta(String(historialModalPeriodo.primerPeriodoFecha).slice(0, 10))}{" "}
									y {formatearFechaCorta(String(historialModalPeriodo.segundoPeriodoFecha).slice(0, 10))}
								</p>
							) : null}
						</div>
						{historialCargandoGrupos ? (
							<p className="mt-6 text-center text-sm text-slate-500">Cargando grupos…</p>
						) : historialGrupos.length === 0 ? (
							<p className="mt-6 rounded-lg border border-dashed border-slate-200 bg-slate-50 px-4 py-6 text-center text-sm text-slate-600">
								Este periodo no tiene grupos asignados. Asócialos en la pestaña <strong>Periodo</strong>.
							</p>
						) : (
							<>
								<div className="mt-5 flex flex-wrap justify-center gap-2" role="tablist" aria-label="Grupos del periodo">
									{historialGrupos.map((g) => {
										const sel = historialGrupoSel === g.institucionGrupoId;
										return (
											<button
												key={g.institucionGrupoId}
												type="button"
												role="tab"
												aria-selected={sel}
												onClick={() => setHistorialGrupoSel(g.institucionGrupoId)}
												className={`flex min-h-[2.75rem] min-w-[2.75rem] flex-col items-center justify-center rounded-lg border px-1 py-0.5 text-sm font-semibold transition-colors ${
													sel
														? "border-slate-700 bg-slate-700 text-white"
														: "border-slate-300 bg-slate-100 text-slate-700 hover:bg-slate-200"
												}`}
												title={`${String(g.grado).trim() || "—"}.° grado · Grupo ${g.grupo} — ${g.claveAcceso}`}
											>
												<span className="text-[10px] font-medium leading-none opacity-80">
													{String(g.grado).trim() || "—"}°
												</span>
												<span className="leading-none">{g.grupo}</span>
											</button>
										);
									})}
								</div>
								<div className="mt-5 space-y-2" role="tabpanel">
									{historialCargandoAlumnos ? (
										<p className="py-8 text-center text-sm text-slate-500">Cargando alumnos…</p>
									) : historialAlumnos.length === 0 ? (
										<p className="rounded-lg border border-slate-100 bg-slate-50/80 px-4 py-6 text-center text-sm text-slate-600">
											No hay alumnos activos en este grupo en el padrón.
										</p>
									) : (
										historialAlumnos.map((a) => (
											<div
												key={a.padronId}
												className="flex items-center justify-between gap-3 rounded-xl border border-slate-100 bg-white px-4 py-3 shadow-sm"
											>
												<div className="min-w-0 flex-1">
													<p className="truncate font-medium text-slate-900">{a.nombreCompleto}</p>
													<p className="text-xs text-slate-500">Grado: {a.gradoMostrado}</p>
												</div>
												{a.cuentaId ? (
													<a
														href={`/api/orientador/expediente-zip?cuentaId=${encodeURIComponent(a.cuentaId)}`}
														className="inline-flex shrink-0 rounded-lg border border-slate-300 bg-slate-50 p-2 text-slate-600 hover:bg-slate-100"
														title="Descargar expediente (ZIP)"
													>
														<IconoCarpeta className="h-5 w-5" />
													</a>
												) : (
													<span
														className="inline-flex shrink-0 rounded-lg border border-dashed border-slate-200 p-2 text-slate-300"
														title="Sin cuenta / sin expediente en sistema"
													>
														<IconoCarpeta className="h-5 w-5" />
													</span>
												)}
											</div>
										))
									)}
								</div>
							</>
						)}
					</div>
				</div>
			) : null}

			{modalTokensAbierto ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
					role="presentation"
					onClick={() => !tokenCargando && setModalTokensAbierto(false)}
				>
					<div
						role="dialog"
						aria-modal="true"
						aria-labelledby="modal-tokens-titulo"
						className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-start justify-between gap-2">
							<div>
								<h3 id="modal-tokens-titulo" className="text-base font-semibold text-slate-900">
									Tabla de tokens
								</h3>
								<p className="mt-1 text-xs text-slate-600">
									Grupo: solo letra y token (el enlace suele ser grado 1; el grado del alumno va en el padrón). Si
									el token ya existe, se actualiza el grupo.
								</p>
							</div>
							<button
								type="button"
								disabled={tokenCargando}
								className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
								onClick={() => setModalTokensAbierto(false)}
							>
								✕
							</button>
						</div>
						<div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
							<table className="w-full min-w-[280px] text-left text-sm">
								<thead className="bg-slate-50 text-slate-600">
									<tr>
										<th className="px-2 py-2 font-semibold">Grupo (letra)</th>
										<th className="px-2 py-2 font-semibold">Token</th>
										<th className="w-10 px-1 py-2 text-center font-semibold" aria-label="Quitar fila">
											{" "}
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{filasModalTokens.map((fila) => (
										<tr key={fila.id}>
											<td className="px-2 py-1.5">
												<input
													type="text"
													maxLength={1}
													value={fila.grupo}
													onChange={(e) =>
														setFilasModalTokens((prev) =>
															prev.map((r) =>
																r.id === fila.id
																	? {
																			...r,
																			grupo: e.target.value.toUpperCase().slice(0, 1),
																		}
																	: r,
															),
														)
													}
													className="w-full min-w-[2.5rem] rounded border border-slate-300 px-2 py-1 text-center text-sm"
													placeholder="G"
													title="Solo letra del grupo (grado 1)"
												/>
											</td>
											<td className="px-2 py-1.5">
												<input
													type="text"
													value={fila.token}
													onChange={(e) =>
														setFilasModalTokens((prev) =>
															prev.map((r) =>
																r.id === fila.id
																	? { ...r, token: e.target.value.toUpperCase() }
																	: r,
															),
														)
													}
													className="w-full rounded border border-slate-300 px-2 py-1 text-sm"
													placeholder="ABC123"
												/>
											</td>
											<td className="px-1 py-1.5 text-center">
												<button
													type="button"
													className="rounded px-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-red-600"
													onClick={() => quitarFilaModalToken(fila.id)}
													title="Quitar fila"
												>
													−
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<div className="mt-3 flex flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={agregarFilaModalToken}
								disabled={tokenCargando}
								className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
							>
								+ Fila
							</button>
							<button
								type="button"
								onClick={() => void enviarModalTokens()}
								disabled={tokenCargando}
								className="ml-auto rounded-lg border border-sky-600 bg-sky-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-sky-700 disabled:opacity-60"
							>
								{tokenCargando ? "Enviando…" : "Enviar"}
							</button>
						</div>
					</div>
				</div>
			) : null}

			{modalPadronAbierto ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/50 p-4"
					role="presentation"
					onClick={() => !xmlPadronCargando && setModalPadronAbierto(false)}
				>
					<div
						role="dialog"
						aria-modal="true"
						aria-labelledby="modal-padron-titulo"
						className="max-h-[90vh] w-full max-w-lg overflow-y-auto rounded-2xl border border-slate-200 bg-white p-4 shadow-xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex items-start justify-between gap-2">
							<div>
								<h3 id="modal-padron-titulo" className="text-base font-semibold text-slate-900">
									Tabla de padrón
								</h3>
								<p className="mt-1 text-xs text-slate-600">
									Nombre del alumno y grupo: solo la letra (ej. G). El grado en sistema es 1; debe existir
									un token para ese grupo.
								</p>
							</div>
							<button
								type="button"
								disabled={xmlPadronCargando}
								className="rounded-lg px-2 py-1 text-sm text-slate-500 hover:bg-slate-100"
								onClick={() => setModalPadronAbierto(false)}
							>
								✕
							</button>
						</div>
						<div className="mt-3 overflow-x-auto rounded-lg border border-slate-200">
							<table className="w-full min-w-[300px] text-left text-sm">
								<thead className="bg-slate-50 text-slate-600">
									<tr>
										<th className="px-2 py-2 font-semibold">Nombre</th>
										<th className="px-2 py-2 font-semibold">Grupo (letra)</th>
										<th className="w-10 px-1 py-2 text-center font-semibold" aria-label="Quitar fila">
											{" "}
										</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{filasModalPadron.map((fila) => (
										<tr key={fila.id}>
											<td className="px-2 py-1.5">
												<input
													type="text"
													value={fila.nombre}
													onChange={(e) =>
														setFilasModalPadron((prev) =>
															prev.map((r) =>
																r.id === fila.id ? { ...r, nombre: e.target.value } : r,
															),
														)
													}
													className="w-full min-w-[8rem] rounded border border-slate-300 px-2 py-1 text-sm"
													placeholder="Nombre completo"
												/>
											</td>
											<td className="px-2 py-1.5">
												<input
													type="text"
													maxLength={1}
													value={fila.grupo}
													onChange={(e) =>
														setFilasModalPadron((prev) =>
															prev.map((r) =>
																r.id === fila.id
																	? {
																			...r,
																			grupo: e.target.value.toUpperCase().slice(0, 1),
																		}
																	: r,
															),
														)
													}
													className="w-full min-w-[2.5rem] rounded border border-slate-300 px-2 py-1 text-center text-sm"
													placeholder="G"
													title="Solo letra del grupo (grado 1)"
												/>
											</td>
											<td className="px-1 py-1.5 text-center">
												<button
													type="button"
													className="rounded px-1 text-lg leading-none text-slate-400 hover:bg-slate-100 hover:text-red-600"
													onClick={() => quitarFilaModalPadron(fila.id)}
													title="Quitar fila"
												>
													−
												</button>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<div className="mt-3 flex flex-wrap items-center gap-2">
							<button
								type="button"
								onClick={agregarFilaModalPadron}
								disabled={xmlPadronCargando}
								className="rounded-lg border border-dashed border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
							>
								+ Fila
							</button>
							<button
								type="button"
								onClick={() => void enviarModalPadron()}
								disabled={xmlPadronCargando}
								className="ml-auto rounded-lg border border-emerald-600 bg-emerald-600 px-4 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
							>
								{xmlPadronCargando ? "Enviando…" : "Enviar"}
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
