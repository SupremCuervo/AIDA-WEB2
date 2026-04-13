"use client";

import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { EstadoEntregaDocumentoUi } from "@/lib/alumno/estado-documento";
import { GRADO_ESCOLAR_MAX } from "@/lib/padron/grado-alumno";
import { alumnoRequiereCarrera } from "@/lib/padron/requiere-carrera";
import type { TipoDocumentoClave } from "@/lib/nombre-archivo";
import { confirmarAccionDestructiva } from "@/lib/orientador/confirmar-accion-destructiva";
import { DURACION_MENSAJE_EMERGENTE_MS } from "@/lib/ui/duracion-mensaje-emergente-ms";

type AlumnoFila = {
	padronId: string;
	nombreCompleto: string;
	gradoAlumno: string | null;
	gradoMostrado: string;
	carreraId: string | null;
	carreraNombre: string | null;
	carreraCodigo: string | null;
	/** Solo a partir de 2.° grado; null en 1.° o sin registrar. */
	matricula: string | null;
	cuentaId: string | null;
	tieneCuenta: boolean;
	documentosSubidos: number;
};

type CarreraCat = { id: string; codigo: string; nombre: string };

type GrupoInfo = {
	id: string;
	grado: string;
	grupo: string;
	fechaLimiteEntrega: string | null;
	tieneToken?: boolean;
	institucionGrupoId?: string | null;
};

type OpcionGrupo = {
	id: string;
	etiqueta: string;
};

type DocExpedienteModal = {
	tipo: string;
	etiqueta: string;
	estado: EstadoEntregaDocumentoUi;
	motivoRechazo: string | null;
	puedeDescargar: boolean;
	esAdjuntoOrientador: boolean;
};

type AccionesModalState = {
	alumno: AlumnoFila;
	pestana: "expediente" | "datos";
	cargandoExpediente: boolean;
	errorExpediente: string;
	documentos: DocExpedienteModal[];
	documentosExtras: DocExpedienteModal[];
};

type LogFila = {
	id: string;
	creado_en: string;
	actor_tipo: string;
	actor_etiqueta: string;
	accion: string;
	entidad: string;
	entidad_id: string | null;
	detalle: unknown;
	origen: string;
};

function logPerteneceAGrupo(
	reg: LogFila,
	grupoTokenId: string,
	padronIdsEnGrupo: Set<string>,
): boolean {
	const d = reg.detalle as Record<string, unknown> | null;
	if (d && d.grupo_token_id === grupoTokenId) {
		return true;
	}
	if (d && Array.isArray(d.padron_ids)) {
		for (const id of d.padron_ids) {
			if (typeof id === "string" && padronIdsEnGrupo.has(id)) {
				return true;
			}
		}
	}
	if (reg.entidad === "padron_alumnos" && reg.entidad_id && padronIdsEnGrupo.has(reg.entidad_id)) {
		return true;
	}
	if (reg.entidad === "grupo_tokens" && reg.entidad_id === grupoTokenId) {
		return true;
	}
	return false;
}

function textoEstadoDoc(e: EstadoEntregaDocumentoUi, motivo: string | null): string {
	switch (e) {
		case "pendiente_carga":
			return "Falta subir";
		case "pendiente_revision_manual":
			return "En revisión";
		case "validado":
			return "Validado";
		case "rechazado":
			return motivo ? `Rechazado: ${motivo}` : "Rechazado";
		default:
			return String(e);
	}
}

function nombresDesdeCsv(texto: string): string[] {
	const lineas = texto
		.split(/\r?\n/)
		.map((l) => l.trim())
		.filter((l) => l.length > 0);
	if (lineas.length === 0) {
		return [];
	}
	const primera = lineas[0].toLowerCase();
	const tieneEncabezado =
		primera.includes("nombre") ||
		primera.includes("alumno") ||
		primera.includes("padrón") ||
		primera.includes("padron");
	const datos = tieneEncabezado ? lineas.slice(1) : lineas;
	const salida: string[] = [];
	for (const linea of datos) {
		const partes = linea.split(/[,;\t]/).map((p) => p.trim().replace(/^["']|["']$/g, ""));
		const nombre = (partes[0] ?? "").trim();
		if (nombre) {
			salida.push(nombre);
		}
	}
	return salida;
}

export default function OrientadorGrupoAlumnosPage() {
	const router = useRouter();
	const params = useParams();
	const grupoTokenId = typeof params.grupoTokenId === "string" ? params.grupoTokenId : "";

	const [grupo, setGrupo] = useState<GrupoInfo | null>(null);
	const [alumnos, setAlumnos] = useState<AlumnoFila[]>([]);
	const [cargando, setCargando] = useState(true);
	const [error, setError] = useState("");
	const [mensaje, setMensaje] = useState("");

	const [opcionesGrupos, setOpcionesGrupos] = useState<OpcionGrupo[]>([]);
	const [fechaDraft, setFechaDraft] = useState("");
	const [fechaGuardando, setFechaGuardando] = useState(false);

	const [nuevoNombre, setNuevoNombre] = useState("");
	const [agregarCargando, setAgregarCargando] = useState(false);
	const [csvCargando, setCsvCargando] = useState(false);

	const [nombresEdit, setNombresEdit] = useState<Record<string, string>>({});
	const [gradoSeleccion, setGradoSeleccion] = useState<Record<string, string>>({});
	const [carreraSeleccion, setCarreraSeleccion] = useState<Record<string, string>>({});
	const [matriculaEdit, setMatriculaEdit] = useState<Record<string, string>>({});
	const [carrerasCatalogo, setCarrerasCatalogo] = useState<CarreraCat[]>([]);
	const [moverSeleccion, setMoverSeleccion] = useState<Record<string, string>>({});
	const [filaTrabajo, setFilaTrabajo] = useState<string | null>(null);
	const [accionesModal, setAccionesModal] = useState<AccionesModalState | null>(null);
	const [subiendoTipo, setSubiendoTipo] = useState<string | null>(null);
	const inputAdjuntoRef = useRef<HTMLInputElement>(null);
	const [etiquetaAdjuntoDraft, setEtiquetaAdjuntoDraft] = useState("");

	/** Partición de lista por grado mostrado (evita mezclar 1.°, 2.°, etc. en la misma vista). */
	const [gradoVista, setGradoVista] = useState("");
	const [carreraMasivaSel, setCarreraMasivaSel] = useState("");
	const [carreraMasivaCargando, setCarreraMasivaCargando] = useState(false);
	const [matriculaXlsxCargando, setMatriculaXlsxCargando] = useState(false);
	const [modalMatriculasAbierto, setModalMatriculasAbierto] = useState(false);
	const [matriculaModalDraft, setMatriculaModalDraft] = useState<Record<string, string>>({});
	const [matriculaModalGuardando, setMatriculaModalGuardando] = useState(false);

	const [gradoMasivoDraft, setGradoMasivoDraft] = useState("1");
	const [gradoMasivoCargando, setGradoMasivoCargando] = useState(false);

	const [filtroNombreAlumno, setFiltroNombreAlumno] = useState("");
	const [modalLogsAbierto, setModalLogsAbierto] = useState(false);
	const [logsSoloEsteGrupo, setLogsSoloEsteGrupo] = useState(true);
	const [logsCargando, setLogsCargando] = useState(false);
	const [logsError, setLogsError] = useState("");
	const [logsRegistros, setLogsRegistros] = useState<LogFila[]>([]);

	const padronIdsEnGrupo = useMemo(
		() => new Set(alumnos.map((a) => a.padronId)),
		[alumnos],
	);

	/** Incluye 1.°–6.° aunque no haya alumnos en ese grado (antes solo salían grados con filas en padrón). */
	const gradosDisponibles = useMemo(() => {
		const u = new Set<string>();
		for (let g = 1; g <= GRADO_ESCOLAR_MAX; g += 1) {
			u.add(String(g));
		}
		for (const a of alumnos) {
			const g = String(a.gradoMostrado ?? "").trim();
			if (g) {
				u.add(g);
			}
		}
		const arr = [...u].sort((a, b) => {
			const na = Number.parseInt(a, 10);
			const nb = Number.parseInt(b, 10);
			const aNum = /^\d+$/.test(a) && !Number.isNaN(na);
			const bNum = /^\d+$/.test(b) && !Number.isNaN(nb);
			if (aNum && bNum) {
				return na - nb;
			}
			if (aNum) {
				return -1;
			}
			if (bNum) {
				return 1;
			}
			return a.localeCompare(b, "es");
		});
		return arr;
	}, [alumnos]);

	useEffect(() => {
		if (gradosDisponibles.length === 0) {
			return;
		}
		const invalid =
			gradoVista === "" || gradoVista === "todos" || !gradosDisponibles.includes(gradoVista);
		if (invalid) {
			setGradoVista(gradosDisponibles[0]);
		}
	}, [gradoVista, gradosDisponibles]);

	useEffect(() => {
		setFiltroNombreAlumno("");
		setCarreraMasivaSel("");
	}, [gradoVista]);

	useEffect(() => {
		if (!mensaje.trim()) {
			return;
		}
		const id = window.setTimeout(() => setMensaje(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [mensaje]);

	useEffect(() => {
		if (!error.trim()) {
			return;
		}
		const id = window.setTimeout(() => setError(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [error]);

	useEffect(() => {
		if (!logsError.trim()) {
			return;
		}
		const id = window.setTimeout(() => setLogsError(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [logsError]);

	const alumnosPorGradoVista = useMemo(() => {
		if (gradoVista === "" || !gradosDisponibles.includes(gradoVista)) {
			return [];
		}
		return alumnos.filter((a) => a.gradoMostrado === gradoVista);
	}, [alumnos, gradoVista, gradosDisponibles]);

	const alumnosParaMatricula = useMemo(
		() => alumnosPorGradoVista.filter((a) => alumnoRequiereCarrera(a.gradoMostrado)),
		[alumnosPorGradoVista],
	);
	const carreraMasivaActual = useMemo(() => {
		if (alumnosParaMatricula.length === 0) {
			return { valorSugerido: "", texto: "" };
		}
		const ids = [...new Set(alumnosParaMatricula.map((a) => (a.carreraId ?? "").trim()))];
		if (ids.length !== 1) {
			return { valorSugerido: "", texto: "Actual en este grado: carreras mezcladas" };
		}
		const unicoId = ids[0];
		if (unicoId === "") {
			return { valorSugerido: "__limpiar__", texto: "Actual en este grado: sin carrera asignada" };
		}
		const nombreCatalogo = carrerasCatalogo.find((x) => x.id === unicoId)?.nombre ?? "";
		const nombreFila = alumnosParaMatricula.find((a) => (a.carreraId ?? "").trim() === unicoId)?.carreraNombre ?? "";
		const nombre = nombreCatalogo || nombreFila || "Carrera asignada";
		return { valorSugerido: unicoId, texto: `Actual en este grado: ${nombre}` };
	}, [alumnosParaMatricula, carrerasCatalogo]);
	const carreraMasivaNombreSeleccionado = useMemo(() => {
		if (carreraMasivaSel === "__limpiar__") {
			return "Quitar carrera (lote)";
		}
		if (carreraMasivaSel === "") {
			return "";
		}
		const c = carrerasCatalogo.find((x) => x.id === carreraMasivaSel);
		return c?.nombre ?? "";
	}, [carreraMasivaSel, carrerasCatalogo]);
	const carreraMasivaDeshabilitada = alumnosParaMatricula.length === 0;
	const ocultarSeccionesCarreraMatricula = alumnosParaMatricula.length === 0;

	useEffect(() => {
		if (carreraMasivaSel !== "") {
			return;
		}
		if (carreraMasivaActual.valorSugerido === "") {
			return;
		}
		setCarreraMasivaSel(carreraMasivaActual.valorSugerido);
	}, [carreraMasivaSel, carreraMasivaActual]);

	const alumnosFiltrados = useMemo(() => {
		const q = filtroNombreAlumno.trim().toLowerCase();
		if (q === "") {
			return alumnosPorGradoVista;
		}
		return alumnosPorGradoVista.filter((a) => a.nombreCompleto.toLowerCase().includes(q));
	}, [alumnosPorGradoVista, filtroNombreAlumno]);

	const logsRegistrosMostrados = useMemo(() => {
		if (!logsSoloEsteGrupo || !grupoTokenId) {
			return logsRegistros;
		}
		return logsRegistros.filter((r) => logPerteneceAGrupo(r, grupoTokenId, padronIdsEnGrupo));
	}, [logsRegistros, logsSoloEsteGrupo, grupoTokenId, padronIdsEnGrupo]);

	async function abrirModalHistorial() {
		setModalLogsAbierto(true);
		setLogsError("");
		setLogsCargando(true);
		try {
			const res = await fetch("/api/orientador/logs", { credentials: "include" });
			const data = (await res.json()) as { ok?: boolean; registros?: LogFila[]; error?: string };
			if (!res.ok) {
				setLogsError(data.error ?? "No se pudo cargar el historial");
				setLogsRegistros([]);
				return;
			}
			setLogsRegistros(data.registros ?? []);
		} catch {
			setLogsError("Error de red");
			setLogsRegistros([]);
		} finally {
			setLogsCargando(false);
		}
	}

	const cargar = useCallback(async () => {
		if (!grupoTokenId) {
			return;
		}
		setCargando(true);
		setError("");
		try {
			const res = await fetch(`/api/orientador/grupo/${grupoTokenId}/alumnos`, {
				credentials: "include",
			});
			const data = (await res.json()) as {
				grupo?: GrupoInfo;
				alumnos?: AlumnoFila[];
				error?: string;
			};
			if (!res.ok) {
				setError(data.error ?? "Error");
				setGrupo(null);
				setAlumnos([]);
				return;
			}
			const g = data.grupo ?? null;
			const lista = data.alumnos ?? [];
			setGrupo(g);
			setAlumnos(lista);
			if (g) {
				if (lista.length > 0) {
					const primero = lista[0].gradoMostrado;
					const mismoGrado = lista.every((a) => a.gradoMostrado === primero);
					setGradoMasivoDraft(
						mismoGrado ? primero : String(g.grado ?? "1").trim() || "1",
					);
				} else {
					setGradoMasivoDraft(String(g.grado ?? "1").trim() || "1");
				}
			}
			if (g?.fechaLimiteEntrega) {
				setFechaDraft(g.fechaLimiteEntrega.slice(0, 10));
			} else {
				setFechaDraft("");
			}
		} catch {
			setError("Error de red");
			setAlumnos([]);
		} finally {
			setCargando(false);
		}
	}, [grupoTokenId]);

	useEffect(() => {
		void cargar();
	}, [cargar]);

	useEffect(() => {
		void (async () => {
			try {
				const rc = await fetch("/api/orientador/carreras", { credentials: "include" });
				const dc = (await rc.json()) as { carreras?: CarreraCat[] };
				if (rc.ok) {
					setCarrerasCatalogo(dc.carreras ?? []);
				}
			} catch {
				setCarrerasCatalogo([]);
			}
		})();
	}, []);

	useEffect(() => {
		void (async () => {
			try {
				const r = await fetch("/api/orientador/grupos", { credentials: "include" });
				const d = (await r.json()) as {
					grupos?: {
						id: string | null;
						institucionGrupoId: string | null;
						grado: string;
						grupo: string;
						claveAcceso: string;
					}[];
				};
				setOpcionesGrupos(
					(d.grupos ?? [])
						.filter((g) => {
							const idM = g.id ?? g.institucionGrupoId;
							return Boolean(idM) && Number.parseInt(String(g.grado ?? "").trim(), 10) === 1;
						})
						.map((g) => ({
							id: (g.id ?? g.institucionGrupoId) as string,
							etiqueta: `${g.grado} · Grupo ${g.grupo} — ${g.claveAcceso || "(sin clave)"}`,
						})),
				);
			} catch {
				setOpcionesGrupos([]);
			}
		})();
	}, []);

	useEffect(() => {
		const m: Record<string, string> = {};
		const g: Record<string, string> = {};
		const c: Record<string, string> = {};
		const mat: Record<string, string> = {};
		for (const a of alumnos) {
			m[a.padronId] = a.nombreCompleto;
			g[a.padronId] =
				a.gradoAlumno != null && String(a.gradoAlumno).trim() !== ""
					? String(a.gradoAlumno).trim()
					: "__token__";
			c[a.padronId] =
				a.carreraId != null && String(a.carreraId).trim() !== ""
					? String(a.carreraId).trim()
					: "__sin__";
			mat[a.padronId] = a.matricula ?? "";
		}
		setNombresEdit(m);
		setGradoSeleccion(g);
		setCarreraSeleccion(c);
		setMatriculaEdit(mat);
	}, [alumnos]);

	async function aplicarGradoMasivoATodos() {
		if (!grupoTokenId || !grupo) {
			return;
		}
		const total = alumnos.length;
		const gNum = Number.parseInt(gradoMasivoDraft, 10);
		const avisoToken =
			gNum >= 2
				? " A partir de 2.° el acceso con la clave de grupo deja de funcionar (el token queda inactivo para alumnos)."
				: "";
		const ok = confirmarAccionDestructiva(
			total > 0
				? `Se pondrá el grado ${gradoMasivoDraft}.° en el padrón de los ${total} alumno(s) activo(s) de este grupo. En 1.° se quitan carrera y matrícula.${avisoToken} ¿Continuar?`
				: `No hay alumnos activos en el padrón; igual se guardará el grado ${gradoMasivoDraft}.° para cuando agregues alumnos (recomendación: usa el mismo grado que el curso real).${avisoToken} ¿Continuar?`,
		);
		if (!ok) {
			return;
		}
		setGradoMasivoCargando(true);
		setMensaje("");
		setError("");
		try {
			const res = await fetch(`/api/orientador/grupo/${grupoTokenId}/grado-masivo`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ grado: gradoMasivoDraft }),
			});
			const data = (await res.json()) as {
				error?: string;
				actualizados?: number;
				grado?: string;
				tokenInactivoPorGrado?: boolean;
				tokenEliminado?: boolean;
				institucionGrupoId?: string;
			};
			if (!res.ok) {
				setError(data.error ?? "No se pudo actualizar el grado");
				return;
			}
			if (data.tokenEliminado === true && data.institucionGrupoId) {
				setMensaje(
					`Grupo pasado a ${data.grado ?? gradoMasivoDraft}.°: la fila de token se eliminó; el grupo queda solo en el catálogo (institucion_grupos).`,
				);
				router.replace(`/orientador/panel/grupo/${data.institucionGrupoId}`);
				return;
			}
			const extra =
				data.tokenInactivoPorGrado === true
					? " La clave de acceso ya no sirve para entrar (grado ≥2)."
					: "";
			setMensaje(
				`Grado del grupo aplicado: ${data.grado ?? gradoMasivoDraft}.° — ${data.actualizados ?? 0} alumno(s) actualizado(s) en el padrón.${extra}`,
			);
			await cargar();
		} catch {
			setError("Error de red al aplicar el grado");
		} finally {
			setGradoMasivoCargando(false);
		}
	}

	async function guardarFechaLimite(valorExplicito?: string | null) {
		if (!grupoTokenId || grupo?.tieneToken === false) {
			return;
		}
		setFechaGuardando(true);
		setMensaje("");
		setError("");
		const fechaEnvio =
			valorExplicito !== undefined
				? valorExplicito === null || valorExplicito === ""
					? null
					: valorExplicito.trim()
				: fechaDraft.trim() === ""
					? null
					: fechaDraft.trim();
		try {
			const res = await fetch("/api/orientador/grupo-fecha-limite", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					grupoTokenId,
					fechaLimiteEntrega: fechaEnvio,
				}),
			});
			const data = (await res.json()) as { error?: string; fechaLimiteEntrega?: string | null };
			if (!res.ok) {
				setError(data.error ?? "No se pudo guardar la fecha");
				return;
			}
			if (fechaEnvio == null) {
				setFechaDraft("");
			}
			setMensaje("Fecha límite actualizada.");
			await cargar();
		} catch {
			setError("Error de red al guardar la fecha");
		} finally {
			setFechaGuardando(false);
		}
	}

	async function agregarUnAlumno() {
		const nombre = nuevoNombre.trim().replace(/\s+/g, " ");
		if (!nombre || !grupoTokenId) {
			return;
		}
		setAgregarCargando(true);
		setMensaje("");
		setError("");
		try {
			const res = await fetch(`/api/orientador/grupo/${grupoTokenId}/alumnos`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ nombreCompleto: nombre }),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setError(data.error ?? "No se pudo agregar");
				return;
			}
			setNuevoNombre("");
			setMensaje("Alumno agregado al padrón.");
			await cargar();
		} catch {
			setError("Error de red");
		} finally {
			setAgregarCargando(false);
		}
	}

	async function importarCsv(e: React.ChangeEvent<HTMLInputElement>) {
		const archivo = e.target.files?.[0];
		e.target.value = "";
		if (!archivo || !grupoTokenId) {
			return;
		}
		setCsvCargando(true);
		setMensaje("");
		setError("");
		try {
			const texto = await archivo.text();
			const lista = nombresDesdeCsv(texto);
			if (lista.length === 0) {
				setError("No se encontraron nombres en el archivo.");
				return;
			}
			const res = await fetch(`/api/orientador/grupo/${grupoTokenId}/alumnos`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ nombres: lista }),
			});
			const data = (await res.json()) as { error?: string; unicosEnviados?: number };
			if (!res.ok) {
				setError(data.error ?? "No se pudo importar");
				return;
			}
			setMensaje(
				`Importación CSV: ${lista.length} fila(s) leída(s); ${data.unicosEnviados ?? lista.length} nombre(s) únicos enviados (duplicados omitidos).`,
			);
			await cargar();
		} catch {
			setError("No se pudo leer el CSV");
		} finally {
			setCsvCargando(false);
		}
	}

	async function guardarNombrePadron(padronId: string) {
		const nombre = (nombresEdit[padronId] ?? "").trim().replace(/\s+/g, " ");
		if (!nombre) {
			setError("El nombre no puede quedar vacío.");
			return;
		}
		setFilaTrabajo(padronId);
		setMensaje("");
		setError("");
		try {
			const res = await fetch(`/api/orientador/padron/${padronId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ nombreCompleto: nombre }),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setError(data.error ?? "No se pudo guardar el nombre");
				return;
			}
			setMensaje("Nombre actualizado.");
			await cargar();
		} catch {
			setError("Error de red");
		} finally {
			setFilaTrabajo(null);
		}
	}

	async function guardarGradoPadron(padronId: string) {
		const sel = gradoSeleccion[padronId] ?? "__token__";
		setFilaTrabajo(padronId);
		setMensaje("");
		setError("");
		try {
			const res = await fetch(`/api/orientador/padron/${padronId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					gradoAlumno: sel === "__token__" ? null : sel,
				}),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setError(data.error ?? "No se pudo guardar el grado");
				return;
			}
			setMensaje("Grado actualizado.");
			await cargar();
		} catch {
			setError("Error de red");
		} finally {
			setFilaTrabajo(null);
		}
	}

	async function guardarCarreraYMatriculaPadron(padronId: string, gradoMostrado: string) {
		if (!alumnoRequiereCarrera(gradoMostrado)) {
			return;
		}
		const sel = carreraSeleccion[padronId] ?? "__sin__";
		const mat = (matriculaEdit[padronId] ?? "").trim();
		setFilaTrabajo(padronId);
		setMensaje("");
		setError("");
		try {
			const res = await fetch(`/api/orientador/padron/${padronId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					carreraId: sel === "__sin__" ? null : sel,
					matricula: mat === "" ? null : mat,
				}),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setError(data.error ?? "No se pudo guardar carrera o matrícula");
				return;
			}
			setMensaje("Carrera y matrícula actualizadas.");
			await cargar();
		} catch {
			setError("Error de red");
		} finally {
			setFilaTrabajo(null);
		}
	}

	async function moverPadron(padronId: string) {
		const destinoId = (moverSeleccion[padronId] ?? "").trim();
		if (!destinoId || destinoId === grupoTokenId) {
			setError("Elige otro grupo para mover.");
			return;
		}
		setFilaTrabajo(padronId);
		setMensaje("");
		setError("");
		try {
			const res = await fetch(`/api/orientador/padron/${padronId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ grupoTokenIdDestino: destinoId }),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setError(data.error ?? "No se pudo mover");
				return;
			}
			setMensaje("Alumno movido de grupo.");
			setMoverSeleccion((prev) => {
				const n = { ...prev };
				delete n[padronId];
				return n;
			});
			await cargar();
		} catch {
			setError("Error de red");
		} finally {
			setFilaTrabajo(null);
		}
	}

	async function aplicarCarreraMasiva() {
		if (!grupoTokenId) {
			return;
		}
		if (carreraMasivaDeshabilitada) {
			setError("En esta vista no hay alumnos de 2.° grado o superior para aplicar carrera.");
			return;
		}
		if (carreraMasivaSel === "") {
			setError("Elige una carrera o «Quitar carrera (lote)».");
			return;
		}
		const carreraId = carreraMasivaSel === "__limpiar__" ? null : carreraMasivaSel;
		setCarreraMasivaCargando(true);
		setMensaje("");
		setError("");
		try {
			const res = await fetch(`/api/orientador/grupo/${grupoTokenId}/carrera-masiva`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					carreraId,
					gradoMostradoFiltro: gradoVista,
				}),
			});
			const d = (await res.json()) as {
				error?: string;
				actualizados?: number;
				mensaje?: string;
			};
			if (!res.ok) {
				setError(d.error ?? "No se pudo aplicar la carrera");
				return;
			}
			setMensaje(
				d.mensaje ??
					`Carrera actualizada en ${d.actualizados ?? 0} alumno(s) (2.° grado o superior).`,
			);
			await cargar();
		} catch {
			setError("Error de red");
		} finally {
			setCarreraMasivaCargando(false);
		}
	}

	function abrirModalMatriculas() {
		const m: Record<string, string> = {};
		for (const a of alumnosParaMatricula) {
			m[a.padronId] = matriculaEdit[a.padronId] ?? a.matricula ?? "";
		}
		setMatriculaModalDraft(m);
		setModalMatriculasAbierto(true);
	}

	async function guardarMatriculasModal() {
		if (!grupoTokenId) {
			return;
		}
		setMatriculaModalGuardando(true);
		setMensaje("");
		setError("");
		try {
			const actualizaciones = alumnosParaMatricula.map((a) => {
				const t = (matriculaModalDraft[a.padronId] ?? "").trim();
				return {
					padronId: a.padronId,
					matricula: t === "" ? null : t,
				};
			});
			const res = await fetch(`/api/orientador/grupo/${grupoTokenId}/matriculas`, {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ actualizaciones }),
			});
			const d = (await res.json()) as {
				error?: string;
				actualizados?: number;
				omitidas?: number;
			};
			if (!res.ok) {
				setError(d.error ?? "No se pudieron guardar las matrículas");
				return;
			}
			setMensaje(
				`Matrículas guardadas: ${d.actualizados ?? 0}. Registros omitidos: ${d.omitidas ?? 0}.`,
			);
			setModalMatriculasAbierto(false);
			await cargar();
		} catch {
			setError("Error de red");
		} finally {
			setMatriculaModalGuardando(false);
		}
	}

	async function importarMatriculasXlsx(e: React.ChangeEvent<HTMLInputElement>) {
		const archivo = e.target.files?.[0];
		e.target.value = "";
		if (!archivo || !grupoTokenId) {
			return;
		}
		if (!archivo.name.toLowerCase().endsWith(".xlsx")) {
			setError("El archivo debe ser .xlsx");
			return;
		}
		setMatriculaXlsxCargando(true);
		setMensaje("");
		setError("");
		try {
			const fd = new FormData();
			fd.set("archivo", archivo);
			const res = await fetch(`/api/orientador/grupo/${grupoTokenId}/matriculas`, {
				method: "POST",
				body: fd,
				credentials: "include",
			});
			const d = (await res.json()) as {
				error?: string;
				resumen?: {
					actualizados: number;
					omitidas: number;
					sinCoincidencia: number;
					ambiguos: number;
					gradoInvalido: number;
				};
			};
			if (!res.ok) {
				setError(d.error ?? "No se pudo importar");
				return;
			}
			const r = d.resumen;
			setMensaje(
				r
					? `Matrículas (XLSX): ${r.actualizados} guardada(s). Sin coincidencia: ${r.sinCoincidencia}. Ambiguos (nombre duplicado): ${r.ambiguos}. Grado 1 (omitidos): ${r.gradoInvalido}. Otras omitidas: ${r.omitidas}.`
					: "Importación de matrículas completada.",
			);
			await cargar();
		} catch {
			setError("Error de red al importar matrículas");
		} finally {
			setMatriculaXlsxCargando(false);
		}
	}

	async function archivarUnAlumno(padronId: string, etiqueta: string) {
		if (
			!confirmarAccionDestructiva(
				`Vas a enviar a archivo muerto el expediente de «${etiqueta}». Dejará de aparecer en este grupo y el alumno no podrá entrar hasta que un orientador lo reactive (los datos se conservan).`,
			)
		) {
			return;
		}
		setFilaTrabajo(padronId);
		setMensaje("");
		setError("");
		try {
			const res = await fetch("/api/orientador/archivo-muerto/archivar", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ padronIds: [padronId] }),
			});
			const data = (await res.json()) as { error?: string; archivados?: number };
			if (!res.ok) {
				setError(data.error ?? "No se pudo archivar");
				return;
			}
			setMensaje(`Archivado (${data.archivados ?? 1}).`);
			await cargar();
			setAccionesModal((m) => (m?.alumno.padronId === padronId ? null : m));
		} catch {
			setError("Error de red");
		} finally {
			setFilaTrabajo(null);
		}
	}

	async function eliminarPadron(padronId: string, etiqueta: string) {
		if (
			!confirmarAccionDestructiva(
				`Vas a quitar del padrón a «${etiqueta}». Si tenía cuenta web y expediente en el sistema, esa información asociada se eliminará. Esta acción es distinta del archivo muerto.`,
			)
		) {
			return;
		}
		setFilaTrabajo(padronId);
		setMensaje("");
		setError("");
		try {
			const res = await fetch(`/api/orientador/padron/${padronId}`, {
				method: "DELETE",
				credentials: "include",
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setError(data.error ?? "No se pudo eliminar");
				return;
			}
			setMensaje("Registro eliminado del padrón.");
			await cargar();
			setAccionesModal((m) => (m?.alumno.padronId === padronId ? null : m));
		} catch {
			setError("Error de red");
		} finally {
			setFilaTrabajo(null);
		}
	}

	useEffect(() => {
		setAccionesModal((prev) => {
			if (!prev) {
				return prev;
			}
			const act = alumnos.find((x) => x.padronId === prev.alumno.padronId);
			if (!act) {
				return prev;
			}
			return { ...prev, alumno: act };
		});
	}, [alumnos]);

	const cargarExpedienteParaModal = useCallback(async (cuentaId: string, padronEsperado: string) => {
		try {
			const res = await fetch(`/api/orientador/expediente/${cuentaId}`, {
				credentials: "include",
			});
			const d = (await res.json()) as {
				documentos?: {
					tipo: string;
					etiqueta: string;
					estado: EstadoEntregaDocumentoUi;
					motivoRechazo: string | null;
					puedeDescargar: boolean;
				}[];
				documentosExtras?: {
					tipo: string;
					etiqueta: string;
					estado: EstadoEntregaDocumentoUi;
					motivoRechazo: string | null;
					puedeDescargar: boolean;
				}[];
				error?: string;
			};
			setAccionesModal((prev) => {
				if (!prev || prev.alumno.padronId !== padronEsperado) {
					return prev;
				}
				if (!res.ok) {
					return {
						...prev,
						cargandoExpediente: false,
						errorExpediente: d.error ?? "Error al cargar expediente",
						documentos: [],
						documentosExtras: [],
					};
				}
				const docs: DocExpedienteModal[] = (d.documentos ?? []).map((x) => ({
					...x,
					esAdjuntoOrientador: false,
				}));
				const extras: DocExpedienteModal[] = (d.documentosExtras ?? []).map((x) => ({
					...x,
					esAdjuntoOrientador: true,
				}));
				return {
					...prev,
					cargandoExpediente: false,
					errorExpediente: "",
					documentos: docs,
					documentosExtras: extras,
				};
			});
		} catch {
			setAccionesModal((prev) => {
				if (!prev || prev.alumno.padronId !== padronEsperado) {
					return prev;
				}
				return {
					...prev,
					cargandoExpediente: false,
					errorExpediente: "Error de red",
					documentos: [],
					documentosExtras: [],
				};
			});
		}
	}, []);

	function abrirAcciones(a: AlumnoFila) {
		setEtiquetaAdjuntoDraft("");
		setAccionesModal({
			alumno: a,
			pestana: "expediente",
			cargandoExpediente: Boolean(a.cuentaId),
			errorExpediente: "",
			documentos: [],
			documentosExtras: [],
		});
		if (a.cuentaId) {
			void cargarExpedienteParaModal(a.cuentaId, a.padronId);
		}
	}

	async function subirDocumentoModal(
		cuentaId: string,
		padronId: string,
		tipo: TipoDocumentoClave,
		e: React.ChangeEvent<HTMLInputElement>,
	) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) {
			return;
		}
		setSubiendoTipo(tipo);
		setMensaje("");
		setError("");
		try {
			const fd = new FormData();
			fd.set("cuentaId", cuentaId);
			fd.set("tipoDocumento", tipo);
			fd.set("archivo", file);
			const res = await fetch("/api/orientador/subir-documento", {
				method: "POST",
				body: fd,
				credentials: "include",
			});
			const dato = (await res.json()) as { error?: string };
			if (!res.ok) {
				setError(dato.error ?? "No se pudo subir");
				return;
			}
			setMensaje("Archivo subido.");
			await cargar();
			await cargarExpedienteParaModal(cuentaId, padronId);
		} catch {
			setError("Error de red");
		} finally {
			setSubiendoTipo(null);
		}
	}

	async function onAdjuntoFileChange(cuentaId: string, padronId: string, e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) {
			return;
		}
		const etiqueta = etiquetaAdjuntoDraft.trim();
		if (!etiqueta) {
			setError("Escribe primero el nombre del documento.");
			return;
		}
		setSubiendoTipo("adjunto");
		setMensaje("");
		setError("");
		try {
			const fd = new FormData();
			fd.set("cuentaId", cuentaId);
			fd.set("etiqueta", etiqueta);
			fd.set("archivo", file);
			const res = await fetch("/api/orientador/documento/adjunto", {
				method: "POST",
				body: fd,
				credentials: "include",
			});
			const dato = (await res.json()) as { error?: string };
			if (!res.ok) {
				setError(dato.error ?? "No se pudo subir el adjunto");
				return;
			}
			setMensaje("Documento adicional agregado.");
			setEtiquetaAdjuntoDraft("");
			await cargar();
			await cargarExpedienteParaModal(cuentaId, padronId);
		} catch {
			setError("Error de red");
		} finally {
			setSubiendoTipo(null);
		}
	}

	async function eliminarAdjuntoModal(cuentaId: string, padronId: string, tipo: string, etiqueta: string) {
		if (
			!confirmarAccionDestructiva(
				`Vas a eliminar del storage el documento adicional «${etiqueta}». No podrás recuperarlo.`,
			)
		) {
			return;
		}
		setSubiendoTipo(tipo);
		setError("");
		try {
			const res = await fetch("/api/orientador/documento/adjunto", {
				method: "DELETE",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ cuentaId, tipoDocumento: tipo }),
			});
			const dato = (await res.json()) as { error?: string };
			if (!res.ok) {
				setError(dato.error ?? "No se pudo eliminar");
				return;
			}
			setMensaje("Adjunto eliminado.");
			await cargar();
			await cargarExpedienteParaModal(cuentaId, padronId);
		} catch {
			setError("Error de red");
		} finally {
			setSubiendoTipo(null);
		}
	}

	return (
		<div className="pb-10">
			<Link
				href="/orientador/panel"
				className="text-sm font-medium text-emerald-800 hover:underline"
			>
				← Todos los grupos
			</Link>

			{cargando ? (
				<p className="mt-6 text-slate-500">Cargando…</p>
			) : error && !grupo ? (
				<p className="mt-6 text-red-600">{error}</p>
			) : grupo ? (
				<>
					<h1 className="mt-4 text-2xl font-bold text-slate-900">Grupo {grupo.grupo}</h1>
					<p className="mt-1 text-sm text-slate-600">
						{gradosDisponibles.length === 0
							? "Sin alumnos en el padrón."
							: gradoVista !== "" && gradosDisponibles.includes(gradoVista)
								? `Vista: solo alumnos de Grado ${gradoVista}.`
								: "Elige un grado con las pestañas de abajo."}
					</p>
					{gradosDisponibles.length > 0 ? (
						<div className="mt-4 flex flex-wrap gap-2">
							{gradosDisponibles.map((g) => (
								<button
									key={g}
									type="button"
									onClick={() => setGradoVista(g)}
									className={`rounded-lg border px-3 py-1.5 text-sm font-medium tabular-nums transition ${
										gradoVista === g
											? "border-emerald-600 bg-emerald-600 text-white"
											: "border-slate-300 bg-white text-slate-800 hover:bg-slate-50"
									}`}
								>
									Grado {g}
								</button>
							))}
						</div>
					) : null}

					<div className="mt-4 rounded-xl border border-sky-200 bg-sky-50/90 p-4 text-sm text-sky-950 shadow-sm">
						<h2 className="font-semibold text-sky-900">Cambio de grado</h2>
						<p className="mt-1 text-xs leading-relaxed text-sky-900/90">
							Elige el <strong>grado escolar</strong> del curso actual. Se guarda en el padrón de{" "}
							<strong>todos los alumnos activos</strong>. Si pasas a <strong>2.° o más</strong>, el sistema marca el
							grupo como no apto para clave: <strong>la misma clave deja de permitir el acceso</strong> (como si el
							token ya no existiera para entrar). Si vuelves a <strong>1.°</strong>, el acceso por clave se restablece.
						</p>
						<div className="mt-3 flex flex-wrap items-end gap-3">
							<div>
								<label htmlFor="grado-masivo-grupo" className="block text-xs font-medium text-sky-900">
									Grado del grupo
								</label>
								<select
									id="grado-masivo-grupo"
									value={gradoMasivoDraft}
									onChange={(e) => setGradoMasivoDraft(e.target.value)}
									disabled={gradoMasivoCargando}
									className="mt-1 rounded-lg border border-sky-300 bg-white px-2 py-2 text-sm font-medium tabular-nums text-slate-900 outline-none focus:border-sky-500 focus:ring-1 focus:ring-sky-500 disabled:opacity-60"
								>
									{Array.from({ length: GRADO_ESCOLAR_MAX }, (_, i) => i + 1).map((n) => (
										<option key={n} value={String(n)}>
											{n}.°
										</option>
									))}
								</select>
							</div>
							<button
								type="button"
								disabled={gradoMasivoCargando}
								onClick={() => void aplicarGradoMasivoATodos()}
								className="rounded-lg border border-sky-700 bg-sky-700 px-4 py-2 text-sm font-semibold text-white shadow-sm transition hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-60"
							>
								{gradoMasivoCargando ? "Aplicando…" : "Aplicar a todos los alumnos"}
							</button>
						</div>
						<p className="mt-2 text-[11px] text-sky-800/85">
							Si eliges <strong>1.°</strong>, se limpian carrera y matrícula en el padrón y el token vuelve a valer para
							entrar. Puedes afinar el grado por alumno en <strong>Actualizar datos</strong>.
						</p>
					</div>

					<div className="mt-4 rounded-xl border border-amber-200 bg-amber-50/80 p-4 text-sm text-amber-950">
						<h2 className="font-semibold text-amber-900">Fecha límite del token (cierre de acceso)</h2>
						<p className="mt-1 text-xs text-amber-900/90">
							El día indicado es el último en que los alumnos pueden validar la clave y usar la sesión. Al día
							siguiente el token deja de funcionar (no borramos datos: solo se bloquea el acceso).
						</p>
						<div className="mt-3 flex flex-wrap items-end gap-3">
							<div>
								<label htmlFor="fecha-limite-grupo" className="block text-xs font-medium text-amber-900">
									Último día válido
								</label>
								<input
									id="fecha-limite-grupo"
									type="date"
									value={fechaDraft}
									onChange={(e) => setFechaDraft(e.target.value)}
									className="mt-1 rounded-lg border border-amber-300/80 bg-white px-2 py-1.5 text-sm text-slate-900"
								/>
							</div>
							<button
								type="button"
								disabled={fechaGuardando}
								onClick={() => void guardarFechaLimite()}
								className="rounded-lg border border-amber-700 bg-amber-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-amber-800 disabled:opacity-60"
							>
								{fechaGuardando ? "Guardando…" : "Guardar fecha"}
							</button>
							<button
								type="button"
								disabled={fechaGuardando}
								onClick={() => void guardarFechaLimite(null)}
								className="text-xs font-medium text-amber-800 underline hover:text-amber-950"
							>
								Quitar límite (sin cierre automático)
							</button>
						</div>
						<p className="mt-2 text-[11px] text-amber-900/80">
							Zona horaria del servidor para “hoy”: variable opcional{" "}
							<code className="rounded bg-white/60 px-1">AIDA_FECHA_LIMITE_ZONA</code> (p. ej.{" "}
							<code className="rounded bg-white/60 px-1">America/Mexico_City</code>).
						</p>
					</div>

					<div className="mt-6 rounded-xl border border-slate-200 bg-white p-4 shadow-sm">
						<h2 className="text-base font-semibold text-slate-900">Padrón del grupo</h2>
						<p className="mt-1 text-xs text-slate-600">
							Agrega o quita alumnos, corrige nombres o traslada a otro grupo (token). Desde Excel: guarda como
							CSV (UTF-8), una columna con el nombre o con encabezado «nombre» / «nombre_completo».
						</p>
						<div className="mt-3 flex flex-wrap items-end gap-3">
							<div className="min-w-[12rem] flex-1">
								<label htmlFor="nuevo-alumno-nombre" className="block text-xs font-medium text-slate-600">
									Nuevo alumno (manual)
								</label>
								<input
									id="nuevo-alumno-nombre"
									type="text"
									value={nuevoNombre}
									onChange={(e) => setNuevoNombre(e.target.value)}
									placeholder="Nombre completo"
									className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
								/>
							</div>
							<button
								type="button"
								disabled={agregarCargando}
								onClick={() => void agregarUnAlumno()}
								className="rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
							>
								{agregarCargando ? "…" : "Agregar"}
							</button>
							<div>
								<label htmlFor="csv-padron" className="block text-xs font-medium text-slate-600">
									Importar CSV
								</label>
								<input
									id="csv-padron"
									type="file"
									accept=".csv,text/csv,text/plain"
									disabled={csvCargando}
									onChange={(ev) => void importarCsv(ev)}
									className="mt-1 block text-sm text-slate-600 file:mr-2 file:rounded file:border-0 file:bg-slate-100 file:px-2 file:py-1 file:text-sm"
								/>
							</div>
						</div>
					</div>

					{!ocultarSeccionesCarreraMatricula ? <div className="mt-6 grid gap-4 lg:grid-cols-2">
						<div
							className={`rounded-xl border p-4 shadow-sm ${
								carreraMasivaDeshabilitada
									? "border-slate-200 bg-slate-100/90 opacity-70"
									: "border-violet-200 bg-violet-50/90"
							}`}
						>
							<h2 className="text-base font-semibold text-violet-950">Carrera para muchos alumnos</h2>
							<p className="mt-1 text-xs text-violet-900/90">
								Aplica la misma carrera a todos los alumnos en <strong>2.° grado o superior</strong> de este grupo.
								{gradoVista !== "" ? (
									<>
										{" "}
										Con la vista actual (<strong>Grado {gradoVista}</strong>) solo se actualizan los de ese grado.
									</>
								) : null}
								{carreraMasivaDeshabilitada ? (
									<>
										{" "}
										En la vista actual no hay alumnos elegibles, por eso esta sección está deshabilitada.
									</>
								) : null}
							</p>
							<div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap sm:items-end">
								<div className="min-w-[12rem] flex-1">
									<label htmlFor="carrera-masiva-sel" className="block text-xs font-medium text-violet-900">
										Carrera
									</label>
									<select
										id="carrera-masiva-sel"
										value={carreraMasivaSel}
										onChange={(e) => setCarreraMasivaSel(e.target.value)}
										disabled={carreraMasivaDeshabilitada || carreraMasivaCargando}
										className="mt-1 w-full rounded-lg border border-violet-200 bg-white px-2 py-2 text-sm"
									>
										<option value="">— Elegir —</option>
										<option value="__limpiar__">Quitar carrera (lote)</option>
										{carrerasCatalogo.map((cr) => (
											<option key={cr.id} value={cr.id}>
												{cr.nombre}
											</option>
										))}
									</select>
									{carreraMasivaNombreSeleccionado ? (
										<p className="mt-1 text-[11px] text-violet-800/90">
											Seleccionada: <strong>{carreraMasivaNombreSeleccionado}</strong>
										</p>
									) : null}
									{carreraMasivaActual.texto ? (
										<p className="mt-1 text-[11px] text-violet-700/90">{carreraMasivaActual.texto}</p>
									) : null}
								</div>
								<button
									type="button"
									disabled={carreraMasivaDeshabilitada || carreraMasivaCargando}
									onClick={() => void aplicarCarreraMasiva()}
									className="rounded-lg border border-violet-700 bg-violet-700 px-4 py-2 text-sm font-medium text-white hover:bg-violet-800 disabled:cursor-not-allowed disabled:opacity-60"
								>
									{carreraMasivaCargando ? "Aplicando…" : "Aplicar carrera"}
								</button>
							</div>
						</div>
						<div className="rounded-xl border border-sky-200 bg-sky-50/90 p-4 shadow-sm">
							<h2 className="text-base font-semibold text-sky-950">Matrículas (lote)</h2>
							<p className="mt-1 text-xs text-sky-900/90">
								<strong>XLSX:</strong> columnas <code className="rounded bg-white/80 px-1">nombreCompleto</code> (o{" "}
								<code className="rounded bg-white/80 px-1">nombre</code>) y{" "}
								<code className="rounded bg-white/80 px-1">matricula</code>. El nombre debe coincidir con el{" "}
								<strong>nombre del padrón</strong> (el mismo que el alumno escribe al entrar). Solo 2.° grado en adelante.{" "}
								<strong>Tabla:</strong> edita y guarda en bloque (según pestaña de grado).
							</p>
							<div className="mt-3 flex flex-wrap items-end gap-3">
								<div>
									<label htmlFor="matricula-xlsx-grupo" className="block text-xs font-medium text-sky-900">
										Importar Excel
									</label>
									<input
										id="matricula-xlsx-grupo"
										type="file"
										accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
										disabled={matriculaXlsxCargando}
										onChange={(ev) => void importarMatriculasXlsx(ev)}
										className="mt-1 block text-sm text-sky-900 file:mr-2 file:rounded file:border-0 file:bg-sky-200 file:px-2 file:py-1"
									/>
								</div>
								<button
									type="button"
									onClick={abrirModalMatriculas}
									disabled={alumnosParaMatricula.length === 0}
									className="rounded-lg border border-sky-700 bg-sky-700 px-4 py-2 text-sm font-medium text-white hover:bg-sky-800 disabled:cursor-not-allowed disabled:opacity-50"
								>
									Tabla de matrículas ({alumnosParaMatricula.length})
								</button>
							</div>
						</div>
					</div> : null}

					{mensaje ? (
						<p className="mt-3 rounded-md bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{mensaje}</p>
					) : null}
					{error && grupo ? (
						<p className="mt-3 rounded-md bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p>
					) : null}

					<div className="mt-5 grid gap-3 sm:grid-cols-3">
						<div className="rounded-xl border border-emerald-100 bg-emerald-50/90 px-4 py-3 text-sm text-emerald-950">
							<p className="font-semibold text-emerald-900">1. Lista del grupo</p>
							<p className="mt-1 text-xs text-emerald-900/85">
								Cada fila es un alumno. La línea pequeña resume grado, grupo, carrera (si aplica), matrícula (desde
								2.°) y documentos subidos.
							</p>
						</div>
						<div className="rounded-xl border border-sky-100 bg-sky-50/90 px-4 py-3 text-sm text-sky-950">
							<p className="font-semibold text-sky-900">2. Expediente</p>
							<p className="mt-1 text-xs text-sky-900/85">
								Pulsa <strong>Acciones</strong> → pestaña <strong>Expediente</strong>: ver o descargar PDFs, subir o
								reemplazar los cinco documentos y agregar citatorios u otros adjuntos.
							</p>
						</div>
						<div className="rounded-xl border border-violet-100 bg-violet-50/90 px-4 py-3 text-sm text-violet-950">
							<p className="font-semibold text-violet-900">3. Actualizar datos</p>
							<p className="mt-1 text-xs text-violet-900/85">
								Misma ventana → <strong>Actualizar datos</strong>: nombre, grado, desde 2.° <strong>carrera y
								matrícula</strong>, mover de grupo, baja a archivo muerto o quitar del padrón.
							</p>
						</div>
					</div>

					{alumnosPorGradoVista.length > 0 ? (
						<div className="mt-5 flex flex-col gap-3 px-2 sm:flex-row sm:flex-wrap sm:items-end sm:justify-between sm:px-0">
							<div className="min-w-0 max-w-xl flex-1">
								<label
									htmlFor="filtro-nombre-alumno-grupo"
									className="block text-xs font-medium text-slate-700"
								>
									Buscar por nombre
								</label>
								<div className="mt-1 flex flex-wrap items-center gap-2">
									<input
										id="filtro-nombre-alumno-grupo"
										type="search"
										autoComplete="off"
										placeholder="Escribe parte del nombre…"
										value={filtroNombreAlumno}
										onChange={(e) => setFiltroNombreAlumno(e.target.value)}
										className="min-w-0 flex-1 rounded-lg border border-slate-300 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-emerald-500 focus:ring-1 focus:ring-emerald-500"
									/>
									{filtroNombreAlumno.trim() !== "" ? (
										<button
											type="button"
											onClick={() => setFiltroNombreAlumno("")}
											className="shrink-0 rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-medium text-slate-700 hover:bg-slate-50"
										>
											Limpiar
										</button>
									) : null}
								</div>
								<p className="mt-1 text-[11px] text-slate-500">
									Mostrando{" "}
									<span className="font-semibold tabular-nums text-slate-700">{alumnosFiltrados.length}</span> de{" "}
									<span className="tabular-nums">{alumnosPorGradoVista.length}</span> alumno(s) en este grado.
								</p>
							</div>
							<button
								type="button"
								onClick={() => void abrirModalHistorial()}
								className="shrink-0 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
							>
								Historial / auditoría
							</button>
						</div>
					) : alumnos.length > 0 ? (
						<p className="mt-5 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-center text-sm text-slate-600">
							No hay alumnos en <strong>Grado {gradoVista}</strong> en este grupo. Cambia de pestaña o agrega alumnos
							con ese grado en sus datos.
						</p>
					) : (
						<div className="mt-5 flex justify-center px-2">
							<button
								type="button"
								onClick={() => void abrirModalHistorial()}
								className="rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm font-medium text-slate-800 shadow-sm hover:bg-slate-50"
							>
								Historial / auditoría
							</button>
						</div>
					)}

					<div className="mt-4 overflow-x-auto rounded-xl border border-slate-200 bg-white shadow-sm">
						<table className="w-full min-w-[280px] text-left text-sm">
							<thead className="border-b border-slate-200 bg-slate-50">
								<tr>
									<th className="px-4 py-3 font-semibold text-slate-600">Alumno</th>
									<th className="w-44 px-4 py-3 text-right font-semibold text-slate-600">Acciones</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100">
								{alumnos.length === 0 ? (
									<tr>
										<td colSpan={2} className="px-4 py-8 text-center text-slate-500">
											No hay alumnos en este grupo.
										</td>
									</tr>
								) : alumnosPorGradoVista.length === 0 ? (
									<tr>
										<td colSpan={2} className="px-4 py-8 text-center text-slate-500">
											No hay alumnos en la vista de grado seleccionada.
										</td>
									</tr>
								) : alumnosFiltrados.length === 0 ? (
									<tr>
										<td colSpan={2} className="px-4 py-8 text-center text-slate-600">
											Ningún alumno coincide con «{filtroNombreAlumno.trim()}».{" "}
											<button
												type="button"
												className="font-medium text-emerald-800 underline"
												onClick={() => setFiltroNombreAlumno("")}
											>
												Limpiar búsqueda
											</button>
										</td>
									</tr>
								) : (
									alumnosFiltrados.map((a) => (
										<tr key={a.padronId} className="hover:bg-emerald-50/20">
											<td className="px-4 py-3">
												<p className="font-medium text-slate-900">{a.nombreCompleto}</p>
												<p className="mt-0.5 text-xs text-slate-500">
													Grado {a.gradoMostrado} · Grupo {grupo.grupo}
													{a.carreraNombre ? <> · {a.carreraNombre}</> : null}
													{alumnoRequiereCarrera(a.gradoMostrado) && a.matricula ? (
														<> · Mat. {a.matricula}</>
													) : null}
													{a.cuentaId ? (
														<> · Docs {a.documentosSubidos}/5</>
													) : (
														<> · Sin cuenta web aún</>
													)}
												</p>
											</td>
											<td className="px-4 py-3 text-right align-middle">
												<button
													type="button"
													onClick={() => abrirAcciones(a)}
													className="rounded-lg border border-emerald-600 bg-emerald-600 px-4 py-2 text-sm font-medium text-white shadow-sm hover:bg-emerald-700"
												>
													Acciones
												</button>
											</td>
										</tr>
									))
								)}
							</tbody>
						</table>
					</div>
				</>
			) : null}

			{accionesModal ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 sm:p-4"
					role="presentation"
					onClick={() => setAccionesModal(null)}
				>
					<input
						ref={inputAdjuntoRef}
						type="file"
						className="hidden"
						accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
						onChange={(e) => {
							const c = accionesModal.alumno.cuentaId;
							if (c) {
								void onAdjuntoFileChange(c, accionesModal.alumno.padronId, e);
							}
						}}
					/>
					<div
						role="dialog"
						aria-modal="true"
						aria-labelledby="modal-acciones-titulo"
						className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-2xl border border-slate-200 bg-slate-50 shadow-2xl"
						onClick={(ev) => ev.stopPropagation()}
					>
						<div className="border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
							<h3 id="modal-acciones-titulo" className="text-lg font-bold text-slate-900">
								{accionesModal.alumno.nombreCompleto}
							</h3>
							<p className="mt-1 text-sm text-slate-600">
								Grupo {grupo?.grupo ?? "—"} · Grado {accionesModal.alumno.gradoMostrado}
								{accionesModal.alumno.carreraNombre ? (
									<> · {accionesModal.alumno.carreraNombre}</>
								) : null}
								{alumnoRequiereCarrera(accionesModal.alumno.gradoMostrado) &&
								accionesModal.alumno.matricula ? (
									<> · Matrícula {accionesModal.alumno.matricula}</>
								) : null}
								{accionesModal.alumno.cuentaId ? null : (
									<span className="block text-amber-800">
										Sin cuenta: el alumno debe entrar una vez con su clave para poder subir documentos aquí.
									</span>
								)}
							</p>
							<div className="mt-3 flex flex-wrap gap-2">
								<button
									type="button"
									onClick={() =>
										setAccionesModal((m) => (m ? { ...m, pestana: "expediente" } : m))
									}
									className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
										accionesModal.pestana === "expediente"
											? "bg-emerald-700 text-white"
											: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
									}`}
								>
									Expediente
								</button>
								<button
									type="button"
									onClick={() => setAccionesModal((m) => (m ? { ...m, pestana: "datos" } : m))}
									className={`rounded-lg px-3 py-1.5 text-sm font-medium ${
										accionesModal.pestana === "datos"
											? "bg-sky-700 text-white"
											: "border border-slate-300 bg-white text-slate-700 hover:bg-slate-50"
									}`}
								>
									Actualizar datos
								</button>
							</div>
						</div>

						<div className="p-4 sm:p-6">
							{accionesModal.pestana === "expediente" ? (
								<>
									{accionesModal.alumno.cuentaId ? (
										<>
											{accionesModal.cargandoExpediente ? (
												<p className="text-sm text-slate-500">Cargando documentos…</p>
											) : accionesModal.errorExpediente ? (
												<p className="text-sm text-red-600">{accionesModal.errorExpediente}</p>
											) : (
												<>
													<p className="mb-3 text-xs text-slate-600">
														Documentos del trámite: puedes ver, descargar o subir/reemplazar. Los{" "}
														<strong>documentos adicionales</strong> (citatorios, etc.) solo se pueden{" "}
														<strong>eliminar</strong> si los agregaste tú aquí.
													</p>
													<div className="flex flex-wrap gap-3">
														{accionesModal.documentos.map((doc) => {
															const cId = accionesModal.alumno.cuentaId as string;
															const q = `cuentaId=${encodeURIComponent(cId)}&tipo=${encodeURIComponent(doc.tipo)}`;
															const hrefVer = `/api/orientador/documento/descargar?${q}&inline=1`;
															const hrefDesc = `/api/orientador/documento/descargar?${q}`;
															const busy = subiendoTipo === doc.tipo;
															return (
																<div
																	key={doc.tipo}
																	className="flex w-[148px] shrink-0 flex-col rounded-xl border border-slate-200 bg-white p-3 shadow-sm"
																>
																	<p className="text-center text-[11px] font-semibold leading-tight text-slate-800">
																		{doc.etiqueta}
																	</p>
																	<p className="mt-1 min-h-[2rem] text-center text-[10px] text-slate-500">
																		{textoEstadoDoc(doc.estado, doc.motivoRechazo)}
																	</p>
																	<div className="mt-2 flex flex-wrap justify-center gap-1">
																		{doc.puedeDescargar ? (
																			<>
																				<a
																					href={hrefVer}
																					target="_blank"
																					rel="noreferrer"
																					className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
																					title="Ver"
																				>
																					Ver
																				</a>
																				<a
																					href={hrefDesc}
																					className="rounded-md border border-slate-200 px-2 py-1 text-[10px] font-medium text-slate-700 hover:bg-slate-50"
																					title="Descargar"
																				>
																					Descargar
																				</a>
																			</>
																		) : (
																			<span className="text-[10px] text-slate-400">Sin archivo</span>
																		)}
																	</div>
																	<label className="mt-2 cursor-pointer text-center">
																		<span className="text-[10px] font-medium text-emerald-700 underline">
																			{busy ? "Subiendo…" : "Subir / reemplazar"}
																		</span>
																		<input
																			type="file"
																			accept=".pdf,application/pdf,image/png,image/jpeg,image/webp"
																			className="hidden"
																			disabled={busy}
																			onChange={(ev) =>
																				void subirDocumentoModal(
																					cId,
																					accionesModal.alumno.padronId,
																					doc.tipo as TipoDocumentoClave,
																					ev,
																				)
																			}
																		/>
																	</label>
																</div>
															);
														})}
													</div>
													{accionesModal.documentosExtras.length > 0 ? (
														<div className="mt-6">
															<p className="mb-2 text-xs font-semibold text-slate-700">
																Documentos adicionales
															</p>
															<div className="flex flex-wrap gap-3">
																{accionesModal.documentosExtras.map((doc) => {
																	const cId = accionesModal.alumno.cuentaId as string;
																	const q = `cuentaId=${encodeURIComponent(cId)}&tipo=${encodeURIComponent(doc.tipo)}`;
																	const busy = subiendoTipo === doc.tipo;
																	return (
																		<div
																			key={doc.tipo}
																			className="flex w-[148px] shrink-0 flex-col rounded-xl border border-violet-200 bg-violet-50/50 p-3 shadow-sm"
																		>
																			<p className="text-center text-[11px] font-semibold leading-tight text-slate-800">
																				{doc.etiqueta}
																			</p>
																			<p className="mt-1 text-center text-[10px] text-slate-500">
																				{textoEstadoDoc(doc.estado, doc.motivoRechazo)}
																			</p>
																			<div className="mt-2 flex flex-wrap justify-center gap-1">
																				{doc.puedeDescargar ? (
																					<>
																						<a
																							href={`/api/orientador/documento/descargar?${q}&inline=1`}
																							target="_blank"
																							rel="noreferrer"
																							className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700"
																						>
																							Ver
																						</a>
																						<a
																							href={`/api/orientador/documento/descargar?${q}`}
																							className="rounded-md border border-slate-200 bg-white px-2 py-1 text-[10px] font-medium text-slate-700"
																						>
																							Descargar
																						</a>
																					</>
																				) : null}
																			</div>
																			<button
																				type="button"
																				disabled={busy}
																				onClick={() =>
																					void eliminarAdjuntoModal(
																						cId,
																						accionesModal.alumno.padronId,
																						doc.tipo,
																						doc.etiqueta,
																					)
																				}
																				className="mt-2 text-center text-[10px] font-medium text-red-700 underline disabled:opacity-50"
																			>
																				Eliminar
																			</button>
																		</div>
																	);
																})}
															</div>
														</div>
													) : null}
													<div className="mt-6 flex flex-col gap-3 border-t border-slate-200 pt-4 sm:flex-row sm:flex-wrap sm:items-end">
														<a
															href={`/api/orientador/expediente-zip?cuentaId=${encodeURIComponent(accionesModal.alumno.cuentaId)}`}
															className="inline-flex flex-1 items-center justify-center gap-2 rounded-xl border border-slate-700 bg-slate-800 px-4 py-3 text-sm font-medium text-white hover:bg-slate-900 sm:min-w-[10rem] sm:flex-none"
														>
															Descargar todo (ZIP)
														</a>
														<div className="flex min-w-0 flex-1 flex-col gap-2 sm:max-w-xs">
															<label htmlFor="adjunto-etiqueta" className="text-xs font-medium text-slate-600">
																Nombre del documento adicional (citatorio, etc.)
															</label>
															<input
																id="adjunto-etiqueta"
																type="text"
																value={etiquetaAdjuntoDraft}
																onChange={(ev) => setEtiquetaAdjuntoDraft(ev.target.value)}
																placeholder="Ej. Citatorio junta"
																maxLength={80}
																className="rounded-lg border border-slate-300 px-2 py-2 text-sm"
															/>
															{!etiquetaAdjuntoDraft.trim() ? (
																<p className="text-[11px] text-slate-500">
																	Escribe un nombre para activar «Agregar archivo» y elegir el archivo.
																</p>
															) : null}
															<button
																type="button"
																disabled={subiendoTipo === "adjunto" || !etiquetaAdjuntoDraft.trim()}
																title={
																	!etiquetaAdjuntoDraft.trim()
																		? "Escribe el nombre del documento primero"
																		: "Elegir archivo y subirlo"
																}
																onClick={() => {
																	if (!etiquetaAdjuntoDraft.trim()) {
																		return;
																	}
																	inputAdjuntoRef.current?.click();
																}}
																className="rounded-xl border border-emerald-600 bg-emerald-600 px-4 py-3 text-sm font-medium text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-45"
															>
																{subiendoTipo === "adjunto" ? "Subiendo…" : "Agregar archivo"}
															</button>
														</div>
														<Link
															href={`/orientador/panel/alumno/${accionesModal.alumno.cuentaId}`}
															className="inline-flex items-center justify-center rounded-xl border border-slate-300 bg-white px-4 py-3 text-sm font-medium text-emerald-800 hover:bg-slate-50"
														>
															Abrir expediente (detalle)
														</Link>
													</div>
												</>
											)}
										</>
									) : (
										<p className="text-sm text-slate-600">
											Cuando el alumno cree su cuenta con la clave del grupo, aquí podrás gestionar PDF e
											imágenes del expediente.
										</p>
									)}
								</>
							) : (
								<div className="space-y-5 rounded-xl border border-slate-200 bg-white p-4">
									<div>
										<label className="text-xs font-medium text-slate-600">Nombre completo</label>
										<input
											type="text"
											value={nombresEdit[accionesModal.alumno.padronId] ?? ""}
											onChange={(ev) =>
												setNombresEdit((prev) => ({
													...prev,
													[accionesModal.alumno.padronId]: ev.target.value,
												}))
											}
											className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
										/>
										<button
											type="button"
											disabled={filaTrabajo === accionesModal.alumno.padronId}
											onClick={() => void guardarNombrePadron(accionesModal.alumno.padronId)}
											className="mt-2 rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white disabled:opacity-50"
										>
											Guardar nombre
										</button>
									</div>
									<div className="grid gap-4 sm:grid-cols-2">
										<div>
											<p className="text-xs font-medium text-slate-600">Grado escolar</p>
											<p className="text-[11px] text-slate-500">
												Ahora: {accionesModal.alumno.gradoMostrado} · Enlace del grupo: {grupo?.grado}
											</p>
											<select
												value={gradoSeleccion[accionesModal.alumno.padronId] ?? "__token__"}
												onChange={(ev) =>
													setGradoSeleccion((prev) => ({
														...prev,
														[accionesModal.alumno.padronId]: ev.target.value,
													}))
												}
												className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
											>
												<option value="__token__">Predeterminado del enlace ({grupo?.grado})</option>
												{Array.from({ length: GRADO_ESCOLAR_MAX }, (_, i) => i + 1).map((n) => (
													<option key={n} value={String(n)}>
														Grado {n}
													</option>
												))}
											</select>
											<button
												type="button"
												disabled={filaTrabajo === accionesModal.alumno.padronId}
												onClick={() => void guardarGradoPadron(accionesModal.alumno.padronId)}
												className="mt-2 w-full rounded-lg border border-sky-600 bg-sky-600 py-2 text-sm font-medium text-white disabled:opacity-50"
											>
												Guardar grado
											</button>
										</div>
										{!ocultarSeccionesCarreraMatricula ? (
											<div className="rounded-lg border border-violet-100 bg-violet-50/40 p-3">
											<p className="text-xs font-semibold text-violet-900">Carrera y matrícula</p>
											<p className="mt-0.5 text-[11px] text-violet-800/90">
												Solo a partir de <strong>2.° grado</strong> (igual que la carrera en el sistema).
											</p>
											{alumnoRequiereCarrera(accionesModal.alumno.gradoMostrado) ? (
												<>
													<label
														htmlFor={`carrera-modal-${accionesModal.alumno.padronId}`}
														className="mt-2 block text-[11px] font-medium text-slate-600"
													>
														Carrera
													</label>
													<select
														id={`carrera-modal-${accionesModal.alumno.padronId}`}
														value={carreraSeleccion[accionesModal.alumno.padronId] ?? "__sin__"}
														onChange={(ev) =>
															setCarreraSeleccion((prev) => ({
																...prev,
																[accionesModal.alumno.padronId]: ev.target.value,
															}))
														}
														className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
													>
														<option value="__sin__">— Elegir carrera —</option>
														{carrerasCatalogo.map((cr) => (
															<option key={cr.id} value={cr.id}>
																{cr.nombre}
															</option>
														))}
													</select>
													<label
														htmlFor={`matricula-modal-${accionesModal.alumno.padronId}`}
														className="mt-3 block text-[11px] font-medium text-slate-600"
													>
														Matrícula
													</label>
													<input
														id={`matricula-modal-${accionesModal.alumno.padronId}`}
														type="text"
														value={matriculaEdit[accionesModal.alumno.padronId] ?? ""}
														onChange={(ev) =>
															setMatriculaEdit((prev) => ({
																...prev,
																[accionesModal.alumno.padronId]: ev.target.value,
															}))
														}
														placeholder="Ej. 1719002345"
														maxLength={48}
														className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm"
													/>
													<button
														type="button"
														disabled={filaTrabajo === accionesModal.alumno.padronId}
														onClick={() =>
															void guardarCarreraYMatriculaPadron(
																accionesModal.alumno.padronId,
																accionesModal.alumno.gradoMostrado,
															)
														}
														className="mt-3 w-full rounded-lg border border-violet-600 bg-violet-600 py-2.5 text-sm font-medium text-white disabled:opacity-50"
													>
														Guardar carrera y matrícula
													</button>
												</>
											) : (
												<p className="mt-2 text-sm text-slate-600">
													En <strong>1.° grado</strong> no aplica carrera ni matrícula. Si subes de grado con
													«Guardar grado», aquí podrás completarlas.
												</p>
											)}
											</div>
										) : null}
									</div>
									<div>
										<p className="text-xs font-medium text-slate-600">Mover a otro grupo</p>
										<div className="mt-1 flex flex-col gap-2 sm:flex-row sm:items-center">
											<select
												value={moverSeleccion[accionesModal.alumno.padronId] ?? ""}
												onChange={(ev) =>
													setMoverSeleccion((prev) => ({
														...prev,
														[accionesModal.alumno.padronId]: ev.target.value,
													}))
												}
												className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm sm:max-w-md"
											>
												<option value="">— Elegir grupo —</option>
												{opcionesGrupos
													.filter((o) => o.id !== grupoTokenId)
													.map((o) => (
														<option key={o.id} value={o.id}>
															{o.etiqueta}
														</option>
													))}
											</select>
											<button
												type="button"
												disabled={filaTrabajo === accionesModal.alumno.padronId}
												onClick={() => void moverPadron(accionesModal.alumno.padronId)}
												className="rounded-lg border border-slate-400 bg-white px-4 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
											>
												Mover alumno
											</button>
										</div>
									</div>
									<div className="flex flex-wrap gap-3 border-t border-slate-100 pt-4">
										<button
											type="button"
											disabled={filaTrabajo === accionesModal.alumno.padronId}
											onClick={() => void archivarUnAlumno(accionesModal.alumno.padronId, accionesModal.alumno.nombreCompleto)}
											className="rounded-lg border border-amber-700 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-900 hover:bg-amber-100 disabled:opacity-50"
										>
											Dar de baja (archivo muerto)
										</button>
										<button
											type="button"
											disabled={filaTrabajo === accionesModal.alumno.padronId}
											onClick={() => void eliminarPadron(accionesModal.alumno.padronId, accionesModal.alumno.nombreCompleto)}
											className="rounded-lg border border-red-300 bg-white px-4 py-2 text-sm font-medium text-red-800 hover:bg-red-50 disabled:opacity-50"
										>
											Eliminar del padrón
										</button>
									</div>
								</div>
							)}
						</div>

						<div className="border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
							<button
								type="button"
								className="w-full rounded-lg border border-slate-300 py-2.5 text-sm font-medium text-slate-700 hover:bg-slate-50"
								onClick={() => setAccionesModal(null)}
							>
								Cerrar
							</button>
						</div>
					</div>
				</div>
			) : null}

			{modalMatriculasAbierto && !ocultarSeccionesCarreraMatricula ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 sm:p-4"
					role="presentation"
					onClick={() => !matriculaModalGuardando && setModalMatriculasAbierto(false)}
				>
					<div
						role="dialog"
						aria-modal="true"
						aria-labelledby="titulo-modal-matriculas-grupo"
						className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-xl border border-sky-200 bg-white shadow-xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="border-b border-sky-100 bg-sky-50 px-4 py-3 sm:px-5">
							<h2 id="titulo-modal-matriculas-grupo" className="text-lg font-semibold text-sky-950">
								Matrículas (tabla)
							</h2>
							<p className="mt-1 text-xs text-sky-900/85">
								Alumnos de <strong>2.° grado o superior</strong> en la vista actual
								{gradoVista !== "" ? ` (Grado ${gradoVista})` : ""}. Deja vacío para quitar la
								matrícula.
							</p>
						</div>
						<div className="max-h-[min(58vh,480px)] overflow-auto px-2 py-2 sm:px-3">
							<table className="w-full min-w-[520px] text-left text-sm text-slate-800">
								<thead className="sticky top-0 border-b border-slate-200 bg-white">
									<tr>
										<th className="px-2 py-2 font-semibold text-slate-600">Alumno (padrón)</th>
										<th className="px-2 py-2 font-semibold text-slate-600">Matrícula</th>
									</tr>
								</thead>
								<tbody className="divide-y divide-slate-100">
									{alumnosParaMatricula.map((a) => (
										<tr key={a.padronId} className="align-middle hover:bg-slate-50/80">
											<td className="px-2 py-2">
												<span className="font-medium">{a.nombreCompleto}</span>
												<span className="ml-2 tabular-nums text-xs text-slate-500">Grado {a.gradoMostrado}</span>
											</td>
											<td className="px-2 py-2">
												<input
													type="text"
													value={matriculaModalDraft[a.padronId] ?? ""}
													onChange={(ev) =>
														setMatriculaModalDraft((prev) => ({
															...prev,
															[a.padronId]: ev.target.value,
														}))
													}
													disabled={matriculaModalGuardando}
													className="w-full min-w-[8rem] rounded-lg border border-slate-300 px-2 py-1.5 text-sm disabled:bg-slate-100"
													placeholder="—"
													autoComplete="off"
												/>
											</td>
										</tr>
									))}
								</tbody>
							</table>
						</div>
						<div className="flex flex-col gap-2 border-t border-slate-200 bg-white px-4 py-3 sm:flex-row sm:justify-end">
							<button
								type="button"
								disabled={matriculaModalGuardando}
								className="w-full rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50 sm:w-auto sm:min-w-[7rem] disabled:opacity-50"
								onClick={() => setModalMatriculasAbierto(false)}
							>
								Cancelar
							</button>
							<button
								type="button"
								disabled={matriculaModalGuardando || alumnosParaMatricula.length === 0}
								className="w-full rounded-lg border border-sky-700 bg-sky-700 py-2 text-sm font-medium text-white hover:bg-sky-800 sm:w-auto sm:min-w-[10rem] disabled:opacity-50"
								onClick={() => void guardarMatriculasModal()}
							>
								{matriculaModalGuardando ? "Guardando…" : "Guardar matrículas"}
							</button>
						</div>
					</div>
				</div>
			) : null}

			{modalLogsAbierto ? (
				<div
					className="fixed inset-0 z-50 flex items-center justify-center bg-slate-900/55 p-3 sm:p-4"
					role="presentation"
					onClick={() => setModalLogsAbierto(false)}
				>
					<div
						role="dialog"
						aria-modal="true"
						aria-labelledby="titulo-modal-logs-grupo"
						className="max-h-[90vh] w-full max-w-4xl overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="border-b border-slate-200 bg-slate-50 px-4 py-3 sm:px-5">
							<h2 id="titulo-modal-logs-grupo" className="text-lg font-semibold text-slate-900">
								Historial y auditoría
							</h2>
							<p className="mt-1 text-xs text-slate-600">
								Registros recientes en la base de datos (acciones de orientadores, sistema y disparadores).
							</p>
							<label className="mt-3 flex cursor-pointer items-center gap-2 text-sm text-slate-700">
								<input
									type="checkbox"
									checked={logsSoloEsteGrupo}
									onChange={(e) => setLogsSoloEsteGrupo(e.target.checked)}
									className="rounded border-slate-300 text-emerald-600 focus:ring-emerald-500"
								/>
								Mostrar solo entradas relacionadas con este grupo
							</label>
						</div>
						<div className="max-h-[min(65vh,520px)] overflow-auto px-2 py-2 sm:px-3">
							{logsCargando ? (
								<p className="px-2 py-8 text-center text-sm text-slate-500">Cargando…</p>
							) : logsError ? (
								<p className="px-2 py-6 text-center text-sm text-red-700" role="alert">
									{logsError}
								</p>
							) : logsRegistrosMostrados.length === 0 ? (
								<p className="px-2 py-8 text-center text-sm text-slate-600">
									{logsRegistros.length === 0
										? "No hay registros o aún no se aplicó el SQL de auditoría en Supabase."
										: "Ningún registro coincide con el filtro de este grupo. Desmarca la casilla para ver todo."}
								</p>
							) : (
								<table className="w-full min-w-[640px] text-left text-xs text-slate-800">
									<thead className="sticky top-0 border-b border-slate-200 bg-white">
										<tr>
											<th className="px-2 py-2 font-semibold text-slate-600">Cuándo</th>
											<th className="px-2 py-2 font-semibold text-slate-600">Quién</th>
											<th className="px-2 py-2 font-semibold text-slate-600">Acción</th>
											<th className="px-2 py-2 font-semibold text-slate-600">Entidad</th>
											<th className="px-2 py-2 font-semibold text-slate-600">Origen</th>
										</tr>
									</thead>
									<tbody className="divide-y divide-slate-100">
										{logsRegistrosMostrados.map((r) => (
											<tr key={r.id} className="align-top hover:bg-slate-50/80">
												<td className="whitespace-nowrap px-2 py-2 tabular-nums text-slate-600">
													{new Date(r.creado_en).toLocaleString("es-MX", {
														dateStyle: "short",
														timeStyle: "short",
													})}
												</td>
												<td className="max-w-[10rem] break-words px-2 py-2 text-slate-800">
													<span className="text-[10px] uppercase text-slate-500">{r.actor_tipo}</span>
													<br />
													{r.actor_etiqueta}
												</td>
												<td className="max-w-[11rem] break-words px-2 py-2 font-medium">{r.accion}</td>
												<td className="max-w-[14rem] break-words px-2 py-2">
													{r.entidad}
													{r.entidad_id ? (
														<span className="mt-0.5 block truncate font-mono text-[10px] text-slate-500">
															{r.entidad_id}
														</span>
													) : null}
													{r.detalle != null ? (
														<pre className="mt-1 max-h-24 overflow-auto rounded bg-slate-100 p-1 text-[10px] text-slate-700">
															{JSON.stringify(r.detalle)}
														</pre>
													) : null}
												</td>
												<td className="whitespace-nowrap px-2 py-2 text-slate-600">{r.origen}</td>
											</tr>
										))}
									</tbody>
								</table>
							)}
						</div>
						<div className="border-t border-slate-200 bg-white px-4 py-3">
							<button
								type="button"
								className="w-full rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-700 hover:bg-slate-50"
								onClick={() => setModalLogsAbierto(false)}
							>
								Cerrar
							</button>
						</div>
					</div>
				</div>
			) : null}
		</div>
	);
}
