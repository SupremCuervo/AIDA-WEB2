/**
 * Nombres en Storage (y coherencia con descargas):
 *
 * - Documentos del trámite (5 tipos): `{slug_alumno}_{tipo}.{ext}`
 *   Ej. `juan_perez_lopez_acta_nacimiento.pdf` — `tipo` es la clave fija (acta_nacimiento, curp, …).
 *
 * - Adjuntos extra (orientador, citatorios, etc.): `{slug_alumno}_{slug_etiqueta}_{id8}.{ext}`
 *   Ej. `juan_perez_lopez_citatorio_junta_a1b2c3d4.pdf` — `slug_etiqueta` sale del nombre que escribe el orientador;
 *   `id8` son 8 caracteres del UUID interno para no pisar dos archivos con la misma etiqueta.
 *
 * Alumno y orientador suben los 5 estándar con la misma función `nombreArchivoEstandar`.
 */

export const TIPOS_DOCUMENTO = {
	acta_nacimiento: "acta_nacimiento",
	curp: "curp",
	ine_tutor: "ine_tutor",
	comprobante_domicilio: "comprobante_domicilio",
	certificado_medico: "certificado_medico",
} as const;

export type TipoDocumentoClave = keyof typeof TIPOS_DOCUMENTO;

const EXTENSIONES_PERMITIDAS = new Set(["pdf", "png", "jpg", "jpeg", "webp"]);

/** Nombre sugerido al descargar: {slug_alumno}_{etiqueta}.{ext} */
const ETIQUETAS_DESCARGA: Record<TipoDocumentoClave, string> = {
	acta_nacimiento: "Acta_de_nacimiento",
	curp: "CURP",
	ine_tutor: "INE_del_tutor",
	comprobante_domicilio: "Comprobante_de_domicilio",
	certificado_medico: "Certificado_medico",
};

export function nombreArchivoDescargaAlumno(
	nombreAlumno: string,
	tipo: TipoDocumentoClave,
	extension: string,
): string {
	const sa = slugificar(nombreAlumno);
	const etiq = ETIQUETAS_DESCARGA[tipo];
	const ext = extension.replace(/^\./, "").toLowerCase();
	if (!EXTENSIONES_PERMITIDAS.has(ext)) {
		throw new Error(`Extensión no permitida: ${extension}`);
	}
	return `${sa}_${etiq}.${ext}`;
}

function quitarAcentos(texto: string): string {
	return texto.normalize("NFD").replace(/\p{M}/gu, "");
}

export function slugificar(texto: string): string {
	const sinAcentos = quitarAcentos(texto.trim().toLowerCase());
	const soloSeguro = sinAcentos.replace(/[^a-z0-9]+/g, "_");
	return soloSeguro.replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "sin_nombre";
}

export function esTipoDocumentoValido(valor: string): valor is TipoDocumentoClave {
	return Object.prototype.hasOwnProperty.call(TIPOS_DOCUMENTO, valor);
}

/** Adjuntos subidos solo por el orientador (eliminables); no son los 5 del trámite. */
export const PREFIJO_TIPO_ADJUNTO_ORIENTADOR = "orientador_adjunto_";

export function esTipoAdjuntoOrientador(valor: string): boolean {
	return (
		typeof valor === "string" &&
		valor.startsWith(PREFIJO_TIPO_ADJUNTO_ORIENTADOR) &&
		valor.length > PREFIJO_TIPO_ADJUNTO_ORIENTADOR.length + 8
	);
}

export function crearTipoAdjuntoOrientador(): string {
	const id =
		typeof crypto !== "undefined" && crypto.randomUUID
			? crypto.randomUUID()
			: `${Date.now()}_${Math.random().toString(16).slice(2)}`;
	return `${PREFIJO_TIPO_ADJUNTO_ORIENTADOR}${id}`;
}

/**
 * Ruta en bucket para adjunto del orientador: mismo criterio «alumno + tipo», donde el tipo es la etiqueta
 * legible (slugificada) más un prefijo corto del UUID de la fila para unicidad.
 */
export function nombreRutaStorageAdjuntoOrientador(
	slugAlumno: string,
	etiquetaLegible: string,
	tipoDocumentoCompleto: string,
	extension: string,
): string {
	const ext = extension.replace(/^\./, "").toLowerCase();
	if (!EXTENSIONES_PERMITIDAS.has(ext)) {
		throw new Error(`Extensión no permitida: ${extension}`);
	}
	const sinPrefijo = tipoDocumentoCompleto.startsWith(PREFIJO_TIPO_ADJUNTO_ORIENTADOR)
		? tipoDocumentoCompleto.slice(PREFIJO_TIPO_ADJUNTO_ORIENTADOR.length)
		: tipoDocumentoCompleto;
	const idLimpio = sinPrefijo.replace(/-/g, "");
	const id8 = (idLimpio.slice(0, 8) || "00000000").toLowerCase();
	let slugEt = slugificar(etiquetaLegible);
	if (!slugEt || slugEt === "sin_nombre") {
		slugEt = "documento_adicional";
	}
	slugEt = slugEt.slice(0, 50);
	return `${slugAlumno}_${slugEt}_${id8}.${ext}`;
}

export function nombreArchivoEstandar(
	nombreAlumno: string,
	tipoDocumento: TipoDocumentoClave,
	extension: string = "pdf",
): { nombreCompleto: string; slugAlumno: string; slugTipo: string; extension: string } {
	const ext = extension.replace(/^\./, "").toLowerCase();
	if (!EXTENSIONES_PERMITIDAS.has(ext)) {
		throw new Error(`Extensión no permitida: ${extension}`);
	}
	const slugAlumno = slugificar(nombreAlumno);
	const slugTipo = TIPOS_DOCUMENTO[tipoDocumento];
	const nombreCompleto = `${slugAlumno}_${slugTipo}.${ext}`;
	return { nombreCompleto, slugAlumno, slugTipo, extension: ext };
}
