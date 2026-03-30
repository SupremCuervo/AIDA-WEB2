/** Celda devuelta por API-OCR y guardada en ocr_campos (jsonb). */
export type CampoOcrCelda = { value?: string; confidence?: number };

/** Etiquetas alineadas con extractors del API (github.com/Cat-Not-Furry/API-OCR). */
export const ETIQUETAS_CAMPO_OCR: Record<string, string> = {
	nombre: "Nombre (registrado)",
	nombre_tutor: "Nombre / titular (INE)",
	nombre_titular: "Nombre del titular (comprobante)",
	nombre_alumno: "Nombre del alumno (certificado médico)",
	curp: "CURP",
	entidad: "Entidad (estado)",
	clave_elector: "Clave de elector",
	vigencia: "Vigencia",
	ocr_id: "ID OCR (credencial)",
	fecha_nacimiento: "Fecha de nacimiento",
	folio: "Folio",
	padre: "Padre",
	madre: "Madre",
	fecha_emision: "Fecha de emisión",
	direccion: "Dirección",
	fecha_expedicion: "Fecha de expedición",
	cedula_profesional: "Cédula profesional",
};

export function etiquetaCampoOcr(clave: string): string {
	return ETIQUETAS_CAMPO_OCR[clave] ?? clave.replace(/_/g, " ");
}

export function textoValorOcr(raw: unknown): string {
	if (raw == null) {
		return "—";
	}
	if (typeof raw === "string") {
		const t = raw.trim();
		return t === "" ? "—" : t;
	}
	if (typeof raw === "number" && Number.isFinite(raw)) {
		return String(raw);
	}
	return String(raw);
}

export function textoConfianzaOcr(c: number | undefined): string | null {
	if (c == null || !Number.isFinite(c)) {
		return null;
	}
	const pct = c <= 1 ? Math.round(c * 100) : Math.round(Math.min(c, 100));
	return `${pct}%`;
}

export type FilaCampoOcrVista = {
	clave: string;
	etiqueta: string;
	valor: string;
	conf: string | null;
};

/** Normaliza jsonb de Supabase u otra fuente a campos OCR. */
export function parseCamposOcrDesdeJson(raw: unknown): Record<string, CampoOcrCelda> | null {
	if (raw == null || typeof raw !== "object" || Array.isArray(raw)) {
		return null;
	}
	const o = raw as Record<string, unknown>;
	const out: Record<string, CampoOcrCelda> = {};
	for (const [k, v] of Object.entries(o)) {
		if (v != null && typeof v === "object" && !Array.isArray(v)) {
			const c = v as Record<string, unknown>;
			out[k] = {
				value: typeof c.value === "string" ? c.value : undefined,
				confidence: typeof c.confidence === "number" && Number.isFinite(c.confidence) ? c.confidence : undefined,
			};
		}
	}
	return Object.keys(out).length > 0 ? out : null;
}

const CLAVE_OCR_SEGURA = /^[a-zA-Z0-9_]{1,64}$/;

/**
 * Aplica valores editados por el usuario conservando la confianza OCR previa si existe.
 */
export function aplicarEdicionOcrCampos(
	previo: Record<string, CampoOcrCelda> | null,
	edicion: Record<string, unknown>,
	opts?: { maxValorLen?: number },
): Record<string, CampoOcrCelda> {
	const maxValorLen = opts?.maxValorLen ?? 4000;
	const base: Record<string, CampoOcrCelda> = previo ? { ...previo } : {};
	for (const [k, raw] of Object.entries(edicion)) {
		if (!CLAVE_OCR_SEGURA.test(k)) {
			continue;
		}
		let valStr = "";
		if (typeof raw === "string") {
			valStr = raw;
		} else if (raw != null && typeof raw === "object" && !Array.isArray(raw)) {
			const o = raw as Record<string, unknown>;
			valStr = typeof o.value === "string" ? o.value : "";
		}
		valStr = valStr.slice(0, maxValorLen);
		const prevCelda = base[k];
		base[k] = {
			value: valStr,
			confidence: prevCelda?.confidence,
		};
	}
	return base;
}

export function entradasFieldsOrdenadas(
	fields: Record<string, CampoOcrCelda>,
): FilaCampoOcrVista[] {
	const ordenPreferido = [
		"nombre",
		"nombre_tutor",
		"nombre_titular",
		"nombre_alumno",
		"curp",
		"clave_elector",
		"entidad",
		"vigencia",
		"ocr_id",
		"fecha_nacimiento",
		"folio",
		"padre",
		"madre",
		"fecha_emision",
		"direccion",
		"fecha_expedicion",
		"cedula_profesional",
	];
	const claves = Object.keys(fields);
	const rank = (k: string) => {
		const i = ordenPreferido.indexOf(k);
		return i === -1 ? 999 : i;
	};
	return [...claves]
		.sort((a, b) => {
			const ra = rank(a);
			const rb = rank(b);
			if (ra !== rb) {
				return ra - rb;
			}
			return a.localeCompare(b, "es");
		})
		.map((clave) => {
			const celda = fields[clave];
			return {
				clave,
				etiqueta: etiquetaCampoOcr(clave),
				valor: textoValorOcr(celda?.value),
				conf: textoConfianzaOcr(celda?.confidence),
			};
		});
}
