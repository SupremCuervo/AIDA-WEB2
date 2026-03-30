"use client";

import JSZip from "jszip";
import { useSearchParams } from "next/navigation";
import CargasPeriodosOrientador from "./CargasPeriodosOrientador";
import CarrerasSistemaOrientador from "./CarrerasSistemaOrientador";
import CrearTablaOrientador from "./CrearTablaOrientador";
import EscanerSeccionOrientador from "./EscanerSeccionOrientador";
import PlantillasSeccionOrientador from "./PlantillasSeccionOrientador";
import HistorialAccionesOrientador from "./HistorialAccionesOrientador";
import {
	ANCLA_SECCION,
	runEnfocarSeccion,
	type SeccionOrientadorEnfoque,
} from "./orientador-panel-enfoque";
import {
	useCallback,
	useEffect,
	useMemo,
	useRef,
	useState,
	type ChangeEvent,
	type MouseEvent as ReactMouseEvent,
} from "react";
import { createPortal } from "react-dom";
import {
	esTipoAdjuntoOrientador,
	esTipoDocumentoValido,
} from "@/lib/nombre-archivo";
import { DURACION_MENSAJE_EMERGENTE_MS } from "@/lib/ui/duracion-mensaje-emergente-ms";

type SeccionNuevaOrientador = SeccionOrientadorEnfoque;

const SECCIONES_MENU_NUEVO: { id: SeccionNuevaOrientador; etiqueta: string }[] = [
	{ id: "expediente", etiqueta: "Expediente" },
	{ id: "crear_tabla", etiqueta: "Crear tabla" },
	{ id: "escaner", etiqueta: "Escaner" },
	{ id: "plantillas", etiqueta: "Plantillas" },
	{ id: "cargas", etiqueta: "Cargas" },
	{ id: "periodos", etiqueta: "Periodos" },
	{ id: "carreras", etiqueta: "Carreras" },
	{ id: "historial", etiqueta: "Historial" },
];

function esSeccionNuevaOrientador(v: string | null): v is SeccionNuevaOrientador {
	return (
		v === "expediente" ||
		v === "crear_tabla" ||
		v === "escaner" ||
		v === "plantillas" ||
		v === "cargas" ||
		v === "periodos" ||
		v === "carreras" ||
		v === "historial"
	);
}

type EstadoExpediente = "activo" | "inactivo";

type CarreraFiltro = {
	id: string;
	nombre: string;
	codigo: string;
};

type AlumnoExpediente = {
	padronId: string;
	nombreCompleto: string;
	matricula: string;
	grado: string;
	grupo: string;
	grupoTokenId: string | null;
	institucionGrupoId: string | null;
	carreraId: string | null;
	carreraNombre: string;
	carreraCodigo: string;
	estado: EstadoExpediente;
	cuentaId: string | null;
};

type GrupoResumenCatalogo = {
	id: string | null;
	institucionGrupoId: string | null;
	grado: string;
	grupo: string;
};

type GrupoTokenDesdeApi = {
	id: string | null;
	grado: string;
	grupo: string;
	claveAcceso: string;
	fechaLimiteEntrega: string | null;
};

type TokenModalFila = {
	id: string;
	grado: string;
	grupo: string;
	claveAcceso: string;
	fechaLimiteEntrega: string | null;
	claveDraft: string;
	fechaDraft: string;
};

function idDestinoGrupoCatalogo(g: GrupoResumenCatalogo): string {
	if (g.id != null && String(g.id).trim() !== "") {
		return String(g.id);
	}
	if (g.institucionGrupoId != null && String(g.institucionGrupoId).trim() !== "") {
		return String(g.institucionGrupoId);
	}
	return "";
}

type DocumentoModal = {
	id: string;
	nombre: string;
	archivoAdjunto?: string;
};

const DOCUMENTOS_REQUERIDOS_BASE: DocumentoModal[] = [
	{ id: "acta_nacimiento", nombre: "Acta Nacimiento" },
	{ id: "curp", nombre: "CURP" },
	{ id: "certificado_medico", nombre: "Certificado Médico" },
	{ id: "comprobante_domicilio", nombre: "Comprobante Domicilio" },
	{ id: "ine_tutor", nombre: "INE Tutor" },
];

function slugPlano(v: string): string {
	return v
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toLowerCase();
}

export default function OrientadorPanelPage() {
	const searchParams = useSearchParams();
	const [seccionActiva, setSeccionActiva] = useState<SeccionNuevaOrientador>("expediente");
	const [estadoExpediente, setEstadoExpediente] = useState<EstadoExpediente>("activo");
	const [filtroGrado, setFiltroGrado] = useState("");
	const [filtroGrupo, setFiltroGrupo] = useState("");
	const [filtroCarreraId, setFiltroCarreraId] = useState("");
	const [filtroNombre, setFiltroNombre] = useState("");
	const [filtroMatricula, setFiltroMatricula] = useState("");
	const [carreras, setCarreras] = useState<CarreraFiltro[]>([]);
	const [alumnos, setAlumnos] = useState<AlumnoExpediente[]>([]);
	const [cargando, setCargando] = useState(false);
	const [error, setError] = useState("");
	const [alumnoModal, setAlumnoModal] = useState<AlumnoExpediente | null>(null);
	const [modalExpedienteModo, setModalExpedienteModo] = useState<"edicion" | "ver_mas">("edicion");
	const [docsModal, setDocsModal] = useState<DocumentoModal[]>(DOCUMENTOS_REQUERIDOS_BASE);
	const [docPreview, setDocPreview] = useState<DocumentoModal | null>(null);
	const [docPreviewUrl, setDocPreviewUrl] = useState<string | null>(null);
	const [docPreviewMime, setDocPreviewMime] = useState<string | null>(null);
	const [docPreviewCargando, setDocPreviewCargando] = useState(false);
	const [docPreviewError, setDocPreviewError] = useState<string | null>(null);
	const [zipDescargando, setZipDescargando] = useState(false);
	const [insertarModal, setInsertarModal] = useState<{ docIdFijo: string | null } | null>(null);
	const [archivoInsertar, setArchivoInsertar] = useState<File | null>(null);
	const [nombreInsertarLibre, setNombreInsertarLibre] = useState("");
	const [modalCamaraAbierto, setModalCamaraAbierto] = useState(false);
	const [mensajeErrorCamara, setMensajeErrorCamara] = useState("");
	const fileInsertRef = useRef<HTMLInputElement>(null);
	const ignorarCierreTrasAbrirPickerRef = useRef(false);
	const videoCamaraRef = useRef<HTMLVideoElement>(null);
	const abortBusquedaRef = useRef<AbortController | null>(null);
	const reqIdRef = useRef(0);
	const verMasActivoCierraExpedienteAlSalirActualizarRef = useRef(false);
	const [modalActualizarDatos, setModalActualizarDatos] = useState(false);
	const [catalogoGruposActualizar, setCatalogoGruposActualizar] = useState<GrupoResumenCatalogo[]>([]);
	const [catalogoCarrerasActualizar, setCatalogoCarrerasActualizar] = useState<CarreraFiltro[]>([]);
	const [catalogosActualizarCargando, setCatalogosActualizarCargando] = useState(false);
	const [errorCatalogoActualizar, setErrorCatalogoActualizar] = useState("");
	const [modalTokensOpen, setModalTokensOpen] = useState(false);
	const [tokensModalFilas, setTokensModalFilas] = useState<TokenModalFila[]>([]);
	const [tokensModalCargando, setTokensModalCargando] = useState(false);
	const [guardandoTokenId, setGuardandoTokenId] = useState<string | null>(null);
	const [mensajeModalTokens, setMensajeModalTokens] = useState("");
	const [errorGuardarActualizar, setErrorGuardarActualizar] = useState("");
	const [guardandoActualizar, setGuardandoActualizar] = useState(false);
	const [formActGrado, setFormActGrado] = useState("");
	const [formActGrupoDestino, setFormActGrupoDestino] = useState("");
	const [formActMatricula, setFormActMatricula] = useState("");
	const [formActCarreraId, setFormActCarreraId] = useState("");
	const [formActEstado, setFormActEstado] = useState<EstadoExpediente>("activo");
	const datosPadronAlAbrirActualizarRef = useRef<{ carreraId: string | null; matricula: string } | null>(null);
	const [modalCrearExpediente, setModalCrearExpediente] = useState(false);
	const [catalogoGruposCrear, setCatalogoGruposCrear] = useState<GrupoResumenCatalogo[]>([]);
	const [catalogoCarrerasCrear, setCatalogoCarrerasCrear] = useState<CarreraFiltro[]>([]);
	const [catalogosCrearCargando, setCatalogosCrearCargando] = useState(false);
	const [errorCatalogoCrear, setErrorCatalogoCrear] = useState("");
	const [errorGuardarCrear, setErrorGuardarCrear] = useState("");
	const [guardandoCrear, setGuardandoCrear] = useState(false);
	const [formCrearNombre, setFormCrearNombre] = useState("");
	const [formCrearGrado, setFormCrearGrado] = useState("");
	const [formCrearGrupoDestino, setFormCrearGrupoDestino] = useState("");
	const [formCrearMatricula, setFormCrearMatricula] = useState("");
	const [formCrearCarreraId, setFormCrearCarreraId] = useState("");
	const [confirmActivarAlumno, setConfirmActivarAlumno] = useState<AlumnoExpediente | null>(null);
	const [activandoAlumno, setActivandoAlumno] = useState(false);
	const [errorActivar, setErrorActivar] = useState("");

	useEffect(() => {
		const s = searchParams.get("seccion");
		if (esSeccionNuevaOrientador(s)) {
			setSeccionActiva(s);
			return;
		}
		if (s) {
			setSeccionActiva("expediente");
		}
	}, [searchParams]);

	const irAExpediente = useCallback(() => {
		runEnfocarSeccion("expediente", setSeccionActiva, seccionActiva, ANCLA_SECCION.expediente);
	}, [seccionActiva, setSeccionActiva]);

	useEffect(() => {
		if (!error.trim()) {
			return;
		}
		const id = window.setTimeout(() => setError(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [error]);

	useEffect(() => {
		if (!errorActivar.trim()) {
			return;
		}
		const id = window.setTimeout(() => setErrorActivar(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [errorActivar]);

	useEffect(() => {
		if (!errorCatalogoActualizar.trim()) {
			return;
		}
		const id = window.setTimeout(() => setErrorCatalogoActualizar(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [errorCatalogoActualizar]);

	useEffect(() => {
		if (!errorGuardarActualizar.trim()) {
			return;
		}
		const id = window.setTimeout(() => setErrorGuardarActualizar(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [errorGuardarActualizar]);

	useEffect(() => {
		if (!errorCatalogoCrear.trim()) {
			return;
		}
		const id = window.setTimeout(() => setErrorCatalogoCrear(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [errorCatalogoCrear]);

	useEffect(() => {
		if (!errorGuardarCrear.trim()) {
			return;
		}
		const id = window.setTimeout(() => setErrorGuardarCrear(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [errorGuardarCrear]);

	useEffect(() => {
		if (!mensajeErrorCamara.trim()) {
			return;
		}
		const id = window.setTimeout(() => setMensajeErrorCamara(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [mensajeErrorCamara]);

	const hayFiltros = useMemo(
		() =>
			filtroGrado.trim() !== "" ||
			filtroGrupo.trim() !== "" ||
			filtroCarreraId.trim() !== "" ||
			filtroNombre.trim() !== "" ||
			filtroMatricula.trim() !== "",
		[filtroCarreraId, filtroGrado, filtroGrupo, filtroMatricula, filtroNombre],
	);

	const documentoInsertarFijo = useMemo(() => {
		if (!insertarModal?.docIdFijo) {
			return null;
		}
		return docsModal.find((d) => d.id === insertarModal.docIdFijo) ?? null;
	}, [docsModal, insertarModal]);

	const gruposParaSelectActualizar = useMemo(() => {
		const gd = formActGrado.trim();
		const coincideGrado = (x: GrupoResumenCatalogo) => String(x.grado).trim() === gd;
		let filas = gd === "" ? [] : catalogoGruposActualizar.filter(coincideGrado);
		const sel = formActGrupoDestino.trim();
		if (sel && !filas.some((x) => idDestinoGrupoCatalogo(x) === sel)) {
			const actual = catalogoGruposActualizar.find((x) => idDestinoGrupoCatalogo(x) === sel);
			if (actual) {
				filas = [actual, ...filas];
			}
		}
		const vistos = new Set<string>();
		return filas.filter((x) => {
			const v = idDestinoGrupoCatalogo(x);
			if (!v || vistos.has(v)) {
				return false;
			}
			vistos.add(v);
			return true;
		});
	}, [catalogoGruposActualizar, formActGrado, formActGrupoDestino]);

	const gruposParaSelectCrear = useMemo(() => {
		const gd = formCrearGrado.trim();
		const coincideGrado = (x: GrupoResumenCatalogo) => String(x.grado).trim() === gd;
		let filas = gd === "" ? [] : catalogoGruposCrear.filter(coincideGrado);
		const sel = formCrearGrupoDestino.trim();
		if (sel && !filas.some((x) => idDestinoGrupoCatalogo(x) === sel)) {
			const actual = catalogoGruposCrear.find((x) => idDestinoGrupoCatalogo(x) === sel);
			if (actual) {
				filas = [actual, ...filas];
			}
		}
		const vistos = new Set<string>();
		return filas.filter((x) => {
			const v = idDestinoGrupoCatalogo(x);
			if (!v || vistos.has(v)) {
				return false;
			}
			vistos.add(v);
			return true;
		});
	}, [catalogoGruposCrear, formCrearGrado, formCrearGrupoDestino]);

	const cargarExpediente = useCallback(async (opciones?: { silencioso?: boolean }) => {
		const silencioso = opciones?.silencioso === true;
		setError("");
		if (!silencioso) {
			setCargando(true);
		}
		abortBusquedaRef.current?.abort();
		const controller = new AbortController();
		abortBusquedaRef.current = controller;
		const reqId = ++reqIdRef.current;
		try {
			const p = new URLSearchParams();
			p.set("estado", estadoExpediente);
			if (filtroGrado.trim() !== "") {
				p.set("grado", filtroGrado.trim());
			}
			if (filtroGrupo.trim() !== "") {
				p.set("grupo", filtroGrupo.trim().toUpperCase());
			}
			if (filtroCarreraId.trim() !== "") {
				p.set("carreraId", filtroCarreraId.trim());
			}
			if (filtroNombre.trim() !== "") {
				p.set("nombre", filtroNombre.trim());
			}
			if (filtroMatricula.trim() !== "") {
				p.set("matricula", filtroMatricula.trim());
			}
			const res = await fetch(`/api/orientador/expediente?${p.toString()}`, {
				credentials: "include",
				signal: controller.signal,
			});
			const data = (await res.json()) as {
				alumnos?: AlumnoExpediente[];
				carreras?: CarreraFiltro[];
				error?: string;
			};
			if (!res.ok) {
				setError(data.error ?? "No se pudo cargar expediente");
				irAExpediente();
				return;
			}
			if (reqId !== reqIdRef.current) {
				return;
			}
			setAlumnos(data.alumnos ?? []);
			setCarreras(data.carreras ?? []);
		} catch (e) {
			if (e instanceof DOMException && e.name === "AbortError") {
				return;
			}
			setError("Error de red");
			irAExpediente();
		} finally {
			if (reqId === reqIdRef.current && !silencioso) {
				setCargando(false);
			}
		}
	}, [
		estadoExpediente,
		filtroCarreraId,
		filtroGrado,
		filtroGrupo,
		filtroMatricula,
		filtroNombre,
		irAExpediente,
	]);

	useEffect(() => {
		if (seccionActiva !== "expediente") {
			return;
		}
		const id = window.setTimeout(() => {
			void cargarExpediente();
		}, 150);
		return () => {
			window.clearTimeout(id);
			abortBusquedaRef.current?.abort();
		};
	}, [seccionActiva, estadoExpediente, filtroGrado, filtroGrupo, filtroCarreraId, filtroNombre, filtroMatricula, cargarExpediente]);

	useEffect(() => {
		if (!docPreview) {
			setDocPreviewUrl((prev) => {
				if (prev) {
					URL.revokeObjectURL(prev);
				}
				return null;
			});
			setDocPreviewMime(null);
			setDocPreviewCargando(false);
			setDocPreviewError(null);
			return;
		}

		const cuentaId = alumnoModal?.cuentaId ?? "";
		const tipo = docPreview.id;

		if (!cuentaId) {
			setDocPreviewCargando(false);
			setDocPreviewError(
				"Este expediente no tiene cuenta vinculada; no se puede cargar el archivo desde el almacén.",
			);
			return;
		}

		if (!esTipoDocumentoValido(tipo) && !esTipoAdjuntoOrientador(tipo)) {
			setDocPreviewCargando(false);
			setDocPreviewError(
				"La vista previa del servidor solo aplica a los cinco documentos del trámite o adjuntos ya registrados en la base de datos.",
			);
			return;
		}

		let cancelado = false;
		setDocPreviewCargando(true);
		setDocPreviewError(null);
		setDocPreviewUrl((prev) => {
			if (prev) {
				URL.revokeObjectURL(prev);
			}
			return null;
		});
		setDocPreviewMime(null);

		void (async () => {
			try {
				const qs = new URLSearchParams({
					cuentaId,
					tipo,
					inline: "1",
				});
				const res = await fetch(`/api/orientador/documento/descargar?${qs.toString()}`, {
					credentials: "include",
				});
				if (cancelado) {
					return;
				}
				if (!res.ok) {
					const raw = await res.text().catch(() => "");
					let msg = `No se pudo cargar el documento (${res.status}).`;
					try {
						const j = raw ? (JSON.parse(raw) as { error?: string }) : {};
						if (typeof j.error === "string" && j.error.trim()) {
							msg = j.error.trim();
						}
					} catch {
						/* mantener msg */
					}
					if (res.status === 404) {
						msg = "No hay archivo subido para este documento.";
					}
					setDocPreviewError(msg);
					setDocPreviewCargando(false);
					return;
				}
				const blob = await res.blob();
				if (cancelado) {
					return;
				}
				const mime = blob.type && blob.type !== "" ? blob.type : "application/octet-stream";
				const url = URL.createObjectURL(blob);
				setDocPreviewUrl((anterior) => {
					if (anterior) {
						URL.revokeObjectURL(anterior);
					}
					return url;
				});
				setDocPreviewMime(mime);
			} catch {
				if (!cancelado) {
					setDocPreviewError("Error de red al cargar la vista previa.");
				}
			} finally {
				if (!cancelado) {
					setDocPreviewCargando(false);
				}
			}
		})();

		return () => {
			cancelado = true;
		};
	}, [docPreview, alumnoModal?.cuentaId]);

	useEffect(() => {
		if (!modalCamaraAbierto) {
			return;
		}
		let stream: MediaStream | null = null;
		const video = videoCamaraRef.current;
		setMensajeErrorCamara("");
		const iniciar = async () => {
			try {
				try {
					stream = await navigator.mediaDevices.getUserMedia({
						video: { facingMode: { ideal: "environment" } },
						audio: false,
					});
				} catch {
					stream = await navigator.mediaDevices.getUserMedia({ video: true, audio: false });
				}
				const el = videoCamaraRef.current;
				if (el) {
					el.srcObject = stream;
					await el.play().catch(() => {});
				}
			} catch {
				setMensajeErrorCamara("No se pudo acceder a la cámara. Revisa permisos o usa otro dispositivo.");
			}
		};
		void iniciar();
		return () => {
			stream?.getTracks().forEach((t) => t.stop());
			const el = videoCamaraRef.current;
			if (el) {
				el.srcObject = null;
			}
		};
	}, [modalCamaraAbierto]);

	async function cargarListaTokensModal() {
		setTokensModalCargando(true);
		setMensajeModalTokens("");
		try {
			const res = await fetch("/api/orientador/grupos", { credentials: "include" });
			const data = (await res.json()) as { grupos?: GrupoTokenDesdeApi[]; error?: string };
			if (!res.ok) {
				setMensajeModalTokens(data.error ?? "No se pudieron cargar los tokens");
				setTokensModalFilas([]);
				return;
			}
			const raw = data.grupos ?? [];
			const porId = new Map<string, GrupoTokenDesdeApi>();
			for (const g of raw) {
				if (g.id == null || String(g.id).trim() === "") {
					continue;
				}
				const id = String(g.id);
				if (!porId.has(id)) {
					porId.set(id, g);
				}
			}
			const filas: TokenModalFila[] = [...porId.values()].map((g) => {
				const fe = g.fechaLimiteEntrega;
				return {
					id: String(g.id),
					grado: String(g.grado ?? "").trim() || "1",
					grupo: String(g.grupo ?? "").trim().toUpperCase(),
					claveAcceso: String(g.claveAcceso ?? "").trim(),
					fechaLimiteEntrega: fe,
					claveDraft: String(g.claveAcceso ?? "").trim(),
					fechaDraft: fe ? fe.slice(0, 10) : "",
				};
			});
			filas.sort((a, b) => {
				const na = Number.parseInt(a.grado, 10) || 0;
				const nb = Number.parseInt(b.grado, 10) || 0;
				if (na !== nb) {
					return na - nb;
				}
				return a.grupo.localeCompare(b.grupo, "es");
			});
			setTokensModalFilas(filas);
		} catch {
			setMensajeModalTokens("Error de red");
			setTokensModalFilas([]);
		} finally {
			setTokensModalCargando(false);
		}
	}

	function abrirModalTokens() {
		setModalTokensOpen(true);
		void cargarListaTokensModal();
	}

	function cerrarModalTokens() {
		setModalTokensOpen(false);
		setMensajeModalTokens("");
		setTokensModalFilas([]);
	}

	function actualizarDraftToken(
		id: string,
		parcial: Partial<Pick<TokenModalFila, "claveDraft" | "fechaDraft">>,
	) {
		setTokensModalFilas((prev) => prev.map((row) => (row.id === id ? { ...row, ...parcial } : row)));
	}

	async function guardarCambiosTokenRow(row: TokenModalFila) {
		const fechaNorm = row.fechaDraft.trim() === "" ? null : row.fechaDraft.trim().slice(0, 10);
		if (fechaNorm !== null && !/^\d{4}-\d{2}-\d{2}$/.test(fechaNorm)) {
			setMensajeModalTokens("La fecha de cierre debe ser YYYY-MM-DD o vacía.");
			return;
		}
		const fechaAnterior = row.fechaLimiteEntrega ? row.fechaLimiteEntrega.slice(0, 10) : "";
		const fechaNuevaStr = fechaNorm ?? "";
		const cambiaFecha = fechaNuevaStr !== fechaAnterior;

		const claveNueva = row.claveDraft.trim().toUpperCase();
		const claveAnterior = row.claveAcceso.trim().toUpperCase();
		const cambiaClave = claveNueva !== claveAnterior;

		if (!cambiaFecha && !cambiaClave) {
			setMensajeModalTokens("No hay cambios que guardar.");
			setTimeout(() => setMensajeModalTokens(""), DURACION_MENSAJE_EMERGENTE_MS);
			return;
		}
		if (cambiaClave && !claveNueva) {
			setMensajeModalTokens("La clave no puede quedar vacía.");
			return;
		}

		setGuardandoTokenId(row.id);
		setMensajeModalTokens("");
		try {
			const payload: {
				id: string;
				claveAcceso?: string;
				fechaLimiteEntrega?: string | null;
			} = { id: row.id };
			if (cambiaFecha) {
				payload.fechaLimiteEntrega = fechaNorm;
			}
			if (cambiaClave) {
				payload.claveAcceso = claveNueva;
			}
			const res = await fetch("/api/orientador/grupo-token", {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify(payload),
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setMensajeModalTokens(d.error ?? "No se pudo guardar el token");
				return;
			}
			setMensajeModalTokens("Cambios guardados. Afectan el acceso de alumnos con ese grupo.");
			setTimeout(() => setMensajeModalTokens(""), DURACION_MENSAJE_EMERGENTE_MS);
			await cargarListaTokensModal();
			if (seccionActiva === "expediente") {
				await cargarExpediente({ silencioso: true });
			}
		} catch {
			setMensajeModalTokens("Error de red al guardar");
		} finally {
			setGuardandoTokenId(null);
		}
	}

	const etiquetaActiva =
		SECCIONES_MENU_NUEVO.find((seccion) => seccion.id === seccionActiva)?.etiqueta ?? "Expediente";

	const expedienteSoloActualizarVerMasActivo = useMemo(
		() =>
			Boolean(
				alumnoModal &&
					modalExpedienteModo === "ver_mas" &&
					alumnoModal.estado === "activo" &&
					modalActualizarDatos,
			),
		[alumnoModal, modalExpedienteModo, modalActualizarDatos],
	);

	function abrirModalAlumno(alumno: AlumnoExpediente) {
		verMasActivoCierraExpedienteAlSalirActualizarRef.current = false;
		setModalExpedienteModo("edicion");
		setAlumnoModal(alumno);
		setDocPreview(null);
		setInsertarModal(null);
		setArchivoInsertar(null);
		setNombreInsertarLibre("");
		if (fileInsertRef.current) {
			fileInsertRef.current.value = "";
		}
		setModalCamaraAbierto(false);
		setModalActualizarDatos(false);
		setDocsModal(DOCUMENTOS_REQUERIDOS_BASE);
	}

	function abrirModalVerMas(alumno: AlumnoExpediente) {
		setModalExpedienteModo("ver_mas");
		setAlumnoModal(alumno);
		setDocPreview(null);
		setInsertarModal(null);
		setArchivoInsertar(null);
		setNombreInsertarLibre("");
		if (fileInsertRef.current) {
			fileInsertRef.current.value = "";
		}
		setModalCamaraAbierto(false);
		setModalActualizarDatos(false);
		setDocsModal(DOCUMENTOS_REQUERIDOS_BASE);
		verMasActivoCierraExpedienteAlSalirActualizarRef.current = alumno.estado === "activo";
		if (alumno.estado === "activo") {
			abrirModalActualizarDatos(alumno);
		}
	}

	function cerrarModalAlumno() {
		verMasActivoCierraExpedienteAlSalirActualizarRef.current = false;
		setModalExpedienteModo("edicion");
		setAlumnoModal(null);
		setDocPreview(null);
		setInsertarModal(null);
		setModalCamaraAbierto(false);
		setModalActualizarDatos(false);
		resetCamposInsertar();
	}

	function abrirConfirmActivar(a: AlumnoExpediente) {
		setErrorActivar("");
		setConfirmActivarAlumno(a);
	}

	function cerrarConfirmActivar() {
		setConfirmActivarAlumno(null);
		setErrorActivar("");
	}

	async function ejecutarActivarAlumno() {
		if (!confirmActivarAlumno) {
			return;
		}
		setActivandoAlumno(true);
		setErrorActivar("");
		try {
			const res = await fetch(`/api/orientador/padron/${confirmActivarAlumno.padronId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ estadoExpediente: "activo" }),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setErrorActivar(data.error ?? "No se pudo activar al alumno");
				irAExpediente();
				return;
			}
			cerrarConfirmActivar();
			cerrarModalAlumno();
			void cargarExpediente({ silencioso: true });
		} catch {
			setErrorActivar("Error de red");
			irAExpediente();
		} finally {
			setActivandoAlumno(false);
		}
	}

	function cerrarModalActualizarDatos() {
		const cerrarExpedienteCompleto = verMasActivoCierraExpedienteAlSalirActualizarRef.current;
		setModalActualizarDatos(false);
		setErrorCatalogoActualizar("");
		setErrorGuardarActualizar("");
		if (cerrarExpedienteCompleto) {
			verMasActivoCierraExpedienteAlSalirActualizarRef.current = false;
			cerrarModalAlumno();
		}
	}

	async function cargarCatalogosParaActualizar() {
		setCatalogosActualizarCargando(true);
		setErrorCatalogoActualizar("");
		try {
			const [resC, resG] = await Promise.all([
				fetch("/api/orientador/carreras", { credentials: "include" }),
				fetch("/api/orientador/grupos", { credentials: "include" }),
			]);
			const dataC = (await resC.json()) as { carreras?: CarreraFiltro[]; error?: string };
			const dataG = (await resG.json()) as { grupos?: GrupoResumenCatalogo[]; error?: string };
			if (!resC.ok) {
				setErrorCatalogoActualizar(dataC.error ?? "No se pudieron cargar las carreras");
				irAExpediente();
				return;
			}
			if (!resG.ok) {
				setErrorCatalogoActualizar(dataG.error ?? "No se pudieron cargar los grupos");
				irAExpediente();
				return;
			}
			const listaG = (dataG.grupos ?? []).filter((g) => idDestinoGrupoCatalogo(g) !== "");
			listaG.sort((a, b) => {
				const na = Number.parseInt(String(a.grado), 10) || 0;
				const nb = Number.parseInt(String(b.grado), 10) || 0;
				if (na !== nb) {
					return na - nb;
				}
				return String(a.grupo).localeCompare(String(b.grupo), "es");
			});
			setCatalogoCarrerasActualizar(dataC.carreras ?? []);
			setCatalogoGruposActualizar(listaG);
		} catch {
			setErrorCatalogoActualizar("Error de red al cargar catálogos");
			irAExpediente();
		} finally {
			setCatalogosActualizarCargando(false);
		}
	}

	async function cargarCatalogosParaCrear() {
		setCatalogosCrearCargando(true);
		setErrorCatalogoCrear("");
		try {
			const [resC, resG] = await Promise.all([
				fetch("/api/orientador/carreras", { credentials: "include" }),
				fetch("/api/orientador/grupos", { credentials: "include" }),
			]);
			const dataC = (await resC.json()) as { carreras?: CarreraFiltro[]; error?: string };
			const dataG = (await resG.json()) as { grupos?: GrupoResumenCatalogo[]; error?: string };
			if (!resC.ok) {
				setErrorCatalogoCrear(dataC.error ?? "No se pudieron cargar las carreras");
				irAExpediente();
				return;
			}
			if (!resG.ok) {
				setErrorCatalogoCrear(dataG.error ?? "No se pudieron cargar los grupos");
				irAExpediente();
				return;
			}
			const listaG = (dataG.grupos ?? []).filter((g) => idDestinoGrupoCatalogo(g) !== "");
			listaG.sort((a, b) => {
				const na = Number.parseInt(String(a.grado), 10) || 0;
				const nb = Number.parseInt(String(b.grado), 10) || 0;
				if (na !== nb) {
					return na - nb;
				}
				return String(a.grupo).localeCompare(String(b.grupo), "es");
			});
			setCatalogoCarrerasCrear(dataC.carreras ?? []);
			setCatalogoGruposCrear(listaG);
		} catch {
			setErrorCatalogoCrear("Error de red al cargar catálogos");
			irAExpediente();
		} finally {
			setCatalogosCrearCargando(false);
		}
	}

	function abrirModalCrearExpediente() {
		setFormCrearNombre("");
		setFormCrearGrado("");
		setFormCrearGrupoDestino("");
		setFormCrearMatricula("");
		setFormCrearCarreraId("");
		setErrorGuardarCrear("");
		setErrorCatalogoCrear("");
		setModalCrearExpediente(true);
		void cargarCatalogosParaCrear();
	}

	function cerrarModalCrearExpediente() {
		setModalCrearExpediente(false);
		setErrorCatalogoCrear("");
		setErrorGuardarCrear("");
	}

	async function guardarCrearExpediente() {
		const nombre = formCrearNombre.trim();
		if (!nombre) {
			setErrorGuardarCrear("Escribe el nombre del alumno.");
			irAExpediente();
			return;
		}
		if (!formCrearGrupoDestino.trim()) {
			setErrorGuardarCrear("Selecciona un grupo de la lista.");
			irAExpediente();
			return;
		}
		setGuardandoCrear(true);
		setErrorGuardarCrear("");
		try {
			const cuerpo: Record<string, unknown> = {
				nombreCompleto: nombre,
				grupoTokenIdDestino: formCrearGrupoDestino.trim(),
			};
			const gradoTrim = formCrearGrado.trim();
			if (gradoTrim !== "") {
				cuerpo.gradoAlumno = gradoTrim;
			}
			const carreraTrim = formCrearCarreraId.trim();
			if (carreraTrim !== "") {
				cuerpo.carreraId = carreraTrim;
			}
			const matTrim = formCrearMatricula.trim();
			if (matTrim !== "") {
				cuerpo.matricula = matTrim;
			}
			const res = await fetch("/api/orientador/expediente", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(cuerpo),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setErrorGuardarCrear(data.error ?? "No se pudo crear el expediente");
				irAExpediente();
				return;
			}
			cerrarModalCrearExpediente();
			void cargarExpediente();
		} catch {
			setErrorGuardarCrear("Error de red");
			irAExpediente();
		} finally {
			setGuardandoCrear(false);
		}
	}

	function abrirModalActualizarDatos(alumnoParam?: AlumnoExpediente) {
		const a = alumnoParam ?? alumnoModal;
		if (!a) {
			return;
		}
		datosPadronAlAbrirActualizarRef.current = {
			carreraId: a.carreraId,
			matricula: a.matricula ?? "",
		};
		setFormActGrado(a.grado);
		setFormActGrupoDestino(a.grupoTokenId ?? a.institucionGrupoId ?? "");
		setFormActMatricula(a.matricula);
		setFormActCarreraId(a.carreraId ?? "");
		setFormActEstado(a.estado);
		setErrorGuardarActualizar("");
		setModalActualizarDatos(true);
		const yaHayCatalogoActualizar =
			catalogoGruposActualizar.length > 0 && catalogoCarrerasActualizar.length > 0;
		if (!yaHayCatalogoActualizar) {
			void cargarCatalogosParaActualizar();
		}
	}

	async function guardarActualizarDatosAlumno() {
		if (!alumnoModal) {
			return;
		}
		if (!formActGrupoDestino.trim()) {
			setErrorGuardarActualizar("Selecciona un grupo de la lista (datos de la institución).");
			irAExpediente();
			return;
		}
		setGuardandoActualizar(true);
		setErrorGuardarActualizar("");
		try {
			const inicial = datosPadronAlAbrirActualizarRef.current;
			const cuerpo: Record<string, unknown> = {
				grupoTokenIdDestino: formActGrupoDestino.trim(),
				estadoExpediente: formActEstado,
			};
			const gradoTrim = formActGrado.trim();
			if (gradoTrim !== "") {
				cuerpo.gradoAlumno = gradoTrim;
			}
			const carreraTrim = formActCarreraId.trim();
			if (carreraTrim !== "") {
				cuerpo.carreraId = carreraTrim;
			} else if (inicial?.carreraId) {
				cuerpo.carreraId = null;
			}
			const matTrim = formActMatricula.trim();
			if (matTrim !== "") {
				cuerpo.matricula = matTrim;
			} else if ((inicial?.matricula ?? "").trim() !== "") {
				cuerpo.matricula = null;
			}

			const res = await fetch(`/api/orientador/padron/${alumnoModal.padronId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify(cuerpo),
			});
			const data = (await res.json()) as {
				error?: string;
				grupoTokenId?: string | null;
				institucionGrupoId?: string | null;
				estadoExpediente?: EstadoExpediente;
			};
			if (!res.ok) {
				setErrorGuardarActualizar(data.error ?? "No se pudo actualizar");
				irAExpediente();
				return;
			}
			const carreraNombre =
				catalogoCarrerasActualizar.find((c) => c.id === formActCarreraId)?.nombre ?? alumnoModal.carreraNombre;
			const carreraCodigo =
				catalogoCarrerasActualizar.find((c) => c.id === formActCarreraId)?.codigo ?? alumnoModal.carreraCodigo;
			const gSel = catalogoGruposActualizar.find((g) => idDestinoGrupoCatalogo(g) === formActGrupoDestino);
			const estadoTrasGuardar: EstadoExpediente =
				data.estadoExpediente === "activo" || data.estadoExpediente === "inactivo"
					? data.estadoExpediente
					: formActEstado;
			const actualizado: AlumnoExpediente = {
				...alumnoModal,
				grado: formActGrado.trim(),
				grupo: gSel ? String(gSel.grupo).toUpperCase() : alumnoModal.grupo,
				matricula: formActMatricula.trim(),
				carreraId: formActCarreraId.trim() || null,
				carreraNombre: formActCarreraId.trim() ? carreraNombre : "",
				carreraCodigo: formActCarreraId.trim() ? carreraCodigo : "",
				grupoTokenId:
					typeof data.grupoTokenId === "string" && data.grupoTokenId
						? data.grupoTokenId
						: alumnoModal.grupoTokenId,
				institucionGrupoId:
					typeof data.institucionGrupoId === "string" && data.institucionGrupoId
						? data.institucionGrupoId
						: alumnoModal.institucionGrupoId,
				estado: estadoTrasGuardar,
			};
			setAlumnoModal(actualizado);
			setAlumnos((filas) => filas.map((r) => (r.padronId === actualizado.padronId ? actualizado : r)));
			cerrarModalActualizarDatos();
			void cargarExpediente({ silencioso: true });
		} catch {
			setErrorGuardarActualizar("Error de red");
			irAExpediente();
		} finally {
			setGuardandoActualizar(false);
		}
	}

	function resetCamposInsertar() {
		setArchivoInsertar(null);
		setNombreInsertarLibre("");
		if (fileInsertRef.current) {
			fileInsertRef.current.value = "";
		}
	}

	function abrirInsertarLibre() {
		resetCamposInsertar();
		setInsertarModal({ docIdFijo: null });
	}

	function abrirInsertarParaDocumento(docId: string) {
		resetCamposInsertar();
		setInsertarModal({ docIdFijo: docId });
	}

	function cerrarInsertarModal() {
		setInsertarModal(null);
		setModalCamaraAbierto(false);
		resetCamposInsertar();
	}

	function abrirSelectorArchivoInsertar() {
		ignorarCierreTrasAbrirPickerRef.current = true;
		fileInsertRef.current?.click();
		window.setTimeout(() => {
			ignorarCierreTrasAbrirPickerRef.current = false;
		}, 600);
	}

	function clicBackdropInsertarArchivos(e: ReactMouseEvent<HTMLDivElement>) {
		if (e.target !== e.currentTarget) {
			return;
		}
		if (ignorarCierreTrasAbrirPickerRef.current) {
			return;
		}
		cerrarInsertarModal();
	}

	function abrirModalCamara() {
		setMensajeErrorCamara("");
		setModalCamaraAbierto(true);
	}

	function cerrarModalCamara() {
		setModalCamaraAbierto(false);
		setMensajeErrorCamara("");
	}

	function capturarFotoDesdeCamara() {
		const video = videoCamaraRef.current;
		if (!video || video.readyState < HTMLMediaElement.HAVE_CURRENT_DATA) {
			return;
		}
		const w = video.videoWidth;
		const h = video.videoHeight;
		if (w === 0 || h === 0) {
			return;
		}
		const canvas = document.createElement("canvas");
		canvas.width = w;
		canvas.height = h;
		const ctx = canvas.getContext("2d");
		if (!ctx) {
			return;
		}
		ctx.drawImage(video, 0, 0, w, h);
		canvas.toBlob(
			(blob) => {
				if (!blob) {
					return;
				}
				const nombre = `foto_${Date.now()}.jpg`;
				const file = new File([blob], nombre, { type: "image/jpeg" });
				setArchivoInsertar(file);
				setModalCamaraAbierto(false);
				setMensajeErrorCamara("");
			},
			"image/jpeg",
			0.92,
		);
	}

	function onArchivoInsertarElegido(e: ChangeEvent<HTMLInputElement>) {
		const f = e.target.files?.[0];
		setArchivoInsertar(f ?? null);
	}

	function confirmarInsertarArchivos() {
		if (!insertarModal || !archivoInsertar) {
			return;
		}
		if (insertarModal.docIdFijo === null) {
			const nombre = nombreInsertarLibre.trim();
			if (!nombre) {
				return;
			}
			setDocsModal((prev) => [
				...prev,
				{
					id: `adj_${Date.now()}`,
					nombre,
					archivoAdjunto: archivoInsertar.name,
				},
			]);
		} else {
			setDocsModal((prev) =>
				prev.map((d) =>
					d.id === insertarModal.docIdFijo
						? { ...d, archivoAdjunto: archivoInsertar.name }
						: d,
				),
			);
		}
		cerrarInsertarModal();
	}

	function eliminarDocumentoDeModal(docId: string) {
		setDocsModal((prev) => prev.filter((d) => d.id !== docId));
	}

	async function descargarTodoZip() {
		if (!alumnoModal || docsModal.length === 0) {
			return;
		}
		setZipDescargando(true);
		try {
			const zip = new JSZip();
			for (const doc of docsModal) {
				const nombreTxt = `${slugPlano(doc.nombre || doc.id)}.txt`;
				const adj = doc.archivoAdjunto ? `\nArchivo: ${doc.archivoAdjunto}\n` : "\n";
				zip.file(
					nombreTxt,
					`Documento: ${doc.nombre}\nAlumno: ${alumnoModal.nombreCompleto}\nGrupo: ${alumnoModal.grado}${alumnoModal.grupo}\nMatricula: ${alumnoModal.matricula || "—"}${adj}`,
				);
			}
			const blob = await zip.generateAsync({ type: "blob" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			const matSlug = slugPlano(alumnoModal.matricula.trim() || "sin_matricula");
			const nombreZip = `${slugPlano(alumnoModal.nombreCompleto)}_${matSlug}.zip`;
			a.href = url;
			a.download = nombreZip;
			document.body.appendChild(a);
			a.click();
			a.remove();
			URL.revokeObjectURL(url);
		} finally {
			setZipDescargando(false);
		}
	}

	function descargarDocumentoIndividual(doc: DocumentoModal) {
		if (!alumnoModal) {
			return;
		}
		const adj = doc.archivoAdjunto ? `\nArchivo: ${doc.archivoAdjunto}\n` : "\n";
		const contenido = `Documento: ${doc.nombre}\nAlumno: ${alumnoModal.nombreCompleto}\nGrupo: ${alumnoModal.grado}${alumnoModal.grupo}\nMatrícula: ${alumnoModal.matricula || "—"}${adj}`;
		const blob = new Blob([contenido], { type: "text/plain;charset=utf-8" });
		const url = URL.createObjectURL(blob);
		const a = document.createElement("a");
		a.href = url;
		a.download = `${slugPlano(doc.nombre || doc.id)}.txt`;
		document.body.appendChild(a);
		a.click();
		a.remove();
		URL.revokeObjectURL(url);
	}

	return (
		<div>
			<div className="mx-auto mt-3 flex max-w-6xl justify-center px-4 sm:px-6">
				<div className="w-full rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-2 shadow-sm">
					<div className="flex flex-wrap items-center justify-center gap-2">
						{SECCIONES_MENU_NUEVO.map((item) => (
							<button
								key={item.id}
								type="button"
								onClick={() => runEnfocarSeccion(item.id, setSeccionActiva, seccionActiva)}
								className={`inline-flex items-center rounded-xl border-2 px-5 py-2 text-[1.05rem] font-semibold transition-all duration-300 ease-out ${
									seccionActiva === item.id
										? "scale-[1.02] border-[#6D28D9] bg-[#7C3AED] text-white shadow-md shadow-violet-300/60"
										: "border-[#BAE6FD] bg-[#E0F2FE] text-[#0369A1] hover:scale-[1.01] hover:border-[#7DD3FC] hover:bg-[#BAE6FD]"
								}`}
							>
								{item.etiqueta}
							</button>
						))}
					</div>
				</div>
			</div>

			<div key={seccionActiva} className="orientador-panel-seccion-animada">
			{seccionActiva === "expediente" ? (
				<div className="mx-auto mt-5 max-w-6xl rounded-2xl border border-[#E2E8F0] bg-white p-4 shadow-sm sm:p-6">
					<div className="flex flex-col gap-6">
						<div className="flex flex-col items-center gap-3 border-b border-[#E5E7EB] pb-5">
							<p className="text-xs font-semibold uppercase tracking-wide text-[#64748B]">Estado del listado</p>
							<div className="flex flex-wrap items-center justify-center gap-3">
								<div className="relative inline-grid grid-cols-2 rounded-xl border border-[#D1D5DB] bg-[#F3F4F6] p-1">
									<span
										aria-hidden
										className={`absolute top-1 h-[calc(100%-0.5rem)] w-[calc(50%-0.25rem)] rounded-lg shadow-sm transition-all duration-300 ease-out ${
											estadoExpediente === "activo"
												? "left-1 bg-[#7C3AED]"
												: "left-[calc(50%+0.125rem)] bg-[#DC2626]"
										}`}
									/>
									<button
										type="button"
										onClick={() => setEstadoExpediente("activo")}
										className={`relative z-10 min-w-[7rem] rounded-lg px-5 py-2.5 text-sm font-semibold transition ${
											estadoExpediente === "activo" ? "text-white" : "text-[#374151]"
										}`}
									>
										Activo
									</button>
									<button
										type="button"
										onClick={() => setEstadoExpediente("inactivo")}
										className={`relative z-10 min-w-[7rem] rounded-lg px-5 py-2.5 text-sm font-semibold transition ${
											estadoExpediente === "inactivo" ? "text-white" : "text-[#374151]"
										}`}
									>
										Inactivo
									</button>
								</div>
								<button
									type="button"
									onClick={() => abrirModalTokens()}
									className="rounded-xl border-2 border-[#6D28D9] bg-[#EDE9FE] px-5 py-2.5 text-sm font-bold text-[#5B21B6] shadow-sm transition hover:bg-[#DDD6FE]"
								>
									Tokens
								</button>
							</div>
							<p className="max-w-xl text-center text-[11px] leading-snug text-[#64748B]">
								En Tokens ves todas las claves por grupo, la fecha de cierre del acceso y puedes guardar
								cambios; aplican a todos los alumnos que usan esa clave.
							</p>
						</div>

						<div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 sm:p-5">
							<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
								<h3 className="text-sm font-bold text-[#1E293B]">Filtrar expedientes</h3>
								<p className="text-xs text-[#64748B]">
									Nombre, matrícula, grado, grupo y carrera (la lista se actualiza al escribir).
								</p>
							</div>
							<div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-6">
								<label className="flex min-w-0 flex-col gap-1">
									<span className="text-xs font-semibold text-[#475569]">Nombre</span>
									<input
										type="text"
										value={filtroNombre}
										onChange={(e) => setFiltroNombre(e.target.value)}
										placeholder="Buscar por nombre"
										className="rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-sm text-[#111827] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#EDE9FE]"
									/>
								</label>
								<label className="flex min-w-0 flex-col gap-1">
									<span className="text-xs font-semibold text-[#475569]">Matrícula</span>
									<input
										type="text"
										value={filtroMatricula}
										onChange={(e) => setFiltroMatricula(e.target.value)}
										placeholder="Matrícula"
										className="rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-sm text-[#111827] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#EDE9FE]"
									/>
								</label>
								<label className="flex min-w-0 flex-col gap-1">
									<span className="text-xs font-semibold text-[#475569]">Grado</span>
									<input
										type="text"
										value={filtroGrado}
										onChange={(e) => setFiltroGrado(e.target.value.replace(/\D+/g, "").slice(0, 1))}
										placeholder="Ej. 1"
										className="rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-sm text-[#111827] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#EDE9FE]"
									/>
								</label>
								<label className="flex min-w-0 flex-col gap-1">
									<span className="text-xs font-semibold text-[#475569]">Grupo</span>
									<input
										type="text"
										value={filtroGrupo}
										onChange={(e) => setFiltroGrupo(e.target.value.toUpperCase().slice(0, 2))}
										placeholder="Letra(s)"
										className="rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-sm text-[#111827] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#EDE9FE]"
									/>
								</label>
								<label className="flex min-w-0 flex-col gap-1 sm:col-span-2 lg:col-span-1 xl:col-span-1">
									<span className="text-xs font-semibold text-[#475569]">Carrera</span>
									<select
										value={filtroCarreraId}
										onChange={(e) => setFiltroCarreraId(e.target.value)}
										className="rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-sm text-[#111827] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#EDE9FE]"
									>
										<option value="">Todas las carreras</option>
										{carreras.map((c) => (
											<option key={c.id} value={c.id}>
												{c.nombre}
											</option>
										))}
									</select>
								</label>
								<div className="flex items-end">
									{hayFiltros ? (
										<button
											type="button"
											onClick={() => {
												setFiltroGrado("");
												setFiltroGrupo("");
												setFiltroCarreraId("");
												setFiltroNombre("");
												setFiltroMatricula("");
											}}
											className="w-full rounded-xl border border-[#CBD5E1] bg-white px-4 py-2.5 text-sm font-semibold text-[#334155] shadow-sm transition hover:bg-[#F1F5F9]"
										>
											Limpiar filtros
										</button>
									) : (
										<span className="hidden text-xs text-[#94A3B8] xl:block">Sin filtros activos</span>
									)}
								</div>
							</div>
						</div>
					</div>

					<div className="mt-6">
						{error ? <p className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{error}</p> : null}
						{cargando ? (
							<p className="text-sm text-slate-600">Cargando alumnos…</p>
						) : alumnos.length === 0 ? (
							<p className="text-sm text-slate-600">No hay alumnos para este filtro.</p>
						) : (
							<div className="space-y-2">
								{alumnos.map((a) => (
									<article
										key={a.padronId}
										className="rounded-xl border border-[#E2E8F0] bg-[#F3F4F6] px-3 py-2.5"
									>
										<div className="flex flex-col gap-2 lg:flex-row lg:items-center lg:justify-between">
											<div className="min-w-0">
												<span className="truncate align-middle text-base font-medium text-[#111827]">
													{a.nombreCompleto}
												</span>
												<span className="mx-2 align-middle text-[#9CA3AF]">|</span>
												<span className="align-middle text-base text-[#111827]">
													{a.grado}
													{a.grupo || "—"}
												</span>
												<span className="mx-2 align-middle text-[#9CA3AF]">|</span>
												<span className="align-middle text-base text-[#111827]">
													{a.matricula || "—"}
												</span>
												<span className="mx-2 align-middle text-[#9CA3AF]">|</span>
												<span className="align-middle text-base text-[#111827]">
													{a.carreraNombre || "—"}
												</span>
											</div>
											<div className="flex shrink-0 gap-2">
												{estadoExpediente === "activo" ? (
													<button
														type="button"
														onClick={() => abrirModalAlumno(a)}
														className="inline-flex items-center gap-2 rounded-lg border border-[#C4B5FD] bg-[#EDE9FE] px-5 py-1.5 text-base font-medium text-[#5B21B6] transition hover:bg-[#DDD6FE]"
													>
														Agregar
														<span aria-hidden className="text-xl leading-none">
															+
														</span>
													</button>
												) : (
													<button
														type="button"
														onClick={() => abrirConfirmActivar(a)}
														className="inline-flex items-center gap-2 rounded-lg border border-[#6EE7B7] bg-[#D1FAE5] px-5 py-1.5 text-base font-medium text-[#047857] transition hover:bg-[#A7F3D0]"
													>
														Activar
														<svg
															aria-hidden
															xmlns="http://www.w3.org/2000/svg"
															viewBox="0 0 24 24"
															fill="none"
															stroke="currentColor"
															strokeWidth="2.5"
															strokeLinecap="round"
															strokeLinejoin="round"
															className="h-5 w-5"
														>
															<path d="M20 6L9 17l-5-5" />
														</svg>
													</button>
												)}
												<button
													type="button"
													onClick={() => abrirModalVerMas(a)}
													className="inline-flex items-center gap-2 rounded-lg border border-[#C4B5FD] bg-[#EDE9FE] px-5 py-1.5 text-base font-medium text-[#5B21B6] transition hover:bg-[#DDD6FE]"
												>
													Ver más
													<svg
														aria-hidden
														xmlns="http://www.w3.org/2000/svg"
														viewBox="0 0 24 24"
														fill="none"
														stroke="currentColor"
														strokeWidth="2"
														className="h-5 w-5"
													>
														<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
														<circle cx="12" cy="12" r="3" />
													</svg>
												</button>
											</div>
										</div>
									</article>
								))}
							</div>
						)}
					</div>
				</div>
			) : seccionActiva === "crear_tabla" ? (
				<CrearTablaOrientador />
			) : seccionActiva === "escaner" ? (
				<EscanerSeccionOrientador />
			) : seccionActiva === "plantillas" ? (
				<PlantillasSeccionOrientador />
			) : seccionActiva === "cargas" ? (
				<CargasPeriodosOrientador modo="cargas" />
			) : seccionActiva === "periodos" ? (
				<CargasPeriodosOrientador modo="periodos" />
			) : seccionActiva === "carreras" ? (
				<CarrerasSistemaOrientador />
			) : seccionActiva === "historial" ? (
				<HistorialAccionesOrientador />
			) : (
				<div className="mx-auto mt-5 max-w-6xl rounded-2xl border border-[#E2E8F0] bg-white p-6 text-center shadow-sm">
					<h2 className="text-lg font-semibold text-slate-900">{etiquetaActiva}</h2>
					<p className="mt-2 text-sm text-slate-600">Seccion nueva en construccion.</p>
				</div>
			)}
			</div>
			{confirmActivarAlumno
				? createPortal(
						<div
							className="fixed inset-0 z-[205] flex items-center justify-center bg-slate-900/50 p-4"
							onClick={(e) => {
								if (e.target === e.currentTarget && !activandoAlumno) {
									cerrarConfirmActivar();
								}
							}}
							role="presentation"
						>
							<div
								className="w-full max-w-md rounded-2xl border border-[#E5E7EB] bg-white p-6 shadow-2xl"
								onClick={(e) => e.stopPropagation()}
								role="dialog"
								aria-modal="true"
								aria-labelledby="titulo-confirmar-activar"
							>
								<h2 id="titulo-confirmar-activar" className="text-lg font-bold text-[#111827]">
									Activar alumno
								</h2>
								<p className="mt-3 text-sm leading-relaxed text-[#4B5563]">
									¿Confirmas que vas a activar a{" "}
									<strong className="font-semibold text-[#111827]">
										{confirmActivarAlumno.nombreCompleto}
									</strong>
									? Volverá a la lista de expedientes activos.
								</p>
								{errorActivar ? (
									<p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-700">{errorActivar}</p>
								) : null}
								<div className="mt-6 flex flex-wrap justify-end gap-2">
									<button
										type="button"
										onClick={cerrarConfirmActivar}
										disabled={activandoAlumno}
										className="rounded-xl border border-[#D1D5DB] bg-white px-4 py-2.5 text-sm font-semibold text-[#374151] transition hover:bg-[#F9FAFB] disabled:opacity-50"
									>
										Cancelar
									</button>
									<button
										type="button"
										onClick={() => void ejecutarActivarAlumno()}
										disabled={activandoAlumno}
										className="inline-flex items-center gap-2 rounded-xl border border-[#059669] bg-[#10B981] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#059669] disabled:cursor-not-allowed disabled:opacity-60"
									>
										{activandoAlumno ? (
											"Activando…"
										) : (
											<>
												Sí, activar
												<svg
													aria-hidden
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2.5"
													strokeLinecap="round"
													strokeLinejoin="round"
													className="h-5 w-5"
												>
													<path d="M20 6L9 17l-5-5" />
												</svg>
											</>
										)}
									</button>
								</div>
							</div>
						</div>,
						document.body,
					)
				: null}
			{modalTokensOpen
				? createPortal(
						<div
							className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-900/50 p-4"
							onClick={(e) => {
								if (e.target === e.currentTarget && guardandoTokenId === null) {
									cerrarModalTokens();
								}
							}}
							role="presentation"
						>
							<div
								className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-2xl border border-[#E5E7EB] bg-white shadow-2xl"
								onClick={(e) => e.stopPropagation()}
								role="dialog"
								aria-modal="true"
								aria-labelledby="titulo-modal-tokens"
							>
								<div className="flex items-start justify-between gap-3 border-b border-[#E5E7EB] px-5 py-4">
									<div>
										<h2 id="titulo-modal-tokens" className="text-lg font-bold text-[#111827]">
											Tokens de acceso
										</h2>
										<p className="mt-1 text-xs text-[#64748B]">
											Clave que usan los alumnos al entrar y fecha límite del acceso. Los cambios aplican a
											todo el grupo vinculado a ese token.
										</p>
									</div>
									<button
										type="button"
										onClick={() => {
											if (guardandoTokenId === null) {
												cerrarModalTokens();
											}
										}}
										className="rounded-lg px-2 py-1 text-sm font-semibold text-[#64748B] hover:bg-[#F3F4F6]"
										aria-label="Cerrar"
									>
										✕
									</button>
								</div>
								<div className="max-h-[calc(90vh-8rem)] overflow-y-auto px-5 py-4">
									{mensajeModalTokens ? (
										<p
											className={`mb-3 rounded-lg px-3 py-2 text-sm ${
												mensajeModalTokens.startsWith("Cambios guardados")
													? "bg-emerald-50 text-emerald-800"
													: "bg-amber-50 text-amber-900"
											}`}
										>
											{mensajeModalTokens}
										</p>
									) : null}
									{tokensModalCargando ? (
										<p className="py-8 text-center text-sm text-[#64748B]">Cargando tokens…</p>
									) : tokensModalFilas.length === 0 ? (
										<p className="py-8 text-center text-sm text-[#64748B]">
											No hay tokens registrados. Crea grupos o una carga de alumnos para generarlos.
										</p>
									) : (
										<ul className="space-y-4">
											{tokensModalFilas.map((row) => (
												<li
													key={row.id}
													className="rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 shadow-sm"
												>
													<div className="mb-3 flex flex-wrap items-center justify-between gap-2">
														<span className="text-base font-bold text-[#111827]">
															{row.grado}° grupo {row.grupo}
														</span>
														<button
															type="button"
															disabled={guardandoTokenId !== null}
															onClick={() => void guardarCambiosTokenRow(row)}
															className="rounded-lg border border-[#7C3AED] bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white shadow-sm hover:bg-[#6D28D9] disabled:opacity-50"
														>
															{guardandoTokenId === row.id ? "Guardando…" : "Guardar"}
														</button>
													</div>
													<div className="grid gap-3 sm:grid-cols-2">
														<label className="flex flex-col gap-1">
															<span className="text-xs font-semibold text-[#475569]">Clave (token)</span>
															<input
																type="text"
																value={row.claveDraft}
																onChange={(e) =>
																	actualizarDraftToken(row.id, {
																		claveDraft: e.target.value.toUpperCase(),
																	})
																}
																className="rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 font-mono text-sm text-[#111827] outline-none focus:border-[#7C3AED]"
																autoComplete="off"
															/>
														</label>
														<label className="flex flex-col gap-1">
															<span className="text-xs font-semibold text-[#475569]">
																Fecha de cierre del acceso
															</span>
															<input
																type="date"
																value={row.fechaDraft}
																onChange={(e) =>
																	actualizarDraftToken(row.id, { fechaDraft: e.target.value })
																}
																className="rounded-lg border border-[#D1D5DB] bg-white px-3 py-2 text-sm text-[#111827] outline-none focus:border-[#7C3AED]"
															/>
														</label>
													</div>
													<p className="mt-2 text-[11px] text-[#64748B]">
														Deja la fecha vacía para quitar el límite. La clave debe ser única en el
														sistema.
													</p>
												</li>
											))}
										</ul>
									)}
								</div>
							</div>
						</div>,
						document.body,
					)
				: null}
			{alumnoModal
				? createPortal(
						<div
							className="fixed inset-0 z-[200] flex items-center justify-center bg-slate-900/40 p-4"
							onClick={cerrarModalAlumno}
							role="presentation"
						>
					{!expedienteSoloActualizarVerMasActivo ? (
					<div
						className="max-h-[92vh] w-full max-w-6xl overflow-y-auto rounded-[2.25rem] border border-[#D1D5DB] bg-[#E5E7EB] p-4 shadow-2xl"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-label={modalExpedienteModo === "ver_mas" ? "Ver más — expediente" : "Detalle de expediente"}
					>
						<div className="flex items-center justify-between gap-3">
							<button
								type="button"
								onClick={cerrarModalAlumno}
								className="inline-flex h-11 w-11 items-center justify-center rounded-full text-[#111827] transition hover:bg-black/5"
								aria-label="Cerrar detalle"
							>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-8 w-8">
									<path d="M19 12H5M12 19l-7-7 7-7" />
								</svg>
							</button>
							<div className="min-w-0 flex-1 text-center">
								<h3 className="truncate text-[2.6rem] font-bold leading-none text-[#111827]">{alumnoModal.nombreCompleto}</h3>
								<p className="mt-2 text-[2.1rem] font-semibold leading-none text-[#6B7280]">
									{alumnoModal.grado}
									{alumnoModal.grupo} <span className="mx-2 text-[#9CA3AF]">|</span> {alumnoModal.matricula || "—"}{" "}
									<span className="mx-2 text-[#9CA3AF]">|</span> {alumnoModal.carreraNombre || "—"}
								</p>
							</div>
							<div className="w-11" />
						</div>

						<div className="mt-5 overflow-x-auto rounded-xl border border-[#D1D5DB] bg-[#F3F4F6] p-3">
							<div className="flex min-w-max gap-3">
								{docsModal.map((doc) => (
									<div key={doc.id} className="w-[200px] rounded-lg border border-[#D1D5DB] bg-white p-3 shadow-sm">
										{modalExpedienteModo === "ver_mas" ? (
											<>
												<p className="mb-1.5 text-center text-xs font-medium text-[#6B7280]">Vista previa</p>
												<div className="flex h-28 w-full items-center justify-center rounded-lg border border-[#E5E7EB] bg-[#F9FAFB]">
													<div className="rounded-xl border-2 border-[#111827] px-5 py-3 text-center">
														<div className="text-4xl font-black leading-none text-[#111827]">PDF</div>
													</div>
												</div>
											</>
										) : (
											<button
												type="button"
												onClick={() => abrirInsertarParaDocumento(doc.id)}
												className="flex h-28 w-full items-center justify-center rounded-lg border border-[#E5E7EB] bg-[#F9FAFB] transition hover:bg-[#F3F4F6]"
											>
												<div className="rounded-xl border-2 border-[#111827] px-5 py-3 text-center">
													<div className="text-4xl font-black leading-none text-[#111827]">PDF</div>
												</div>
											</button>
										)}
										<p className="mt-2 truncate text-center text-[1.1rem] font-medium text-[#111827]">{doc.nombre}</p>
										{doc.archivoAdjunto ? (
											<p className="truncate text-center text-xs text-[#059669]" title={doc.archivoAdjunto}>
												{doc.archivoAdjunto}
											</p>
										) : null}
										<div className="mt-2 grid grid-cols-2 gap-2">
											<button
												type="button"
												onClick={() => setDocPreview(doc)}
												className="inline-flex items-center justify-center gap-1 rounded-md border border-[#9CA3AF] bg-[#9CA3AF] px-2 py-1 text-sm font-medium text-[#111827] hover:bg-[#6B7280] hover:text-white"
												aria-label={`Vista previa ${doc.nombre}`}
											>
												<svg
													aria-hidden
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													className="h-5 w-5"
												>
													<path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z" />
													<circle cx="12" cy="12" r="3" />
												</svg>
											</button>
											<button
												type="button"
												onClick={() => descargarDocumentoIndividual(doc)}
												className="inline-flex items-center justify-center rounded-md border border-[#9CA3AF] bg-[#9CA3AF] px-2 py-1 text-sm font-medium text-[#111827] hover:bg-[#6B7280] hover:text-white"
												aria-label={`Descargar ${doc.nombre}`}
											>
												<svg
													aria-hidden
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2.5"
													className="h-5 w-5"
												>
													<path d="M12 3v13M7 12l5 5 5-5M4 21h16" />
												</svg>
											</button>
										</div>
										{modalExpedienteModo === "edicion" ? (
											<button
												type="button"
												onClick={() => eliminarDocumentoDeModal(doc.id)}
												className="mt-2 inline-flex w-full items-center justify-center rounded-md border border-[#9CA3AF] bg-[#9CA3AF] px-2 py-1 text-sm font-medium text-[#111827] hover:bg-[#6B7280] hover:text-white"
											>
												<svg
													aria-hidden
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													className="h-5 w-5"
												>
													<path d="M3 6h18" />
													<path d="M19 6v14a2 2 0 0 1-2 2H7a2 2 0 0 1-2-2V6" />
													<path d="M8 6V4a2 2 0 0 1 2-2h4a2 2 0 0 1 2 2v2" />
													<path d="M10 11v6M14 11v6" />
												</svg>
											</button>
										) : null}
									</div>
								))}
							</div>
						</div>

						{modalExpedienteModo === "ver_mas" ? (
							<div className="mt-4 grid gap-3 sm:grid-cols-2">
								<button
									type="button"
									onClick={() => void descargarTodoZip()}
									disabled={zipDescargando}
									className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#9CA3AF] bg-[#9CA3AF] px-4 py-3 text-xl font-semibold text-[#111827] transition hover:bg-[#6B7280] hover:text-white disabled:opacity-50 sm:text-2xl"
								>
									<svg
										aria-hidden
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										className="h-7 w-7 shrink-0"
									>
										<path d="M12 3v13M7 12l5 5 5-5M4 21h16" />
									</svg>
									{zipDescargando ? "Generando…" : "Descargar todo"}
								</button>
								{alumnoModal.estado === "inactivo" ? (
									<button
										type="button"
										onClick={() => {
											if (alumnoModal) {
												abrirConfirmActivar(alumnoModal);
											}
										}}
										className="inline-flex items-center justify-center gap-3 rounded-2xl border border-[#9CA3AF] bg-[#9CA3AF] px-4 py-3 text-xl font-semibold text-[#111827] transition hover:bg-[#6B7280] hover:text-white sm:text-2xl"
									>
										Volver a activar
										<span className="inline-flex h-10 w-10 items-center justify-center rounded-full border-2 border-[#111827] bg-white">
											<svg
												aria-hidden
												xmlns="http://www.w3.org/2000/svg"
												viewBox="0 0 24 24"
												fill="none"
												stroke="currentColor"
												strokeWidth="2.8"
												strokeLinecap="round"
												strokeLinejoin="round"
												className="h-6 w-6 text-[#111827]"
											>
												<path d="M20 6L9 17l-5-5" />
											</svg>
										</span>
									</button>
								) : (
									<button
										type="button"
										onClick={(e) => {
											e.stopPropagation();
											abrirModalActualizarDatos();
										}}
										className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#9CA3AF] bg-[#9CA3AF] px-4 py-3 text-xl font-semibold text-[#111827] transition hover:bg-[#6B7280] hover:text-white sm:text-2xl"
									>
										Actualizar datos
									</button>
								)}
							</div>
						) : (
							<div className="mt-4 grid gap-3 md:grid-cols-3">
								<button
									type="button"
									onClick={() => void descargarTodoZip()}
									disabled={zipDescargando}
									className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#9CA3AF] bg-[#9CA3AF] px-4 py-3 text-[2rem] font-medium text-[#111827] transition hover:bg-[#6B7280] hover:text-white disabled:opacity-50"
								>
									{zipDescargando ? "Generando..." : "Descargar todo"} ⬇
								</button>
								<button
									type="button"
									onClick={abrirInsertarLibre}
									className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#9CA3AF] bg-[#9CA3AF] px-4 py-3 text-[2rem] font-medium text-[#111827] transition hover:bg-[#6B7280] hover:text-white"
								>
									Agregar archivo +
								</button>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										abrirModalActualizarDatos();
									}}
									className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#9CA3AF] bg-[#9CA3AF] px-4 py-3 text-[2rem] font-medium text-[#111827] transition hover:bg-[#6B7280] hover:text-white"
								>
									Actualizar datos
								</button>
							</div>
						)}
					</div>
					) : null}
					{modalActualizarDatos ? (
						<div
							className={
								expedienteSoloActualizarVerMasActivo
									? "pointer-events-none absolute inset-0 z-[210] flex items-center justify-center p-4"
									: "absolute inset-0 z-[210] flex items-center justify-center bg-slate-900/55 p-4"
							}
							onClick={(e) => {
								e.stopPropagation();
								if (!expedienteSoloActualizarVerMasActivo) {
									cerrarModalActualizarDatos();
								}
							}}
							role="presentation"
						>
							<div
								className="pointer-events-auto w-full max-w-2xl rounded-[2.25rem] border border-[#E5E7EB] bg-white p-8 shadow-2xl sm:p-10"
								onClick={(e) => e.stopPropagation()}
								role="dialog"
								aria-modal="true"
								aria-label="Actualizar datos del alumno"
							>
								<div className="relative mb-8 flex items-center justify-center pb-2">
									<button
										type="button"
										onClick={cerrarModalActualizarDatos}
										className="absolute left-0 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-[#111827] transition hover:bg-black/5"
										aria-label="Volver"
									>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-7 w-7">
											<path d="M19 12H5M12 19l-7-7 7-7" />
										</svg>
									</button>
									<h2 className="px-12 text-center text-2xl font-bold tracking-tight text-[#111827] sm:text-[1.65rem]">
										Actualizar datos del Alumno
									</h2>
								</div>

								<div>
									{catalogosActualizarCargando ? (
										<p className="mb-4 text-center text-sm text-[#6B7280]">Cargando grupos y carreras…</p>
									) : null}
									{errorCatalogoActualizar ? (
										<p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{errorCatalogoActualizar}</p>
									) : null}
									{errorGuardarActualizar ? (
										<p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{errorGuardarActualizar}</p>
									) : null}

									<div className="space-y-0 divide-y divide-[#E8E8E8]">
										<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
											<span className="text-right text-sm font-bold text-[#111827] sm:text-base">Nombre:</span>
											<p className="text-base font-normal text-[#111827] sm:text-[1.05rem]">{alumnoModal.nombreCompleto}</p>
										</div>

										<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
											<label htmlFor="act-grado" className="text-right text-sm font-bold text-[#111827] sm:text-base">
												Grado:
											</label>
											<input
												id="act-grado"
												type="text"
												inputMode="numeric"
												value={formActGrado}
												onChange={(e) => {
													const next = e.target.value.replace(/\D+/g, "").slice(0, 1);
													if (next !== formActGrado) {
														setFormActGrupoDestino("");
													}
													setFormActGrado(next);
												}}
												className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.07)] outline-none focus:border-[#9CA3AF] sm:py-3"
											/>
										</div>

										<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
											<label htmlFor="act-grupo" className="text-right text-sm font-bold text-[#111827] sm:text-base">
												Grupo:
											</label>
											<div className="min-w-0">
												<select
													id="act-grupo"
													value={formActGrupoDestino}
													onChange={(e) => setFormActGrupoDestino(e.target.value)}
													disabled={
														catalogosActualizarCargando ||
														formActGrado.trim() === "" ||
														gruposParaSelectActualizar.length === 0
													}
													className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.07)] outline-none focus:border-[#9CA3AF] disabled:opacity-60 sm:py-3"
												>
													<option value="">
														{formActGrado.trim() === ""
															? "— Indica primero el grado —"
															: "— Selecciona grupo —"}
													</option>
													{gruposParaSelectActualizar.map((g) => {
														const v = idDestinoGrupoCatalogo(g);
														return (
															<option key={v} value={v}>
																Grupo {g.grupo}
															</option>
														);
													})}
												</select>
											</div>
										</div>

										<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
											<label htmlFor="act-matricula" className="text-right text-sm font-bold text-[#111827] sm:text-base">
												Matricula:
											</label>
											<input
												id="act-matricula"
												type="text"
												value={formActMatricula}
												onChange={(e) => setFormActMatricula(e.target.value)}
												className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.07)] outline-none focus:border-[#9CA3AF] sm:py-3"
											/>
										</div>

										<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
											<label htmlFor="act-carrera" className="text-right text-sm font-bold text-[#111827] sm:text-base">
												Carrera:
											</label>
											<select
												id="act-carrera"
												value={formActCarreraId}
												onChange={(e) => setFormActCarreraId(e.target.value)}
												disabled={catalogosActualizarCargando}
												className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.07)] outline-none focus:border-[#9CA3AF] disabled:opacity-60 sm:py-3"
											>
												<option value="">— Sin carrera —</option>
												{catalogoCarrerasActualizar.map((c) => (
													<option key={c.id} value={c.id}>
														{c.nombre}
													</option>
												))}
											</select>
										</div>

										<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-start gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:items-center sm:gap-6">
											<span className="pt-2.5 text-right text-sm font-bold text-[#111827] sm:pt-0 sm:text-base">Estado:</span>
											<div
												className="inline-flex max-w-md rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] p-1 shadow-[inset_0_1px_2px_rgba(0,0,0,0.04)]"
												role="group"
												aria-label="Estado del expediente"
											>
												<button
													type="button"
													onClick={() => setFormActEstado("activo")}
													className={`min-w-[6.5rem] flex-1 rounded-lg px-4 py-2.5 text-center text-sm font-bold transition sm:min-w-[7.5rem] sm:py-3 sm:text-base ${
														formActEstado === "activo"
															? "bg-[#7C3AED] text-white shadow-sm"
															: "bg-transparent text-[#374151] hover:bg-violet-50"
													}`}
												>
													Activo
												</button>
												<button
													type="button"
													onClick={() => setFormActEstado("inactivo")}
													className={`min-w-[6.5rem] flex-1 rounded-lg px-4 py-2.5 text-center text-sm font-bold transition sm:min-w-[7.5rem] sm:py-3 sm:text-base ${
														formActEstado === "inactivo"
															? "bg-[#DC2626] text-white shadow-sm"
															: "bg-transparent text-[#374151] hover:bg-red-50"
													}`}
												>
													Inactivo
												</button>
											</div>
										</div>
									</div>

									<button
										type="button"
										onClick={() => void guardarActualizarDatosAlumno()}
										disabled={guardandoActualizar || catalogosActualizarCargando}
										className="mx-auto mt-10 flex w-full max-w-xl justify-center rounded-2xl border border-[#9CA3AF] bg-[#D1D5DB] py-3.5 text-center text-base font-bold text-[#111827] transition hover:bg-[#C4C4C4] disabled:opacity-50 sm:py-4 sm:text-lg"
									>
										{guardandoActualizar ? "Guardando…" : "Actualizar"}
									</button>
								</div>
							</div>
						</div>
					) : null}
						</div>,
						document.body,
					)
				: null}
			{insertarModal && alumnoModal
				? createPortal(
						<div
							className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-900/50 p-4"
					onClick={clicBackdropInsertarArchivos}
					role="presentation"
				>
					<div
						className="w-full max-w-3xl rounded-2xl border border-[#D1D5DB] bg-white p-5 shadow-2xl sm:p-8"
						onClick={(e) => e.stopPropagation()}
						onMouseDown={(e) => e.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-label="Insertar archivos"
					>
						<input
							ref={fileInsertRef}
							id="orientador-insertar-archivo-file"
							type="file"
							className="sr-only"
							accept="application/pdf,image/*"
							onChange={onArchivoInsertarElegido}
							tabIndex={-1}
						/>
						<div className="relative flex items-center justify-center border-b border-[#E5E7EB] pb-4">
							<button
								type="button"
								onClick={cerrarInsertarModal}
								className="absolute left-0 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-[#111827] transition hover:bg-black/5"
								aria-label="Volver"
							>
								<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-7 w-7">
									<path d="M19 12H5M12 19l-7-7 7-7" />
								</svg>
							</button>
							<h2 className="text-center text-xl font-bold text-[#111827] sm:text-2xl">Insertar Archivos</h2>
						</div>

						<div className="mt-6 grid gap-6 md:grid-cols-[1fr_auto] md:items-start">
							<div className="space-y-4">
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										e.preventDefault();
										abrirSelectorArchivoInsertar();
									}}
									className="flex min-h-[11rem] w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#D1D5DB] bg-[#FAFAFA] p-6 text-center shadow-sm transition hover:border-[#A78BFA] hover:bg-[#F5F3FF]"
								>
									<p className="text-sm font-medium text-[#6B7280]">
										{archivoInsertar ? archivoInsertar.name : "Ningún archivo seleccionado…"}
									</p>
									<p className="mt-2 text-base font-semibold text-[#5B21B6]">Agregar archivo</p>
								</button>

								{insertarModal.docIdFijo !== null ? (
									<div className="rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
										<p className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">Documento</p>
										<p className="mt-1 text-lg font-semibold text-[#111827]">
											{documentoInsertarFijo?.nombre ?? "—"}
										</p>
										<p className="mt-1 text-sm text-[#6B7280]">El nombre del documento ya está definido para este trámite.</p>
									</div>
								) : (
									<div>
										<label htmlFor="nombre-archivo-libre" className="mb-1.5 block text-sm font-medium text-[#374151]">
											Nombre del archivo
										</label>
										<input
											id="nombre-archivo-libre"
											type="text"
											value={nombreInsertarLibre}
											onChange={(e) => setNombreInsertarLibre(e.target.value)}
											placeholder="Ej. comprobante de pago"
											className="w-full rounded-xl border border-[#D1D5DB] bg-white px-4 py-3 text-base text-[#111827] outline-none focus:border-[#A78BFA] focus:ring-2 focus:ring-[#EDE9FE]"
										/>
									</div>
								)}
							</div>

							<div className="flex flex-col gap-3 md:w-[min(100%,14rem)]">
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										abrirModalCamara();
									}}
									className="inline-flex min-h-[4.5rem] flex-1 items-center justify-between gap-3 rounded-2xl border border-[#9CA3AF] bg-[#D1D5DB] px-4 py-3 text-left text-sm font-semibold text-[#111827] transition hover:bg-[#9CA3AF]"
								>
									<span className="leading-tight">Escanear mediante cámara</span>
									<svg
										aria-hidden
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										className="h-10 w-10 shrink-0"
									>
										<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
										<circle cx="12" cy="13" r="4" />
									</svg>
								</button>
								<button
									type="button"
									onClick={confirmarInsertarArchivos}
									disabled={
										!archivoInsertar ||
										(insertarModal.docIdFijo === null && nombreInsertarLibre.trim() === "")
									}
									className="inline-flex min-h-[4.5rem] flex-1 items-center justify-between gap-3 rounded-2xl border border-[#9CA3AF] bg-[#D1D5DB] px-4 py-3 text-left text-sm font-semibold text-[#111827] transition hover:bg-[#9CA3AF] disabled:cursor-not-allowed disabled:opacity-45"
								>
									<span className="leading-tight">Agregar archivos seleccionados</span>
									<svg
										aria-hidden
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										className="h-10 w-10 shrink-0"
									>
										<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
									</svg>
								</button>
							</div>
						</div>
					</div>
						</div>,
						document.body,
					)
				: null}
			{modalCamaraAbierto && insertarModal && alumnoModal
				? createPortal(
						<div
							className="fixed inset-0 z-[230] flex items-center justify-center bg-slate-900/70 p-4"
					onClick={cerrarModalCamara}
					role="presentation"
				>
					<div
						className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#D1D5DB] bg-white shadow-2xl"
						onClick={(e) => e.stopPropagation()}
						role="dialog"
						aria-modal="true"
						aria-label="Cámara"
					>
						<div className="flex items-center justify-between border-b border-[#E5E7EB] px-4 py-3">
							<h3 className="text-lg font-bold text-[#111827]">Tomar foto</h3>
							<button
								type="button"
								onClick={cerrarModalCamara}
								className="inline-flex h-9 w-9 items-center justify-center rounded-full text-[#111827] hover:bg-black/5"
								aria-label="Cerrar cámara"
							>
								✕
							</button>
						</div>
						<div className="relative bg-black">
							<video
								ref={videoCamaraRef}
								autoPlay
								playsInline
								muted
								className="aspect-video w-full object-cover"
							/>
							{mensajeErrorCamara ? (
								<div className="absolute inset-0 flex items-center justify-center bg-black/80 p-4">
									<p className="text-center text-sm text-white">{mensajeErrorCamara}</p>
								</div>
							) : null}
						</div>
						<div className="flex flex-wrap items-center justify-end gap-2 border-t border-[#E5E7EB] p-4">
							<button
								type="button"
								onClick={cerrarModalCamara}
								className="rounded-xl border border-[#D1D5DB] bg-white px-4 py-2.5 text-sm font-semibold text-[#374151] hover:bg-[#F9FAFB]"
							>
								Cancelar
							</button>
							<button
								type="button"
								onClick={capturarFotoDesdeCamara}
								disabled={!!mensajeErrorCamara}
								className="rounded-xl border border-[#7C3AED] bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white transition hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-50"
							>
								Capturar foto
							</button>
						</div>
					</div>
						</div>,
						document.body,
					)
				: null}
			{docPreview
				? createPortal(
						<div
							className="fixed inset-0 z-[240] flex items-center justify-center bg-slate-900/55 p-4"
							onClick={() => setDocPreview(null)}
							role="presentation"
						>
							<div
								className="flex max-h-[min(92vh,900px)] w-full max-w-4xl flex-col rounded-2xl border border-[#D1D5DB] bg-white shadow-2xl"
								onClick={(e) => e.stopPropagation()}
								role="dialog"
								aria-modal="true"
								aria-label="Vista previa de documento"
							>
								<div className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] px-4 py-3 sm:px-6">
									<div className="min-w-0 pr-2">
										<h4 className="truncate text-lg font-bold text-[#111827] sm:text-xl">{docPreview.nombre}</h4>
										{docPreview.archivoAdjunto ? (
											<p className="truncate text-xs text-[#6B7280]" title={docPreview.archivoAdjunto}>
												{docPreview.archivoAdjunto}
											</p>
										) : null}
									</div>
									<button
										type="button"
										onClick={() => setDocPreview(null)}
										className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#111827] hover:bg-black/5"
										aria-label="Cerrar vista previa"
									>
										✕
									</button>
								</div>
								<div className="min-h-[min(70vh,640px)] flex-1 overflow-hidden bg-[#F3F4F6] p-3 sm:p-4">
									{docPreviewCargando ? (
										<div className="flex h-[min(70vh,640px)] w-full flex-col items-center justify-center gap-3 text-[#4B5563]">
											<span className="inline-block h-10 w-10 animate-spin rounded-full border-2 border-[#7C3AED] border-t-transparent" />
											<p className="text-sm font-medium">Cargando documento…</p>
										</div>
									) : docPreviewError ? (
										<div className="flex h-[min(70vh,640px)] w-full items-center justify-center p-4 text-center">
											<p className="max-w-md text-sm text-[#B45309]">{docPreviewError}</p>
										</div>
									) : docPreviewUrl && docPreviewMime ? (
										<div className="h-[min(70vh,640px)] w-full overflow-auto rounded-xl border border-[#E5E7EB] bg-white shadow-inner">
											{docPreviewMime.startsWith("image/") ? (
												/* eslint-disable-next-line @next/next/no-img-element -- blob URL del expediente */
												<img
													src={docPreviewUrl}
													alt={`Vista previa ${docPreview.nombre}`}
													className="mx-auto max-h-[min(70vh,640px)] w-auto max-w-full object-contain"
												/>
											) : (
												<iframe
													title={`Vista previa ${docPreview.nombre}`}
													src={docPreviewUrl}
													className="h-[min(70vh,640px)] w-full border-0 bg-white"
												/>
											)}
										</div>
									) : (
										<div className="flex h-[min(70vh,640px)] w-full items-center justify-center text-sm text-[#6B7280]">
											Sin vista previa.
										</div>
									)}
								</div>
							</div>
						</div>,
						document.body,
					)
				: null}
			{modalCrearExpediente
				? createPortal(
						<div
							className="fixed inset-0 z-[250] flex items-center justify-center bg-slate-900/55 p-4"
							onClick={(e) => {
								if (e.target === e.currentTarget) {
									cerrarModalCrearExpediente();
								}
							}}
							role="presentation"
						>
							<div
								className="w-full max-w-2xl rounded-[2.25rem] border border-[#E5E7EB] bg-white p-8 shadow-2xl sm:p-10"
								onClick={(e) => e.stopPropagation()}
								role="dialog"
								aria-modal="true"
								aria-label="Crear nuevo expediente"
							>
								<div className="relative mb-8 flex items-center justify-center pb-2">
									<button
										type="button"
										onClick={cerrarModalCrearExpediente}
										className="absolute left-0 top-1/2 inline-flex h-10 w-10 -translate-y-1/2 items-center justify-center rounded-full text-[#111827] transition hover:bg-black/5"
										aria-label="Volver"
									>
										<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" className="h-7 w-7">
											<path d="M19 12H5M12 19l-7-7 7-7" />
										</svg>
									</button>
									<h2 className="px-12 text-center text-2xl font-bold tracking-tight text-[#111827] sm:text-[1.65rem]">
										Crear nuevo expediente
									</h2>
								</div>

								<div>
									{catalogosCrearCargando ? (
										<p className="mb-4 text-center text-sm text-[#6B7280]">Cargando grupos y carreras…</p>
									) : null}
									{errorCatalogoCrear ? (
										<p className="mb-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">{errorCatalogoCrear}</p>
									) : null}
									{errorGuardarCrear ? (
										<p className="mb-4 rounded-xl bg-red-50 px-3 py-2 text-sm text-red-700">{errorGuardarCrear}</p>
									) : null}

									<div className="space-y-0 divide-y divide-[#E8E8E8]">
										<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
											<label htmlFor="crear-nombre" className="text-right text-sm font-bold text-[#111827] sm:text-base">
												Nombre:
											</label>
											<input
												id="crear-nombre"
												type="text"
												value={formCrearNombre}
												onChange={(e) => setFormCrearNombre(e.target.value)}
												placeholder="Nombre completo"
												className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.07)] outline-none focus:border-[#9CA3AF] sm:py-3"
											/>
										</div>

										<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
											<label htmlFor="crear-grado" className="text-right text-sm font-bold text-[#111827] sm:text-base">
												Grado:
											</label>
											<input
												id="crear-grado"
												type="text"
												inputMode="numeric"
												value={formCrearGrado}
												onChange={(e) => {
													const next = e.target.value.replace(/\D+/g, "").slice(0, 1);
													if (next !== formCrearGrado) {
														setFormCrearGrupoDestino("");
													}
													setFormCrearGrado(next);
												}}
												className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.07)] outline-none focus:border-[#9CA3AF] sm:py-3"
											/>
										</div>

										<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
											<label htmlFor="crear-grupo" className="text-right text-sm font-bold text-[#111827] sm:text-base">
												Grupo:
											</label>
											<div className="min-w-0">
												<select
													id="crear-grupo"
													value={formCrearGrupoDestino}
													onChange={(e) => setFormCrearGrupoDestino(e.target.value)}
													disabled={
														catalogosCrearCargando ||
														formCrearGrado.trim() === "" ||
														gruposParaSelectCrear.length === 0
													}
													className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.07)] outline-none focus:border-[#9CA3AF] disabled:opacity-60 sm:py-3"
												>
													<option value="">
														{formCrearGrado.trim() === ""
															? "— Indica primero el grado —"
															: "— Selecciona grupo —"}
													</option>
													{gruposParaSelectCrear.map((g) => {
														const v = idDestinoGrupoCatalogo(g);
														return (
															<option key={v} value={v}>
																Grupo {g.grupo}
															</option>
														);
													})}
												</select>
												<p className="mt-1.5 text-xs text-[#6B7280]">
													Solo aparecen grupos del <span className="font-semibold">mismo grado</span> que escribiste
													(arriba).
												</p>
											</div>
										</div>

										<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
											<label htmlFor="crear-matricula" className="text-right text-sm font-bold text-[#111827] sm:text-base">
												Matricula:
											</label>
											<input
												id="crear-matricula"
												type="text"
												value={formCrearMatricula}
												onChange={(e) => setFormCrearMatricula(e.target.value)}
												className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.07)] outline-none focus:border-[#9CA3AF] sm:py-3"
											/>
										</div>

										<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
											<label htmlFor="crear-carrera" className="text-right text-sm font-bold text-[#111827] sm:text-base">
												Carrera:
											</label>
											<select
												id="crear-carrera"
												value={formCrearCarreraId}
												onChange={(e) => setFormCrearCarreraId(e.target.value)}
												disabled={catalogosCrearCargando}
												className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.07)] outline-none focus:border-[#9CA3AF] disabled:opacity-60 sm:py-3"
											>
												<option value="">— Sin carrera —</option>
												{catalogoCarrerasCrear.map((c) => (
													<option key={c.id} value={c.id}>
														{c.nombre}
													</option>
												))}
											</select>
										</div>
									</div>

									<button
										type="button"
										onClick={() => void guardarCrearExpediente()}
										disabled={guardandoCrear || catalogosCrearCargando}
										className="mx-auto mt-10 flex w-full max-w-xl items-center justify-between gap-4 rounded-2xl border border-[#9CA3AF] bg-[#D1D5DB] px-6 py-3.5 text-left transition hover:bg-[#C4C4C4] disabled:opacity-50 sm:py-4"
									>
										<span className="text-base font-bold text-[#111827] sm:text-lg">Crear</span>
										<svg
											aria-hidden
											xmlns="http://www.w3.org/2000/svg"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											strokeLinecap="round"
											strokeLinejoin="round"
											className="h-10 w-10 shrink-0 text-[#111827]"
										>
											<path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
											<circle cx="12" cy="10" r="2.5" />
											<path d="M8 16c1.2-1.5 2.8-2.25 4-2.25s2.8.75 4 2.25" />
										</svg>
									</button>
								</div>
							</div>
						</div>,
						document.body,
					)
				: null}
			{seccionActiva === "expediente" ? (
				<button
					type="button"
					aria-label="Crear nuevo expediente"
					onClick={abrirModalCrearExpediente}
					className="fixed bottom-6 right-6 z-[30] flex h-16 w-16 items-center justify-center rounded-full border border-[#C4B5FD] bg-[#DDD6FE] text-[3rem] font-bold leading-[1] text-[#6D28D9] shadow-lg transition hover:bg-[#C4B5FD] sm:h-20 sm:w-20 sm:text-[3.5rem]"
				>
					<span className="relative -mt-2">+</span>
				</button>
			) : null}
		</div>
	);
}
