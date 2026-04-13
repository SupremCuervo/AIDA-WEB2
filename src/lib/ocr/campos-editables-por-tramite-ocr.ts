/**
 * Mismas claves que `AppAida/.../campos_editables_por_tipo_documento_alumno.dart`
 * y extractores API-OCR (`tramite` del modal orientador).
 */
export type CampoEditableTramiteOcr = {
	clave: string;
	etiqueta: string;
	multiline?: boolean;
};

export type TramitePlantillaOcr = "curp" | "ine" | "acta_nacimiento" | "comprobante" | "certificado_medico";

export const CAMPOS_EDITABLES_POR_TRAMITE_OCR: Record<TramitePlantillaOcr, CampoEditableTramiteOcr[]> = {
	acta_nacimiento: [
		{ clave: "nombre", etiqueta: "Nombre completo (persona registrada)" },
		{ clave: "fecha_nacimiento", etiqueta: "Fecha de nacimiento" },
		{ clave: "folio", etiqueta: "Folio" },
		{ clave: "padre", etiqueta: "Nombre del padre" },
		{ clave: "madre", etiqueta: "Nombre de la madre" },
	],
	curp: [
		{ clave: "curp", etiqueta: "CURP" },
		{ clave: "nombre", etiqueta: "Nombre" },
		{ clave: "entidad", etiqueta: "Entidad (estado de nacimiento)" },
	],
	ine: [
		{ clave: "nombre_tutor", etiqueta: "Nombre (titular INE)" },
		{ clave: "clave_elector", etiqueta: "Clave de elector" },
		{ clave: "codigo_postal", etiqueta: "Código postal" },
		{ clave: "ocr_id", etiqueta: "ID en credencial (o respaldo C.P.)" },
		{ clave: "vigencia", etiqueta: "Vigencia" },
	],
	comprobante: [
		{ clave: "nombre_titular", etiqueta: "Nombre del titular" },
		{ clave: "direccion", etiqueta: "Dirección", multiline: true },
		{ clave: "fecha_emision", etiqueta: "Fecha de emisión" },
	],
	certificado_medico: [
		{ clave: "nombre_alumno", etiqueta: "Nombre del alumno" },
		{ clave: "direccion", etiqueta: "Dirección", multiline: true },
		{ clave: "fecha_expedicion", etiqueta: "Fecha de expedición" },
	],
};

export function esTramiteConPlantillaOcr(t: string): t is TramitePlantillaOcr {
	return t in CAMPOS_EDITABLES_POR_TRAMITE_OCR;
}
