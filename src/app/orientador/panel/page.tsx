"use client";

import JSZip from "jszip";
import { useSearchParams } from "next/navigation";
import CargasPeriodosOrientador, { type ContextoModalTokensCargas } from "./CargasPeriodosOrientador";
import EscolarSeccionOrientador from "./EscolarSeccionOrientador";
import CrearTablaOrientador from "./CrearTablaOrientador";
import PlantillasSeccionOrientador from "./PlantillasSeccionOrientador";
import HistorialAccionesOrientador from "./HistorialAccionesOrientador";
import ModalAccionesMasivasGruposExpediente from "./ModalAccionesMasivasGruposExpediente";
import {
	ANCLA_SECCION,
	runEnfocarSeccion,
	type SeccionOrientadorEnfoque,
} from "./orientador-panel-enfoque";
import { useOrientadorRolPanel } from "./OrientadorPanelRolContext";
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
	CAMPOS_EDITABLES_POR_TRAMITE_OCR,
	esTramiteConPlantillaOcr,
	type TramitePlantillaOcr,
} from "@/lib/ocr/campos-editables-por-tramite-ocr";
import {
	etiquetaCampoOcr,
	textoConfianzaOcr,
	type CampoOcrCelda,
} from "@/lib/ocr/campos-ocr-vista";
import { fechaOcrUiCorta, mensajeOcrUiCorto } from "@/lib/ocr/mensaje-ocr-ui-corto";
import {
	esTipoAdjuntoOrientador,
	esTipoDocumentoValido,
	type TipoDocumentoClave,
} from "@/lib/nombre-archivo";
import { DURACION_MENSAJE_EMERGENTE_MS } from "@/lib/ui/duracion-mensaje-emergente-ms";
import { GRADO_ESCOLAR_MAX, gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";
import { alumnoRequiereCarrera, gradoEscolarNumerico } from "@/lib/padron/requiere-carrera";

type SeccionNuevaOrientador = SeccionOrientadorEnfoque;

const SECCIONES_MENU_NUEVO: { id: SeccionNuevaOrientador; etiqueta: string }[] = [
	{ id: "expediente", etiqueta: "Expediente" },
	{ id: "crear_tabla", etiqueta: "Crear tabla" },
	{ id: "plantillas", etiqueta: "Plantillas" },
	{ id: "cargas", etiqueta: "Cargas" },
	{ id: "escolar", etiqueta: "Escolar" },
	{ id: "historial", etiqueta: "Historial" },
];

function esSeccionNuevaOrientador(v: string | null): v is SeccionNuevaOrientador {
	return (
		v === "expediente" ||
		v === "crear_tabla" ||
		v === "plantillas" ||
		v === "cargas" ||
		v === "escolar" ||
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

type CargaHistorialParaExpediente = {
	id: string;
	fechaCierre: string;
	gradoCarga: number;
	gruposLetras: string[];
	creadoEn: string;
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

/** Acepta camelCase o snake_case por si el JSON no coincide con el tipo TypeScript. */
function filaGrupoCatalogoDesdeApi(raw: unknown): GrupoResumenCatalogo | null {
	if (raw == null || typeof raw !== "object") {
		return null;
	}
	const o = raw as Record<string, unknown>;
	const idRaw = o.id;
	const id = idRaw != null && String(idRaw).trim() !== "" ? String(idRaw).trim() : null;
	const igRaw = o.institucionGrupoId ?? o.institucion_grupo_id;
	const institucionGrupoId =
		igRaw != null && String(igRaw).trim() !== "" ? String(igRaw).trim() : null;
	const grado = String(o.grado ?? "").trim();
	const grupo = String(o.grupo ?? "").trim();
	if (!id && !institucionGrupoId) {
		return null;
	}
	return { id, institucionGrupoId, grado, grupo };
}

function gradoCatalogoNumero(grado: string | number | null | undefined): number {
	const n = Number.parseInt(String(grado ?? "").trim(), 10);
	return Number.isFinite(n) ? n : 0;
}

function letraGrupoCatalogoNormalizada(grupo: string | null | undefined): string {
	return String(grupo ?? "")
		.trim()
		.toUpperCase();
}

/** Misma letra de grupo (A, B…) en otro grado escolar → token/destino correcto para el PATCH. */
function idGrupoCatalogoMismaLetra(
	cat: GrupoResumenCatalogo[],
	gradoNuevo: string,
	letra: string,
): string {
	const gdN = gradoCatalogoNumero(gradoNuevo);
	const lt = letra.trim().toUpperCase();
	if (gdN < 1 || !lt) {
		return "";
	}
	const row = cat.find(
		(x) => gradoCatalogoNumero(x.grado) === gdN && letraGrupoCatalogoNormalizada(x.grupo) === lt,
	);
	return row ? idDestinoGrupoCatalogo(row) : "";
}

function resolverGrupoDestinoParaGradoModal(
	cat: GrupoResumenCatalogo[],
	gradoStr: string,
	destInicial: string,
	letraExpediente: string,
): string {
	const gd = gradoStr.trim();
	if (!gd || cat.length === 0) {
		return String(destInicial ?? "").trim();
	}
	const letraX = String(letraExpediente ?? "").trim().toUpperCase();
	const sel = String(destInicial ?? "").trim();
	if (!sel) {
		return letraX ? idGrupoCatalogoMismaLetra(cat, gd, letraX) : "";
	}
	const row = cat.find((x) => idDestinoGrupoCatalogo(x) === sel);
	if (row && gradoCatalogoNumero(row.grado) === gradoCatalogoNumero(gd)) {
		return sel;
	}
	const letra = row ? letraGrupoCatalogoNormalizada(row.grupo) : letraX;
	const fallback = letra ? idGrupoCatalogoMismaLetra(cat, gd, letra) : "";
	return fallback || "";
}

type DocumentoModal = {
	id: string;
	nombre: string;
	archivoAdjunto?: string;
	esRequerido?: boolean;
	ocrTramite?: string | null;
	ocrExtraidoEn?: string | null;
	ocrError?: string | null;
	ocrCampos?: Record<string, CampoOcrCelda> | null;
};

const DOCUMENTOS_REQUERIDOS_BASE: DocumentoModal[] = [
	{ id: "acta_nacimiento", nombre: "Acta Nacimiento", esRequerido: true },
	{ id: "curp", nombre: "CURP", esRequerido: true },
	{ id: "certificado_medico", nombre: "Certificado Médico", esRequerido: true },
	{ id: "comprobante_domicilio", nombre: "Comprobante Domicilio", esRequerido: true },
	{ id: "ine_tutor", nombre: "INE Tutor", esRequerido: true },
];

type FilaOcrEdicionModal = { clave: string; etiqueta: string; multiline?: boolean };

function tramitePlantillaDesdeDocumentoExpediente(doc: DocumentoModal): TramitePlantillaOcr {
	if (doc.ocrTramite && esTramiteConPlantillaOcr(doc.ocrTramite)) {
		return doc.ocrTramite;
	}
	const porId: Record<string, TramitePlantillaOcr> = {
		acta_nacimiento: "acta_nacimiento",
		curp: "curp",
		ine_tutor: "ine",
		comprobante_domicilio: "comprobante",
		certificado_medico: "certificado_medico",
	};
	return porId[doc.id] ?? "comprobante";
}

function filasOcrEdicionModal(doc: DocumentoModal): FilaOcrEdicionModal[] {
	const tramite = tramitePlantillaDesdeDocumentoExpediente(doc);
	const plantilla = CAMPOS_EDITABLES_POR_TRAMITE_OCR[tramite];
	const campos = doc.ocrCampos ?? {};
	const visto = new Set<string>();
	const out: FilaOcrEdicionModal[] = [];
	for (const p of plantilla) {
		visto.add(p.clave);
		out.push({ clave: p.clave, etiqueta: p.etiqueta, multiline: p.multiline });
	}
	for (const clave of Object.keys(campos)) {
		if (!visto.has(clave)) {
			visto.add(clave);
			out.push({ clave, etiqueta: etiquetaCampoOcr(clave), multiline: true });
		}
	}
	return out;
}

function slugPlano(v: string): string {
	return v
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.replace(/[^a-zA-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.toLowerCase();
}

/** Tras subida, JPG/PNG se guardan como PDF en el servidor. */
function nombreArchivoUiTrasPosiblePdf(orig: File): string {
	const ct = orig.type.toLowerCase();
	if (ct === "image/jpeg" || ct === "image/jpg" || ct === "image/png") {
		return orig.name.replace(/\.[^.]+$/i, "") + ".pdf";
	}
	return orig.name;
}

export default function OrientadorPanelPage() {
	const searchParams = useSearchParams();
	const rolPanel = useOrientadorRolPanel();
	const [seccionActiva, setSeccionActiva] = useState<SeccionNuevaOrientador>("expediente");
	const [estadoExpediente, setEstadoExpediente] = useState<EstadoExpediente>("activo");
	const [modalAccionesGruposExpediente, setModalAccionesGruposExpediente] = useState(false);
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
	const [docDatosOcr, setDocDatosOcr] = useState<DocumentoModal | null>(null);
	type OcrModalVistaEstado = "idle" | "cargando" | "ok" | "sin_archivo";
	const [ocrModalVistaUrl, setOcrModalVistaUrl] = useState<string | null>(null);
	const [ocrModalVistaMime, setOcrModalVistaMime] = useState<string | null>(null);
	const [ocrModalVistaEstado, setOcrModalVistaEstado] = useState<OcrModalVistaEstado>("idle");
	const [ocrEdicionBorrador, setOcrEdicionBorrador] = useState<Record<string, string>>({});
	const [guardandoOcrModal, setGuardandoOcrModal] = useState(false);
	const [errorGuardarOcrModal, setErrorGuardarOcrModal] = useState("");
	const [expedienteDetalleVersion, setExpedienteDetalleVersion] = useState(0);
	const [zipDescargando, setZipDescargando] = useState(false);
	const [insertarModal, setInsertarModal] = useState<{ docIdFijo: string | null } | null>(null);
	const [archivoInsertar, setArchivoInsertar] = useState<File | null>(null);
	const [nombreInsertarLibre, setNombreInsertarLibre] = useState("");
	const [subiendoInsertarArchivo, setSubiendoInsertarArchivo] = useState(false);
	const [errorSubirInsertar, setErrorSubirInsertar] = useState("");
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
	const [filtroTokensPeriodoModal, setFiltroTokensPeriodoModal] = useState<ContextoModalTokensCargas>(null);
	const [errorGuardarActualizar, setErrorGuardarActualizar] = useState("");
	const [guardandoActualizar, setGuardandoActualizar] = useState(false);
	const [formActGrado, setFormActGrado] = useState("");
	const [formActGrupoDestino, setFormActGrupoDestino] = useState("");
	const [formActMatricula, setFormActMatricula] = useState("");
	const [formActCarreraId, setFormActCarreraId] = useState("");
	const [formActEstado, setFormActEstado] = useState<EstadoExpediente>("activo");
	const datosPadronAlAbrirActualizarRef = useRef<{ carreraId: string | null; matricula: string } | null>(null);
	const actGrupoPendienteTrasCatalogoRef = useRef<{ grado: string; letra: string } | null>(null);
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
	const [historialCargasCrear, setHistorialCargasCrear] = useState<CargaHistorialParaExpediente[]>([]);
	const [formCrearCargaId, setFormCrearCargaId] = useState("");
	const [formCrearLetraPlazo, setFormCrearLetraPlazo] = useState("");
	const [confirmActivarAlumno, setConfirmActivarAlumno] = useState<AlumnoExpediente | null>(null);
	const [activandoAlumno, setActivandoAlumno] = useState(false);
	const [errorActivar, setErrorActivar] = useState("");

	useEffect(() => {
		const s = searchParams.get("seccion");
		if (s === "periodos" || s === "carreras") {
			setSeccionActiva("escolar");
			if (typeof window !== "undefined") {
				const url = new URL(window.location.href);
				url.searchParams.set("seccion", "escolar");
				window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
			}
			return;
		}
		if (s === "escaner") {
			setSeccionActiva("expediente");
			if (typeof window !== "undefined") {
				const url = new URL(window.location.href);
				url.searchParams.set("seccion", "expediente");
				window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
			}
			return;
		}
		if (esSeccionNuevaOrientador(s)) {
			if (rolPanel === "normal" && (s === "historial" || s === "escolar")) {
				setSeccionActiva("expediente");
				if (typeof window !== "undefined") {
					const url = new URL(window.location.href);
					url.searchParams.set("seccion", "expediente");
					window.history.replaceState(null, "", `${url.pathname}${url.search}${url.hash}`);
				}
				return;
			}
			setSeccionActiva(s);
			return;
		}
		if (s) {
			setSeccionActiva("expediente");
		}
	}, [searchParams, rolPanel]);

	const seccionesMenuVisibles = useMemo(() => {
		if (rolPanel === "jefe") {
			return SECCIONES_MENU_NUEVO;
		}
		return SECCIONES_MENU_NUEVO.filter((s) => s.id !== "historial" && s.id !== "escolar");
	}, [rolPanel]);

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

	/**
	 * Alinea grupo del desplegable con el grado del formulario: el expediente puede mostrar 2.°
	 * con token aún de 1.°; aquí se resuelve la sección correcta (misma letra A, B…).
	 */
	useEffect(() => {
		if (
			!modalActualizarDatos ||
			catalogosActualizarCargando ||
			catalogoGruposActualizar.length === 0 ||
			!alumnoModal
		) {
			return;
		}
		const gd = formActGrado.trim();
		if (!gd) {
			return;
		}
		const sel = formActGrupoDestino.trim();
		if (!sel) {
			const letraSolo = letraGrupoCatalogoNormalizada(alumnoModal.grupo);
			if (letraSolo) {
				const prop = idGrupoCatalogoMismaLetra(catalogoGruposActualizar, gd, letraSolo);
				if (prop) {
					setFormActGrupoDestino(prop);
				}
			}
			return;
		}
		const row = catalogoGruposActualizar.find((x) => idDestinoGrupoCatalogo(x) === sel);
		if (row && gradoCatalogoNumero(row.grado) === gradoCatalogoNumero(gd)) {
			return;
		}
		const letra = row
			? letraGrupoCatalogoNormalizada(row.grupo)
			: letraGrupoCatalogoNormalizada(alumnoModal.grupo);
		const fallback = letra ? idGrupoCatalogoMismaLetra(catalogoGruposActualizar, gd, letra) : "";
		if (fallback) {
			setFormActGrupoDestino(fallback);
			return;
		}
	}, [
		modalActualizarDatos,
		catalogosActualizarCargando,
		formActGrado,
		formActGrupoDestino,
		catalogoGruposActualizar,
		alumnoModal?.padronId,
		alumnoModal?.grupo,
	]);

	useEffect(() => {
		const pend = actGrupoPendienteTrasCatalogoRef.current;
		if (!pend || !modalActualizarDatos || catalogosActualizarCargando || catalogoGruposActualizar.length === 0) {
			return;
		}
		if (formActGrado.trim() !== pend.grado) {
			actGrupoPendienteTrasCatalogoRef.current = null;
			return;
		}
		if (formActGrupoDestino.trim() !== "") {
			actGrupoPendienteTrasCatalogoRef.current = null;
			return;
		}
		const id = idGrupoCatalogoMismaLetra(catalogoGruposActualizar, pend.grado, pend.letra);
		if (id) {
			setFormActGrupoDestino(id);
		}
		actGrupoPendienteTrasCatalogoRef.current = null;
	}, [
		modalActualizarDatos,
		catalogosActualizarCargando,
		catalogoGruposActualizar,
		formActGrado,
		formActGrupoDestino,
	]);

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
		const gdN = gradoCatalogoNumero(gd);
		const coincideGrado = (x: GrupoResumenCatalogo) => gradoCatalogoNumero(x.grado) === gdN;
		let filas = gd === "" ? [] : catalogoGruposActualizar.filter(coincideGrado);
		const sel = formActGrupoDestino.trim();
		if (sel && !filas.some((x) => idDestinoGrupoCatalogo(x) === sel)) {
			const actual = catalogoGruposActualizar.find((x) => idDestinoGrupoCatalogo(x) === sel);
			if (actual && gradoCatalogoNumero(actual.grado) === gdN) {
				filas = [actual, ...filas];
			} else if (actual && gdN >= 1) {
				const letra = letraGrupoCatalogoNormalizada(actual.grupo);
				const idResuelto = letra ? idGrupoCatalogoMismaLetra(catalogoGruposActualizar, gd, letra) : "";
				const filaResuelta = idResuelto
					? catalogoGruposActualizar.find((x) => idDestinoGrupoCatalogo(x) === idResuelto)
					: null;
				if (filaResuelta) {
					filas = [filaResuelta, ...filas];
				}
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

	const mensajeGrupoActualizarSinOpciones = useMemo(() => {
		if (catalogosActualizarCargando || formActGrado.trim() === "") {
			return "";
		}
		if (gruposParaSelectActualizar.length > 0) {
			return "";
		}
		const gd = formActGrado.trim();
		const gdN = gradoCatalogoNumero(gd);
		const total = catalogoGruposActualizar.length;
		if (total === 0) {
			return "No hay ninguna sección en el catálogo (la tabla institucion_grupos está vacía o la API no devolvió filas). En Supabase SQL Editor ejecuta supabase/institucion_grupos_catalogo_1_6_A_K.sql, guarda, recarga esta página y vuelve a abrir «Actualizar datos».";
		}
		const conEsteGrado = catalogoGruposActualizar.filter(
			(x) => gradoCatalogoNumero(x.grado) === gdN,
		).length;
		if (conEsteGrado === 0) {
			return `Para ${gd}.° no hay secciones en la institución (en base de datos no hay filas en institucion_grupos con ese grado). Hay ${total} sección(es) en otros grados: amplía el catálogo para ${gd}.° o revisa el grado del alumno.`;
		}
		return "Hay datos para este grado pero la lista quedó vacía (p. ej. destinos duplicados). Recarga la página; si continúa, revisa grupo_tokens / institucion_grupos.";
	}, [
		catalogosActualizarCargando,
		formActGrado,
		gruposParaSelectActualizar,
		catalogoGruposActualizar,
	]);

	const gruposParaSelectCrear = useMemo(() => {
		const gd = formCrearGrado.trim();
		const coincideGrado = (x: GrupoResumenCatalogo) => String(x.grado).trim() === gd;
		let filas = gd === "" ? [] : catalogoGruposCrear.filter(coincideGrado);
		const sel = formCrearGrupoDestino.trim();
		if (sel && !filas.some((x) => idDestinoGrupoCatalogo(x) === sel)) {
			const actual = catalogoGruposCrear.find((x) => idDestinoGrupoCatalogo(x) === sel);
			if (actual && String(actual.grado).trim() === gd) {
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

	const esCrearExpedienteGradoUno = formCrearGrado.trim() === "1";

	const cargasPeriodoPrimerGrado = useMemo(
		() => historialCargasCrear.filter((c) => c.gradoCarga === 1),
		[historialCargasCrear],
	);

	const cargaElegidaCrearExpediente = useMemo(
		() => historialCargasCrear.find((c) => c.id === formCrearCargaId.trim()) ?? null,
		[historialCargasCrear, formCrearCargaId],
	);

	const letrasGrupoDesdeCargaElegida = useMemo(() => {
		if (!cargaElegidaCrearExpediente) {
			return [];
		}
		const u = [
			...new Set(
				cargaElegidaCrearExpediente.gruposLetras
					.map((x) => String(x).trim().toUpperCase())
					.filter(Boolean),
			),
		];
		u.sort((a, b) => a.localeCompare(b, "es"));
		return u;
	}, [cargaElegidaCrearExpediente]);

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
				const buf = await res.arrayBuffer();
				if (cancelado) {
					return;
				}
				const headerCt = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
				let mime =
					headerCt !== "" && headerCt !== "application/octet-stream"
						? headerCt
						: "application/octet-stream";
				// PDF en Storage a veces llega como octet-stream.
				if (mime === "application/octet-stream") {
					if (esTipoDocumentoValido(tipo) || esTipoAdjuntoOrientador(tipo)) {
						mime = "application/pdf";
					}
				}
				const blob = new Blob([buf], { type: mime });
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
		if (!docDatosOcr) {
			setOcrModalVistaUrl((prev) => {
				if (prev) {
					URL.revokeObjectURL(prev);
				}
				return null;
			});
			setOcrModalVistaMime(null);
			setOcrModalVistaEstado("idle");
			return;
		}
		const cuentaId = alumnoModal?.cuentaId ?? "";
		const tipo = docDatosOcr.id;
		if (!cuentaId || (!esTipoDocumentoValido(tipo) && !esTipoAdjuntoOrientador(tipo))) {
			setOcrModalVistaUrl((prev) => {
				if (prev) {
					URL.revokeObjectURL(prev);
				}
				return null;
			});
			setOcrModalVistaMime(null);
			setOcrModalVistaEstado("idle");
			return;
		}

		let cancelado = false;
		setOcrModalVistaEstado("cargando");
		setOcrModalVistaUrl((prev) => {
			if (prev) {
				URL.revokeObjectURL(prev);
			}
			return null;
		});
		setOcrModalVistaMime(null);

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
					setOcrModalVistaEstado("sin_archivo");
					return;
				}
				const buf = await res.arrayBuffer();
				if (cancelado) {
					return;
				}
				const headerCt = res.headers.get("content-type")?.split(";")[0]?.trim() ?? "";
				let mime =
					headerCt !== "" && headerCt !== "application/octet-stream"
						? headerCt
						: "application/octet-stream";
				if (mime === "application/octet-stream") {
					if (esTipoDocumentoValido(tipo) || esTipoAdjuntoOrientador(tipo)) {
						mime = "application/pdf";
					}
				}
				const blob = new Blob([buf], { type: mime });
				const url = URL.createObjectURL(blob);
				setOcrModalVistaUrl((anterior) => {
					if (anterior) {
						URL.revokeObjectURL(anterior);
					}
					return url;
				});
				setOcrModalVistaMime(mime);
				setOcrModalVistaEstado("ok");
			} catch {
				if (!cancelado) {
					setOcrModalVistaEstado("sin_archivo");
				}
			}
		})();

		return () => {
			cancelado = true;
		};
	}, [docDatosOcr, alumnoModal?.cuentaId]);

	useEffect(() => {
		if (!alumnoModal?.cuentaId) {
			return;
		}
		const cuentaId = alumnoModal.cuentaId;
		let cancelado = false;
		void (async () => {
			try {
				const res = await fetch(
					`/api/orientador/expediente/${encodeURIComponent(cuentaId)}`,
					{ credentials: "include" },
				);
				if (!res.ok || cancelado) {
					return;
				}
				const data = (await res.json()) as {
					documentos: {
						tipo: string;
						puedeDescargar?: boolean;
						ocrCampos: Record<string, CampoOcrCelda> | null;
						ocrTramite: string | null;
						ocrExtraidoEn: string | null;
						ocrError: string | null;
					}[];
					documentosExtras: {
						tipo: string;
						etiqueta: string;
						puedeDescargar?: boolean;
						ocrCampos: Record<string, CampoOcrCelda> | null;
						ocrTramite: string | null;
						ocrExtraidoEn: string | null;
						ocrError: string | null;
					}[];
				};
				if (cancelado) {
					return;
				}
				setDocsModal(() => {
					const estandar = DOCUMENTOS_REQUERIDOS_BASE.map((d) => {
						const row = data.documentos.find((x) => x.tipo === d.id);
						return {
							...d,
							archivoAdjunto: row?.puedeDescargar ? "Archivo en servidor" : undefined,
							ocrCampos: row?.ocrCampos ?? null,
							ocrTramite: row?.ocrTramite ?? null,
							ocrExtraidoEn: row?.ocrExtraidoEn ?? null,
							ocrError: row?.ocrError ?? null,
						};
					});
					const extras = data.documentosExtras.map((ex) => ({
						id: ex.tipo,
						nombre: ex.etiqueta,
						esRequerido: false as const,
						archivoAdjunto: ex.puedeDescargar ? "Archivo en servidor" : undefined,
						ocrCampos: ex.ocrCampos ?? null,
						ocrTramite: ex.ocrTramite ?? null,
						ocrExtraidoEn: ex.ocrExtraidoEn ?? null,
						ocrError: ex.ocrError ?? null,
					}));
					return [...estandar, ...extras];
				});
			} catch (e) {
				console.error("orientador panel: cargar OCR expediente", e);
			}
		})();
		return () => {
			cancelado = true;
		};
	}, [alumnoModal?.cuentaId, expedienteDetalleVersion]);

	useEffect(() => {
		if (!docDatosOcr) {
			setOcrEdicionBorrador({});
			setErrorGuardarOcrModal("");
			return;
		}
		setErrorGuardarOcrModal("");
		const filas = filasOcrEdicionModal(docDatosOcr);
		const campos = docDatosOcr.ocrCampos ?? {};
		const next: Record<string, string> = {};
		for (const f of filas) {
			const v = campos[f.clave]?.value;
			next[f.clave] = typeof v === "string" ? v : "";
		}
		setOcrEdicionBorrador(next);
	}, [docDatosOcr]);

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

	async function cargarListaTokensModal(filtroParam?: ContextoModalTokensCargas) {
		setTokensModalCargando(true);
		setMensajeModalTokens("");
		const filtroPeriodo = filtroParam !== undefined ? filtroParam : filtroTokensPeriodoModal;
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
			let filas: TokenModalFila[] = [...porId.values()].map((g) => {
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
			if (filtroPeriodo && filtroPeriodo.fechaCierre) {
				const gCarga = filtroPeriodo.gradoCarga;
				const gruposSet = new Set(
					(filtroPeriodo.gruposLetras ?? []).map((x) => String(x).trim().toUpperCase()).filter(Boolean),
				);
				if (gruposSet.size > 0) {
					filas = filas.filter((row) => {
						const ng = Number.parseInt(row.grado, 10) || 0;
						return ng === gCarga && gruposSet.has(String(row.grupo).toUpperCase());
					});
				} else {
					const fc = filtroPeriodo.fechaCierre.slice(0, 10);
					filas = filas.filter((row) => {
						const fRow = row.fechaLimiteEntrega ? row.fechaLimiteEntrega.slice(0, 10) : "";
						const ng = Number.parseInt(row.grado, 10) || 0;
						return fRow === fc && ng === gCarga;
					});
				}
			}
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

	function abrirModalTokens(ctx: ContextoModalTokensCargas) {
		setFiltroTokensPeriodoModal(ctx);
		setModalTokensOpen(true);
		void cargarListaTokensModal(ctx);
	}

	function cerrarModalTokens() {
		setFiltroTokensPeriodoModal(null);
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
		setExpedienteDetalleVersion((v) => v + 1);
		setDocDatosOcr(null);
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
		setExpedienteDetalleVersion((v) => v + 1);
		setDocDatosOcr(null);
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
		setDocDatosOcr(null);
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
		actGrupoPendienteTrasCatalogoRef.current = null;
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
			const listaG = (dataG.grupos ?? [])
				.map(filaGrupoCatalogoDesdeApi)
				.filter((g): g is GrupoResumenCatalogo => g != null && idDestinoGrupoCatalogo(g) !== "");
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
			const [resC, resG, resCargas] = await Promise.all([
				fetch("/api/orientador/carreras", { credentials: "include" }),
				fetch("/api/orientador/grupos", { credentials: "include" }),
				fetch("/api/orientador/cargas", { credentials: "include" }),
			]);
			const dataC = (await resC.json()) as { carreras?: CarreraFiltro[]; error?: string };
			const dataG = (await resG.json()) as { grupos?: GrupoResumenCatalogo[]; error?: string };
			const dataCargas = (await resCargas.json()) as {
				historial?: CargaHistorialParaExpediente[];
				error?: string;
				tablasCargasPendientes?: boolean;
			};
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
			if (resCargas.ok && !dataCargas.tablasCargasPendientes) {
				setHistorialCargasCrear(dataCargas.historial ?? []);
			} else {
				setHistorialCargasCrear([]);
			}
			const listaG = (dataG.grupos ?? [])
				.map(filaGrupoCatalogoDesdeApi)
				.filter((g): g is GrupoResumenCatalogo => g != null && idDestinoGrupoCatalogo(g) !== "");
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
		setFormCrearCargaId("");
		setFormCrearLetraPlazo("");
		setHistorialCargasCrear([]);
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
		const gradoTrim = formCrearGrado.trim();
		const esG1 = gradoTrim === "1";

		let grupoTokenIdDestino = "";
		let gradoMostLoc = "";

		if (esG1) {
			if (!formCrearCargaId.trim()) {
				setErrorGuardarCrear("Elige el periodo (fecha de cierre de la carga).");
				irAExpediente();
				return;
			}
			const letraP = formCrearLetraPlazo.trim().toUpperCase();
			if (!letraP) {
				setErrorGuardarCrear("Elige la letra de grupo en la que va el alumno (según la carga).");
				irAExpediente();
				return;
			}
			const cat = catalogoGruposCrear.find(
				(g) =>
					String(g.grado).trim() === "1" &&
					String(g.grupo).trim().toUpperCase() === letraP,
			);
			const tok = cat ? idDestinoGrupoCatalogo(cat) : "";
			if (!tok) {
				setErrorGuardarCrear("No hay sección de catálogo para 1.° grupo " + letraP + ".");
				irAExpediente();
				return;
			}
			grupoTokenIdDestino = tok;
			gradoMostLoc = gradoMostradoParaAlumno("1", "1");
		} else {
			if (!formCrearGrupoDestino.trim()) {
				setErrorGuardarCrear("Selecciona un grupo de la lista.");
				irAExpediente();
				return;
			}
			const gSel = catalogoGruposCrear.find(
				(g) => idDestinoGrupoCatalogo(g) === formCrearGrupoDestino.trim(),
			);
			const gradoTokLoc = String(gSel?.grado ?? "1").trim();
			grupoTokenIdDestino = formCrearGrupoDestino.trim();
			gradoMostLoc = gradoMostradoParaAlumno(
				gradoTrim === "" ? null : gradoTrim,
				gradoTokLoc === "" ? "1" : gradoTokLoc,
			);
			if (!alumnoRequiereCarrera(gradoMostLoc)) {
				if (!formCrearCargaId.trim()) {
					setErrorGuardarCrear(
						"En 1.° grado elige el periodo de inscripción (fecha de cierre de la carga).",
					);
					irAExpediente();
					return;
				}
			}
		}

		setGuardandoCrear(true);
		setErrorGuardarCrear("");
		try {
			const cuerpo: Record<string, unknown> = {
				nombreCompleto: nombre,
				grupoTokenIdDestino,
			};
			if (gradoTrim !== "") {
				cuerpo.gradoAlumno = gradoTrim;
			}
			if (!alumnoRequiereCarrera(gradoMostLoc) && formCrearCargaId.trim() !== "") {
				cuerpo.cargaAlumnosId = formCrearCargaId.trim();
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
		actGrupoPendienteTrasCatalogoRef.current = null;
		datosPadronAlAbrirActualizarRef.current = {
			carreraId: a.carreraId,
			matricula: a.matricula ?? "",
		};
		const gNum = gradoEscolarNumerico(a.grado);
		const gradoStr =
			gNum >= 1 && gNum <= GRADO_ESCOLAR_MAX ? String(gNum) : "";
		setFormActGrado(gradoStr);
		const destRaw = a.grupoTokenId ?? a.institucionGrupoId ?? "";
		const cat = catalogoGruposActualizar;
		setFormActGrupoDestino(
			cat.length > 0
				? resolverGrupoDestinoParaGradoModal(cat, gradoStr, destRaw, a.grupo)
				: destRaw,
		);
		if (alumnoRequiereCarrera(gradoStr)) {
			setFormActMatricula(a.matricula ?? "");
			setFormActCarreraId(a.carreraId ?? "");
		} else {
			setFormActMatricula("");
			setFormActCarreraId("");
		}
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
		if (!formActGrado.trim()) {
			setErrorGuardarActualizar("Selecciona el grado escolar (1.° a 6.°).");
			irAExpediente();
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
			const requiereCarreraMat = alumnoRequiereCarrera(gradoTrim);
			if (requiereCarreraMat) {
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
			const requiereTrasGuardar = alumnoRequiereCarrera(formActGrado.trim());
			const carreraNombre = requiereTrasGuardar
				? catalogoCarrerasActualizar.find((c) => c.id === formActCarreraId)?.nombre ??
					alumnoModal.carreraNombre
				: "";
			const carreraCodigo = requiereTrasGuardar
				? catalogoCarrerasActualizar.find((c) => c.id === formActCarreraId)?.codigo ??
					alumnoModal.carreraCodigo
				: "";
			const gSel = catalogoGruposActualizar.find((g) => idDestinoGrupoCatalogo(g) === formActGrupoDestino);
			const estadoTrasGuardar: EstadoExpediente =
				data.estadoExpediente === "activo" || data.estadoExpediente === "inactivo"
					? data.estadoExpediente
					: formActEstado;
			const actualizado: AlumnoExpediente = {
				...alumnoModal,
				grado: formActGrado.trim(),
				grupo: gSel ? String(gSel.grupo).toUpperCase() : alumnoModal.grupo,
				matricula: requiereTrasGuardar ? formActMatricula.trim() : "",
				carreraId: requiereTrasGuardar && formActCarreraId.trim() ? formActCarreraId.trim() : null,
				carreraNombre: requiereTrasGuardar && formActCarreraId.trim() ? carreraNombre : "",
				carreraCodigo: requiereTrasGuardar && formActCarreraId.trim() ? carreraCodigo : "",
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
		setErrorSubirInsertar("");
		setInsertarModal({ docIdFijo: null });
	}

	function abrirInsertarParaDocumento(docId: string) {
		resetCamposInsertar();
		setErrorSubirInsertar("");
		setInsertarModal({ docIdFijo: docId });
	}

	function cerrarInsertarModal() {
		setInsertarModal(null);
		setModalCamaraAbierto(false);
		setErrorSubirInsertar("");
		setSubiendoInsertarArchivo(false);
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

	async function guardarOcrDesdeModal() {
		if (!docDatosOcr || !alumnoModal?.cuentaId) {
			return;
		}
		setGuardandoOcrModal(true);
		setErrorGuardarOcrModal("");
		try {
			const res = await fetch(
				`/api/orientador/expediente/${encodeURIComponent(alumnoModal.cuentaId)}/ocr-campos`,
				{
					method: "PATCH",
					headers: { "Content-Type": "application/json" },
					credentials: "include",
					body: JSON.stringify({ tipoDocumento: docDatosOcr.id, campos: ocrEdicionBorrador }),
				},
			);
			const data = (await res.json()) as { error?: string; ocrCampos?: Record<string, CampoOcrCelda> };
			if (!res.ok) {
				setErrorGuardarOcrModal(data.error ?? "No se pudieron guardar los datos");
				return;
			}
			const fusion = data.ocrCampos;
			if (!fusion) {
				setErrorGuardarOcrModal("Respuesta incompleta del servidor");
				return;
			}
			const idDoc = docDatosOcr.id;
			setDocsModal((prev) =>
				prev.map((d) => (d.id === idDoc ? { ...d, ocrCampos: fusion, ocrError: null } : d)),
			);
			setDocDatosOcr((d) => (d && d.id === idDoc ? { ...d, ocrCampos: fusion, ocrError: null } : d));
			setExpedienteDetalleVersion((v) => v + 1);
		} catch {
			setErrorGuardarOcrModal("Error de red");
		} finally {
			setGuardandoOcrModal(false);
		}
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

	async function confirmarInsertarArchivos() {
		if (!insertarModal || !archivoInsertar) {
			return;
		}
		if (!alumnoModal?.cuentaId) {
			setErrorSubirInsertar("Este expediente no tiene cuenta vinculada; no se puede subir el archivo.");
			return;
		}
		if (insertarModal.docIdFijo === null) {
			const nombre = nombreInsertarLibre.trim();
			if (!nombre) {
				return;
			}
		} else if (!esTipoDocumentoValido(insertarModal.docIdFijo)) {
			setErrorSubirInsertar("Tipo de documento no válido para subir.");
			return;
		}

		setErrorSubirInsertar("");
		setSubiendoInsertarArchivo(true);
		const cuentaId = alumnoModal.cuentaId;
		const file = archivoInsertar;
		const nombreUi = nombreArchivoUiTrasPosiblePdf(file);

		try {
			if (insertarModal.docIdFijo === null) {
				const nombre = nombreInsertarLibre.trim();
				const fd = new FormData();
				fd.set("cuentaId", cuentaId);
				fd.set("etiqueta", nombre);
				fd.set("archivo", file);
				const res = await fetch("/api/orientador/documento/adjunto", {
					method: "POST",
					body: fd,
					credentials: "include",
				});
				const data = (await res.json()) as {
					ok?: boolean;
					error?: string;
					tipoDocumento?: string;
					etiqueta?: string;
				};
				if (!res.ok) {
					setErrorSubirInsertar(data.error ?? "No se pudo subir el archivo");
					return;
				}
				const idAdjunto = data.tipoDocumento;
				if (!idAdjunto) {
					setErrorSubirInsertar("Respuesta incompleta del servidor");
					return;
				}
				const nombreMostrar = data.etiqueta?.trim() || nombre;
				setDocsModal((prev) => [
					...prev,
					{
						id: idAdjunto,
						nombre: nombreMostrar,
						esRequerido: false as const,
						archivoAdjunto: nombreUi,
						ocrCampos: null,
						ocrTramite: null,
						ocrExtraidoEn: null,
						ocrError: null,
					},
				]);
				setExpedienteDetalleVersion((v) => v + 1);
			} else {
				const tipoDoc = insertarModal.docIdFijo as TipoDocumentoClave;
				const fd = new FormData();
				fd.set("cuentaId", cuentaId);
				fd.set("tipoDocumento", tipoDoc);
				fd.set("archivo", file);
				const res = await fetch("/api/orientador/subir-documento", {
					method: "POST",
					body: fd,
					credentials: "include",
				});
				const data = (await res.json()) as {
					ok?: boolean;
					error?: string;
					ocr?: {
						exitoso?: boolean;
						campos?: Record<string, CampoOcrCelda> | null;
						tramite?: string | null;
						error?: string | null;
					};
				};
				if (!res.ok) {
					setErrorSubirInsertar(data.error ?? "No se pudo subir el archivo");
					return;
				}
				const ahoraIso = new Date().toISOString();
				const ocrOk = Boolean(data.ocr?.exitoso);
				setDocsModal((prev) =>
					prev.map((d) =>
						d.id === tipoDoc
							? {
									...d,
									archivoAdjunto: nombreUi,
									ocrCampos: data.ocr?.campos ?? null,
									ocrTramite: data.ocr?.tramite ?? null,
									ocrExtraidoEn: ocrOk ? ahoraIso : null,
									ocrError: data.ocr?.error ?? null,
								}
							: d,
					),
				);
				setExpedienteDetalleVersion((v) => v + 1);
			}
			cerrarInsertarModal();
		} catch {
			setErrorSubirInsertar("Error de red");
		} finally {
			setSubiendoInsertarArchivo(false);
		}
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
			<div className="mx-auto mt-3 flex w-full max-w-none justify-center">
				<div className="w-full rounded-xl border border-[#E2E8F0] bg-[#FFFFFF] p-2 shadow-sm">
					<div className="flex flex-wrap items-center justify-center gap-2">
						{seccionesMenuVisibles.map((item) => (
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
				<div className="mx-auto mt-5 w-full max-w-none rounded-2xl border border-[#E2E8F0] bg-white p-4 pb-28 shadow-sm sm:p-6 sm:pb-32">
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
												: "left-[calc(50%+0.125rem)] bg-[#2563EB]"
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
											estadoExpediente === "inactivo" ? "text-white" : "text-[#1E40AF]"
										}`}
									>
										Inactivo
									</button>
								</div>
								<button
									type="button"
									onClick={() => setModalAccionesGruposExpediente(true)}
									className="rounded-xl border-2 border-[#E9D5FF] bg-[#F5F3FF] px-4 py-2.5 text-sm font-semibold text-[#5B21B6] shadow-sm transition hover:border-[#DDD6FE] hover:bg-[#EDE9FE]"
								>
									Acciones por grupo
								</button>
							</div>
						</div>

						<div className="rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-4 sm:p-5">
							<div className="mb-3">
								<h3 className="text-sm font-bold text-[#1E293B]">Filtrar expedientes</h3>
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
									<span className="text-xs font-semibold text-[#475569]">Grupo (una letra)</span>
									<input
										type="text"
										inputMode="text"
										autoComplete="off"
										maxLength={1}
										value={filtroGrupo}
										onChange={(e) =>
											setFiltroGrupo(
												e.target.value
													.replace(/[^A-Za-z]/g, "")
													.toUpperCase()
													.slice(0, 1),
											)
										}
										placeholder="Ej. A"
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
														Consultar
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
			) : seccionActiva === "plantillas" ? (
				<PlantillasSeccionOrientador />
			) : seccionActiva === "cargas" ? (
				<CargasPeriodosOrientador modo="cargas" onAbrirModalTokens={abrirModalTokens} />
			) : seccionActiva === "escolar" ? (
				<EscolarSeccionOrientador />
			) : seccionActiva === "historial" && rolPanel === "jefe" ? (
				<HistorialAccionesOrientador />
			) : (
				<div className="mx-auto mt-5 w-full max-w-none rounded-2xl border border-[#E2E8F0] bg-white p-6 text-center shadow-sm">
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
										{filtroTokensPeriodoModal ? (
											<p className="mt-1 text-xs font-semibold text-[#5B21B6]">
												Carga en pantalla: cierre {filtroTokensPeriodoModal.fechaCierre} ·{" "}
												{filtroTokensPeriodoModal.gradoCarga}° · grupos{" "}
												{(filtroTokensPeriodoModal.gruposLetras ?? []).join(", ") || "—"}.
											</p>
										) : (
											<p className="mt-1 text-xs text-[#64748B]">
												Sin carga en contexto: se listan todos los tokens. Usa el filtro de fecha en Carga de
												alumnos y vuelve a abrir para ver solo un periodo.
											</p>
										)}
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
											{filtroTokensPeriodoModal
												? "No hay tokens con esa fecha de cierre y grado para el periodo elegido. Revisa la carga o las fechas en los grupos."
												: "No hay tokens registrados. Crea grupos o una carga de alumnos para generarlos."}
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
						aria-label={modalExpedienteModo === "ver_mas" ? "Consultar expediente" : "Detalle de expediente"}
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

						<div className="mt-5 max-h-[min(62vh,560px)] overflow-y-auto rounded-xl border border-[#D1D5DB] bg-[#F3F4F6] p-3">
							<div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
								{docsModal.map((doc) => (
									<div key={doc.id} className="min-w-0 rounded-lg border border-[#D1D5DB] bg-white p-3 shadow-sm">
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
										<div className="mt-2 grid grid-cols-3 gap-2">
											<button
												type="button"
												onClick={() => setDocPreview(doc)}
												className="inline-flex items-center justify-center rounded-md border border-violet-400 bg-violet-100 px-2 py-1.5 text-violet-900 transition hover:bg-violet-200"
												aria-label={`Vista previa ${doc.nombre}`}
												title="Vista previa"
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
												className="inline-flex items-center justify-center rounded-md border border-blue-400 bg-blue-100 px-2 py-1.5 text-blue-900 transition hover:bg-blue-200"
												aria-label={`Descargar ${doc.nombre}`}
												title="Descargar"
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
											<button
												type="button"
												onClick={() => setDocDatosOcr(doc)}
												className="inline-flex items-center justify-center rounded-md border border-violet-400 bg-violet-100 px-2 py-1.5 text-violet-900 transition hover:bg-violet-200"
												aria-label={`Datos OCR ${doc.nombre}`}
												title="Datos leídos por OCR"
											>
												<svg
													aria-hidden
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													className="h-5 w-5 shrink-0"
												>
													<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
													<path d="M14 2v6h6M16 13H8M16 17H8M10 9H8" />
												</svg>
											</button>
										</div>
										{modalExpedienteModo === "edicion" ? (
											<button
												type="button"
												onClick={() => {
													if (!doc.esRequerido) {
														eliminarDocumentoDeModal(doc.id);
													}
												}}
												disabled={doc.esRequerido}
												className={`mt-2 inline-flex w-full items-center justify-center rounded-md border px-2 py-1 text-sm font-medium ${
													doc.esRequerido
														? "cursor-not-allowed border-[#E5E7EB] bg-[#F9FAFB] text-[#9CA3AF]"
														: "border-[#9CA3AF] bg-[#9CA3AF] text-[#111827] hover:bg-[#6B7280] hover:text-white"
												}`}
											>
												<svg
													aria-hidden
													xmlns="http://www.w3.org/2000/svg"
													viewBox="0 0 24 24"
													fill="none"
													stroke="currentColor"
													strokeWidth="2"
													className={`h-5 w-5 ${doc.esRequerido ? "text-[#CBD5E1]" : ""}`}
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
									className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#3B82F6] bg-[#DBEAFE] px-4 py-3 text-[2rem] font-medium text-[#1D4ED8] transition hover:border-[#2563EB] hover:bg-[#BFDBFE] disabled:opacity-50"
									aria-label={zipDescargando ? "Generando archivo" : "Descargar todo el expediente"}
								>
									<svg
										aria-hidden
										xmlns="http://www.w3.org/2000/svg"
										viewBox="0 0 24 24"
										fill="none"
										stroke="currentColor"
										strokeWidth="2"
										className="h-9 w-9 shrink-0 sm:h-10 sm:w-10"
									>
										<path d="M12 3v13M7 12l5 5 5-5M4 21h16" />
									</svg>
									{zipDescargando ? "Generando…" : "Descargar todo"}
								</button>
								<button
									type="button"
									onClick={abrirInsertarLibre}
									className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#3B82F6] bg-[#DBEAFE] px-4 py-3 text-[2rem] font-medium text-[#1D4ED8] transition hover:border-[#2563EB] hover:bg-[#BFDBFE]"
								>
									Agregar archivo +
								</button>
								<button
									type="button"
									onClick={(e) => {
										e.stopPropagation();
										abrirModalActualizarDatos();
									}}
									className="inline-flex items-center justify-center gap-2 rounded-2xl border border-[#3B82F6] bg-[#DBEAFE] px-4 py-3 text-[2rem] font-medium text-[#1D4ED8] transition hover:border-[#2563EB] hover:bg-[#BFDBFE]"
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
								<div className="relative mb-6 flex items-center justify-center pb-2">
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
									<h2 className="px-12 text-center text-2xl font-bold tracking-tight text-[#111827] sm:text-[1.85rem]">
										Actualizar datos del alumno
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

									<div className="space-y-6">
										<div className="text-center">
											<p className="text-[1.5rem] font-extrabold tracking-tight text-[#111827] sm:text-[1.85rem]">
												{alumnoModal.nombreCompleto}
											</p>
											<p className="mt-1 text-sm font-medium text-[#6B7280]">
												Elige grado (1.° a 6.°) y grupo. Desde 2.° podrás indicar matrícula y carrera.
											</p>
										</div>

										<div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
											<div>
												<label htmlFor="act-grado" className="mb-1.5 block text-sm font-semibold text-[#111827] sm:text-base">
													Grado
												</label>
												<select
													id="act-grado"
													value={formActGrado}
													onChange={(e) => {
														const next = e.target.value;
														if (next === formActGrado) {
															return;
														}
														const destinoAntes = formActGrupoDestino;
														const selActual = destinoAntes.trim();
														let letraPreferida = "";
														if (selActual && catalogoGruposActualizar.length > 0) {
															const prevRow = catalogoGruposActualizar.find(
																(x) => idDestinoGrupoCatalogo(x) === selActual,
															);
															if (prevRow) {
																letraPreferida = letraGrupoCatalogoNormalizada(prevRow.grupo);
															}
														}
														if (!letraPreferida && alumnoModal) {
															letraPreferida = letraGrupoCatalogoNormalizada(alumnoModal.grupo);
														}
														setFormActGrado(next);
														const cat = catalogoGruposActualizar;
														if (!next.trim()) {
															setFormActGrupoDestino("");
															actGrupoPendienteTrasCatalogoRef.current = null;
														} else if (cat.length > 0) {
															const nuevoGrupo = resolverGrupoDestinoParaGradoModal(
																cat,
																next,
																destinoAntes,
																letraPreferida,
															);
															setFormActGrupoDestino(nuevoGrupo);
															actGrupoPendienteTrasCatalogoRef.current = null;
														} else if (letraPreferida) {
															actGrupoPendienteTrasCatalogoRef.current = {
																grado: next.trim(),
																letra: letraPreferida,
															};
															setFormActGrupoDestino("");
														} else {
															actGrupoPendienteTrasCatalogoRef.current = null;
															setFormActGrupoDestino("");
														}
														if (!alumnoRequiereCarrera(next)) {
															setFormActMatricula("");
															setFormActCarreraId("");
														}
													}}
													className="w-full rounded-2xl border border-[#CBD5E1] bg-white px-4 py-3 text-lg font-semibold text-[#111827] shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#DBEAFE]"
												>
													<option value="">— Elige grado —</option>
													{Array.from({ length: GRADO_ESCOLAR_MAX }, (_, i) => i + 1).map((n) => (
														<option key={n} value={String(n)}>
															{n}.°
														</option>
													))}
												</select>
											</div>
											<div>
												<label htmlFor="act-grupo" className="mb-1.5 block text-sm font-semibold text-[#111827] sm:text-base">
													Grupo
												</label>
												<select
													key={formActGrado || "sin-grado"}
													id="act-grupo"
													value={formActGrupoDestino}
													onChange={(e) => setFormActGrupoDestino(e.target.value)}
													disabled={
														catalogosActualizarCargando ||
														formActGrado.trim() === "" ||
														gruposParaSelectActualizar.length === 0
													}
													className="w-full rounded-2xl border border-[#CBD5E1] bg-white px-4 py-3 text-base font-medium text-[#111827] shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#DBEAFE] disabled:opacity-60"
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
												{mensajeGrupoActualizarSinOpciones.trim() !== "" ? (
													<p className="mt-1.5 text-xs font-medium text-amber-800">
														{mensajeGrupoActualizarSinOpciones}
													</p>
												) : null}
											</div>
										</div>

										{alumnoRequiereCarrera(formActGrado.trim()) ? (
											<div className="grid gap-4 sm:grid-cols-2 sm:gap-5">
												<div>
													<label
														htmlFor="act-matricula"
														className="mb-1.5 block text-sm font-semibold text-[#111827] sm:text-base"
													>
														Matrícula
													</label>
													<input
														id="act-matricula"
														type="text"
														value={formActMatricula}
														onChange={(e) => setFormActMatricula(e.target.value)}
														className="w-full rounded-2xl border border-[#CBD5E1] bg-white px-4 py-3 text-base text-[#111827] shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#DBEAFE]"
													/>
												</div>
												<div>
													<label
														htmlFor="act-carrera"
														className="mb-1.5 block text-sm font-semibold text-[#111827] sm:text-base"
													>
														Carrera
													</label>
													<select
														id="act-carrera"
														value={formActCarreraId}
														onChange={(e) => setFormActCarreraId(e.target.value)}
														disabled={catalogosActualizarCargando}
														className="w-full rounded-2xl border border-[#CBD5E1] bg-white px-4 py-3 text-base text-[#111827] shadow-[inset_0_1px_2px_rgba(15,23,42,0.08)] outline-none focus:border-[#3B82F6] focus:ring-2 focus:ring-[#DBEAFE] disabled:opacity-60"
													>
														<option value="">— Sin carrera —</option>
														{catalogoCarrerasActualizar.map((c) => (
															<option key={c.id} value={c.id}>
																{c.nombre}
															</option>
														))}
													</select>
												</div>
											</div>
										) : null}

										<div className="pt-2">
											<div className="mb-1.5 text-sm font-semibold text-[#111827] sm:text-base">Estado del expediente</div>
											<div
												className="inline-flex max-w-md rounded-2xl border border-[#BFDBFE] bg-[#EFF6FF] p-1 shadow-[inset_0_1px_2px_rgba(15,23,42,0.05)]"
												role="group"
												aria-label="Estado del expediente"
											>
												<button
													type="button"
													onClick={() => setFormActEstado("activo")}
													className={`min-w-[6.5rem] flex-1 rounded-xl px-4 py-2.5 text-center text-sm font-bold transition sm:min-w-[7.5rem] sm:py-3 sm:text-base ${
														formActEstado === "activo"
															? "bg-[#7C3AED] text-white shadow-sm"
															: "bg-transparent text-[#5B21B6] hover:bg-[#EDE9FE]"
													}`}
												>
													Activo
												</button>
												<button
													type="button"
													onClick={() => setFormActEstado("inactivo")}
													className={`min-w-[6.5rem] flex-1 rounded-xl px-4 py-2.5 text-center text-sm font-bold transition sm:min-w-[7.5rem] sm:py-3 sm:text-base ${
														formActEstado === "inactivo"
															? "bg-[#2563EB] text-white shadow-sm"
															: "bg-transparent text-[#1E40AF] hover:bg-[#DBEAFE]"
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
										className="mx-auto mt-10 flex w-full max-w-xl justify-center rounded-2xl border border-[#3B82F6] bg-[#DBEAFE] py-3.5 text-center text-lg font-bold text-[#1D4ED8] transition hover:bg-[#BFDBFE] hover:border-[#2563EB] disabled:opacity-50 sm:py-4 sm:text-[1.1rem]"
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
						className="w-full max-w-3xl min-w-0 overflow-hidden rounded-2xl border border-[#D1D5DB] bg-white p-5 shadow-2xl sm:p-8"
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

						<p className="mt-4 text-center text-xs text-[#6B7280]">
							Las imágenes JPG o PNG se convierten automáticamente a PDF al guardar.
						</p>
						{errorSubirInsertar ? (
							<p className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-center text-sm text-red-800">
								{errorSubirInsertar}
							</p>
						) : null}
						<div className="mt-6 grid min-w-0 gap-6 md:grid-cols-[minmax(0,1fr)_min(18rem,100%)] md:items-start">
							<div className="min-w-0 space-y-4">
								<button
									type="button"
									disabled={subiendoInsertarArchivo}
									onClick={(e) => {
										e.stopPropagation();
										e.preventDefault();
										abrirSelectorArchivoInsertar();
									}}
									className="flex min-h-[11rem] w-full min-w-0 max-w-full flex-col items-center justify-center rounded-xl border-2 border-dashed border-[#D1D5DB] bg-[#FAFAFA] p-4 text-center shadow-sm transition hover:border-[#A78BFA] hover:bg-[#F5F3FF] enabled:cursor-pointer disabled:cursor-not-allowed disabled:opacity-60 sm:p-6"
								>
									<p className="max-w-full break-words px-1 text-sm font-medium text-[#6B7280] [overflow-wrap:anywhere]">
										{archivoInsertar ? archivoInsertar.name : "Ningún archivo seleccionado…"}
									</p>
									<p className="mt-2 text-base font-semibold text-[#5B21B6]">Agregar archivo</p>
								</button>

								{insertarModal.docIdFijo !== null ? (
									<div className="min-w-0 rounded-xl border border-[#E5E7EB] bg-[#F9FAFB] px-4 py-3">
										<p className="text-xs font-medium uppercase tracking-wide text-[#6B7280]">Documento</p>
										<p className="mt-1 break-words text-lg font-semibold text-[#111827] [overflow-wrap:anywhere]">
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
											disabled={subiendoInsertarArchivo}
											placeholder="Ej. comprobante de pago"
											className="w-full rounded-xl border border-[#D1D5DB] bg-white px-4 py-3 text-base text-[#111827] outline-none focus:border-[#A78BFA] focus:ring-2 focus:ring-[#EDE9FE] disabled:opacity-60"
										/>
									</div>
								)}
							</div>

							<div className="flex min-w-0 w-full max-w-full flex-col gap-4 md:max-w-[18rem] md:shrink-0">
								<p className="max-w-full break-words text-xs font-medium text-[#4B5563] [overflow-wrap:anywhere]">
									{archivoInsertar
										? `Nombre del archivo: ${archivoInsertar.name}`
										: "Nombre del archivo: Ningún archivo seleccionado"}
								</p>
								<div className="flex min-w-0 w-full flex-col gap-3">
									<button
										type="button"
										disabled={subiendoInsertarArchivo}
										onClick={(e) => {
											e.stopPropagation();
											abrirModalCamara();
										}}
										className="inline-flex min-h-[4rem] w-full min-w-0 max-w-full flex-1 items-center justify-center gap-2 rounded-2xl border border-[#9CA3AF] bg-[#E5E7EB] px-3 py-3 text-sm font-semibold text-[#111827] transition hover:bg-[#D1D5DB] disabled:cursor-not-allowed disabled:opacity-50 sm:px-4"
									>
										<svg
											aria-hidden
											xmlns="http://www.w3.org/2000/svg"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											className="h-7 w-7"
										>
											<path d="M23 19a2 2 0 0 1-2 2H3a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4l2-3h6l2 3h4a2 2 0 0 1 2 2z" />
											<circle cx="12" cy="13" r="4" />
										</svg>
										<span className="min-w-0 text-center leading-tight">Tomar foto</span>
									</button>
									<button
										type="button"
										onClick={() => void confirmarInsertarArchivos()}
										disabled={
											subiendoInsertarArchivo ||
											!archivoInsertar ||
											(insertarModal.docIdFijo === null && nombreInsertarLibre.trim() === "")
										}
										className="inline-flex min-h-[4.5rem] w-full min-w-0 max-w-full flex-[1.4] items-center justify-center gap-2 rounded-2xl border border-[#7C3AED] bg-[#7C3AED] px-3 py-3 text-base font-semibold text-white transition hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-45 sm:gap-3 sm:px-5"
									>
										<span className="min-w-0 flex-1 text-center leading-tight [overflow-wrap:anywhere]">
											{subiendoInsertarArchivo ? "Subiendo…" : "Agregar archivos seleccionados"}
										</span>
										<svg
											aria-hidden
											xmlns="http://www.w3.org/2000/svg"
											viewBox="0 0 24 24"
											fill="none"
											stroke="currentColor"
											strokeWidth="2"
											className="h-8 w-8"
										>
											<path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4M17 8l-5-5-5 5M12 3v12" />
										</svg>
									</button>
								</div>
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
			{docDatosOcr
				? createPortal(
						(() => {
							const ocrModalMuestraVista =
								ocrModalVistaEstado === "cargando" || ocrModalVistaEstado === "ok";
							return (
						<div
							className="fixed inset-0 z-[245] flex items-center justify-center bg-slate-900/55 p-3 sm:p-4"
							onClick={() => setDocDatosOcr(null)}
							role="presentation"
						>
							<div
								className={`flex max-h-[min(92vh,800px)] w-full flex-col overflow-hidden rounded-2xl border border-[#D1D5DB] bg-white shadow-2xl ${
									ocrModalMuestraVista ? "max-w-6xl" : "max-w-xl"
								}`}
								onClick={(e) => e.stopPropagation()}
								role="dialog"
								aria-modal="true"
								aria-label={`Datos OCR: ${docDatosOcr.nombre}`}
							>
								<div className="flex shrink-0 items-center justify-between border-b border-[#E5E7EB] px-4 py-3 sm:px-5">
									<h4 className="min-w-0 pr-2 text-base font-bold text-[#111827] sm:text-lg">
										Datos — {docDatosOcr.nombre}
									</h4>
									<button
										type="button"
										onClick={() => setDocDatosOcr(null)}
										className="inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[#111827] hover:bg-black/5"
										aria-label="Cerrar"
									>
										✕
									</button>
								</div>
								<div className="flex min-h-0 flex-1 flex-col overflow-hidden lg:flex-row">
									<div className="min-h-0 min-w-0 flex-1 overflow-y-auto border-[#E5E7EB] px-4 py-4 sm:px-5 lg:border-r">
										{docDatosOcr.ocrTramite ? (
											<p className="mb-1 text-xs font-medium text-[#64748B]">
												Trámite OCR: <span className="text-[#334155]">{docDatosOcr.ocrTramite}</span>
											</p>
										) : null}
										{docDatosOcr.ocrExtraidoEn ? (
											<p className="mb-2 text-xs text-[#64748B]">
												Leído el {fechaOcrUiCorta(docDatosOcr.ocrExtraidoEn)}
											</p>
										) : null}
										{docDatosOcr.ocrError ? (
											<p className="mb-3 rounded-lg bg-amber-50 px-3 py-2 text-sm text-amber-900">
												{mensajeOcrUiCorto(docDatosOcr.ocrError)}
											</p>
										) : null}
										<p className="mb-3 text-sm leading-snug text-[#64748B]">
											Captura o corrige los datos del documento. Si aún no hay extracción automática, puedes
											rellenarlos a mano y guardar.
										</p>
										<ul className="space-y-4 border-t border-[#E5E7EB] pt-3">
											{filasOcrEdicionModal(docDatosOcr).map((fila) => {
												const valor = ocrEdicionBorrador[fila.clave] ?? "";
												const lineas = valor ? valor.split("\n").length : 1;
												const rowsTa = fila.multiline
													? Math.min(10, Math.max(3, lineas + 1))
													: Math.min(6, Math.max(2, lineas + 1));
												const confRaw = docDatosOcr.ocrCampos?.[fila.clave]?.confidence;
												const confTxt =
													confRaw != null && Number.isFinite(confRaw)
														? textoConfianzaOcr(confRaw)
														: null;
												return (
													<li key={fila.clave} className="border-b border-[#F1F5F9] pb-4 last:border-0">
														<label
															className="mb-1.5 block text-xs font-semibold uppercase tracking-wide text-[#64748B]"
															htmlFor={`ocr-campo-exp-${docDatosOcr.id}-${fila.clave}`}
														>
															{fila.etiqueta}
														</label>
														<textarea
															id={`ocr-campo-exp-${docDatosOcr.id}-${fila.clave}`}
															rows={rowsTa}
															value={valor}
															onChange={(e) =>
																setOcrEdicionBorrador((prev) => ({
																	...prev,
																	[fila.clave]: e.target.value,
																}))
															}
															placeholder="Opcional"
															className="w-full resize-y rounded-xl border border-[#CBD5E1] bg-white px-3 py-2 text-sm text-[#111827] shadow-[inset_0_1px_2px_rgba(15,23,42,0.06)] outline-none focus:border-[#6366F1] focus:ring-1 focus:ring-[#A5B4FC]"
														/>
														{confTxt ? (
															<div className="mt-1 text-[11px] text-[#94A3B8]">Confianza OCR: {confTxt}</div>
														) : null}
													</li>
												);
											})}
										</ul>
									</div>
									{ocrModalMuestraVista ? (
										<div className="flex min-h-[min(40vh,360px)] w-full shrink-0 flex-col border-t border-[#E5E7EB] bg-[#F1F5F9] lg:min-h-0 lg:w-[min(42%,440px)] lg:border-l lg:border-t-0">
											<p className="shrink-0 border-b border-[#E5E7EB] bg-white px-3 py-2 text-xs font-semibold uppercase tracking-wide text-[#64748B]">
												Vista del documento
											</p>
											<div className="min-h-0 flex-1 overflow-auto p-2 sm:p-3">
												{ocrModalVistaEstado === "cargando" ? (
													<div className="flex h-[min(36vh,320px)] w-full flex-col items-center justify-center gap-2 text-[#64748B] lg:h-full lg:min-h-[280px]">
														<span className="inline-block h-9 w-9 animate-spin rounded-full border-2 border-[#7C3AED] border-t-transparent" />
														<p className="text-sm font-medium">Cargando vista previa…</p>
													</div>
												) : ocrModalVistaUrl && ocrModalVistaMime ? (
													<div className="mx-auto h-[min(38vh,340px)] w-full overflow-hidden rounded-lg border border-[#E5E7EB] bg-white shadow-inner lg:h-[min(calc(92vh-12rem),560px)] lg:max-h-full">
														{ocrModalVistaMime.startsWith("image/") ? (
															/* eslint-disable-next-line @next/next/no-img-element -- blob del expediente */
															<img
																src={ocrModalVistaUrl}
																alt={`Documento ${docDatosOcr.nombre}`}
																className="mx-auto max-h-full w-auto max-w-full object-contain"
															/>
														) : (
															<iframe
																title={`Vista ${docDatosOcr.nombre}`}
																src={ocrModalVistaUrl}
																className="h-full min-h-[min(36vh,300px)] w-full border-0 bg-white lg:min-h-[260px]"
															/>
														)}
													</div>
												) : null}
											</div>
										</div>
									) : null}
								</div>
								<div className="shrink-0 space-y-2 border-t border-[#E5E7EB] bg-[#F8FAFC] px-4 py-3 sm:px-5">
									{errorGuardarOcrModal ? (
										<p className="text-sm text-red-700">{errorGuardarOcrModal}</p>
									) : null}
									{!alumnoModal?.cuentaId ? (
										<p className="text-sm text-amber-800">
											Esta ficha no tiene cuenta vinculada; no se pueden guardar datos en el servidor.
										</p>
									) : null}
									<div className="flex flex-wrap items-center justify-end gap-2">
										<button
											type="button"
											onClick={() => setDocDatosOcr(null)}
											className="rounded-xl border border-[#CBD5E1] bg-white px-4 py-2.5 text-sm font-semibold text-[#334155] transition hover:bg-[#F1F5F9]"
										>
											Cerrar
										</button>
										<button
											type="button"
											onClick={() => void guardarOcrDesdeModal()}
											disabled={guardandoOcrModal || !alumnoModal?.cuentaId}
											className="rounded-xl border border-[#7C3AED] bg-[#7C3AED] px-4 py-2.5 text-sm font-semibold text-white transition hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-45"
										>
											{guardandoOcrModal ? "Guardando…" : "Guardar datos"}
										</button>
									</div>
								</div>
							</div>
						</div>
							);
						})(),
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
														setFormCrearCargaId("");
														setFormCrearLetraPlazo("");
													}
													setFormCrearGrado(next);
												}}
												className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.07)] outline-none focus:border-[#9CA3AF] sm:py-3"
											/>
										</div>

										{esCrearExpedienteGradoUno ? (
											<>
												<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
													<label
														htmlFor="crear-periodo-carga"
														className="text-right text-sm font-bold text-[#111827] sm:text-base"
													>
														Periodo:
													</label>
													<div className="min-w-0">
														<select
															id="crear-periodo-carga"
															value={formCrearCargaId}
															onChange={(e) => {
																setFormCrearCargaId(e.target.value);
																setFormCrearLetraPlazo("");
															}}
															disabled={catalogosCrearCargando || cargasPeriodoPrimerGrado.length === 0}
															className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.07)] outline-none focus:border-[#9CA3AF] disabled:opacity-60 sm:py-3"
														>
															<option value="">
																{cargasPeriodoPrimerGrado.length === 0
																	? "— Crea primero una carga (1.°) en la sección Cargas —"
																	: "— Fecha de cierre del plazo —"}
															</option>
															{cargasPeriodoPrimerGrado.map((c) => (
																<option key={c.id} value={c.id}>
																	Cierre {String(c.fechaCierre).slice(0, 10)} · grupos{" "}
																	{c.gruposLetras.join(", ")}
																</option>
															))}
														</select>
														<p className="mt-1.5 text-xs text-[#6B7280]">
															El alumno quedará inscrito solo en este periodo (no se repetirá en otras fechas de
															cierre).
														</p>
													</div>
												</div>
												<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
													<label
														htmlFor="crear-grupo-letra-plazo"
														className="text-right text-sm font-bold text-[#111827] sm:text-base"
													>
														Grupo:
													</label>
													<div className="min-w-0">
														<select
															id="crear-grupo-letra-plazo"
															value={formCrearLetraPlazo}
															onChange={(e) => setFormCrearLetraPlazo(e.target.value)}
															disabled={
																catalogosCrearCargando ||
																!formCrearCargaId.trim() ||
																letrasGrupoDesdeCargaElegida.length === 0
															}
															className="w-full rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-[#111827] shadow-[inset_0_1px_3px_rgba(0,0,0,0.07)] outline-none focus:border-[#9CA3AF] disabled:opacity-60 sm:py-3"
														>
															<option value="">
																{!formCrearCargaId.trim()
																	? "— Elige primero el periodo —"
																	: "— Letra de grupo en esa carga —"}
															</option>
															{letrasGrupoDesdeCargaElegida.map((L) => (
																<option key={L} value={L}>
																	Grupo {L}
																</option>
															))}
														</select>
														<p className="mt-1.5 text-xs text-[#6B7280]">
															Solo las letras incluidas en la carga de ese periodo.
														</p>
													</div>
												</div>
											</>
										) : (
											<div className="grid grid-cols-[minmax(7.5rem,9.5rem)_1fr] items-center gap-4 py-3.5 sm:grid-cols-[10.5rem_1fr] sm:gap-6">
												<label htmlFor="crear-grupo" className="text-right text-sm font-bold text-[#111827] sm:text-base">
													Grupo:
												</label>
												<div className="min-w-0">
													<select
														id="crear-grupo"
														value={formCrearGrupoDestino}
														onChange={(e) => {
															setFormCrearGrupoDestino(e.target.value);
															setFormCrearCargaId("");
														}}
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
										)}

										{esCrearExpedienteGradoUno ? null : (
											<>
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
											</>
										)}
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
			<ModalAccionesMasivasGruposExpediente
				abierto={modalAccionesGruposExpediente}
				alcanceSugerido={estadoExpediente}
				alCerrar={() => setModalAccionesGruposExpediente(false)}
				alExito={() => {
					void cargarExpediente({ silencioso: true });
				}}
			/>
			{seccionActiva === "expediente" ? (
				<div
					className="pointer-events-none fixed inset-x-0 bottom-0 z-[30] flex justify-end px-3 pb-[max(0.75rem,env(safe-area-inset-bottom,0px))] pt-2 sm:px-4 lg:px-6"
					role="presentation"
				>
					<button
						type="button"
						aria-label="Crear nuevo expediente"
						onClick={abrirModalCrearExpediente}
						className="pointer-events-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-full border-2 border-[#7C3AED] bg-[#EDE9FE] text-[#5B21B6] shadow-[0_4px_14px_rgba(124,58,237,0.25)] transition hover:bg-[#DDD6FE] hover:shadow-md sm:h-[4.5rem] sm:w-[4.5rem]"
					>
						<svg
							aria-hidden
							viewBox="0 0 24 24"
							fill="none"
							stroke="currentColor"
							strokeWidth="3"
							strokeLinecap="round"
							className="h-7 w-7 shrink-0 sm:h-9 sm:w-9"
						>
							<path d="M12 5v14M5 12h14" />
						</svg>
					</button>
				</div>
			) : null}
		</div>
	);
}
