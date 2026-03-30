/** Lógica compartida aida-data Edge (sin dependencias de runtime). */

export const TIPOS_DOCUMENTO: Record<string, string> = {
	acta_nacimiento: "acta_nacimiento",
	curp: "curp",
	ine_tutor: "ine_tutor",
	comprobante_domicilio: "comprobante_domicilio",
	certificado_medico: "certificado_medico",
};

export const PREFIJO_ADJ_ORIENTADOR = "orientador_adjunto_";

export function esTipoDocValido(v: string): boolean {
	return Object.prototype.hasOwnProperty.call(TIPOS_DOCUMENTO, v);
}

export function esAdjuntoOrientador(v: string): boolean {
	return typeof v === "string" && v.startsWith(PREFIJO_ADJ_ORIENTADOR) && v.length > PREFIJO_ADJ_ORIENTADOR.length + 8;
}

export function quitarAcentos(texto: string): string {
	return texto.normalize("NFD").replace(/\p{M}/gu, "");
}

export function slugificar(texto: string): string {
	const sinAcentos = quitarAcentos(texto.trim().toLowerCase());
	const soloSeguro = sinAcentos.replace(/[^a-z0-9]+/g, "_");
	return soloSeguro.replace(/^_+|_+$/g, "").replace(/_+/g, "_") || "sin_nombre";
}

export function crearTipoAdjuntoOrientador(): string {
	const id = crypto.randomUUID().replace(/-/g, "");
	return `${PREFIJO_ADJ_ORIENTADOR}${id}`;
}

export function nombreArchivoEstandar(
	nombreAlumno: string,
	tipoDocumento: string,
	extension: string,
): string {
	const ext = extension.replace(/^\./, "").toLowerCase();
	const slugAlumno = slugificar(nombreAlumno);
	const slugTipo = TIPOS_DOCUMENTO[tipoDocumento] ?? tipoDocumento;
	return `${slugAlumno}_${slugTipo}.${ext}`;
}

export function nombreRutaAdjuntoOrientador(
	slugAlumno: string,
	etiquetaLegible: string,
	tipoDocumentoCompleto: string,
	extension: string,
): string {
	const ext = extension.replace(/^\./, "").toLowerCase();
	const sinPrefijo = tipoDocumentoCompleto.startsWith(PREFIJO_ADJ_ORIENTADOR)
		? tipoDocumentoCompleto.slice(PREFIJO_ADJ_ORIENTADOR.length)
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

export function extDesdeNombre(nombreArchivo: string): string {
	const i = nombreArchivo.lastIndexOf(".");
	if (i < 0 || i === nombreArchivo.length - 1) {
		return "";
	}
	return nombreArchivo.slice(i + 1);
}

export function gradoMostradoParaAlumno(gradoAlumno: string | null | undefined, gradoToken: string): string {
	const o =
		gradoAlumno != null && String(gradoAlumno).trim() !== ""
			? String(gradoAlumno).trim()
			: "";
	return o || gradoToken;
}

export function alumnoRequiereCarrera(gradoMostrado: string): boolean {
	const n = Number.parseInt(String(gradoMostrado ?? "").trim(), 10);
	return Number.isFinite(n) ? n >= 2 : false;
}

export function cuentaIdDesdePadron(
	c: { id: string }[] | { id: string } | null,
): string | null {
	if (!c) {
		return null;
	}
	if (Array.isArray(c)) {
		return c[0]?.id ?? null;
	}
	return typeof (c as { id: string }).id === "string" ? (c as { id: string }).id : null;
}

export function b64ToBytes(b64: string): Uint8Array {
	const bin = atob(b64);
	const u = new Uint8Array(bin.length);
	for (let i = 0; i < bin.length; i++) {
		u[i] = bin.charCodeAt(i);
	}
	return u;
}

export function bytesToB64(buf: Uint8Array): string {
	let s = "";
	for (let i = 0; i < buf.length; i++) {
		s += String.fromCharCode(buf[i]!);
	}
	return btoa(s);
}
