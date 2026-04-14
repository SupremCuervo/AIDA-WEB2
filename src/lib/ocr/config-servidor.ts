/**
 * Resolución de la base URL del microservicio API-OCR (Cat-Not-Furry/API-OCR).
 * @see https://github.com/Cat-Not-Furry/API-OCR/blob/main/handoff_aida_ocr_config.txt
 */
export const OCR_BASE_URL_DEMO_HANDOFF = "https://api-ocr-g2g4.onrender.com";

let avisoDemoRegistrado = false;

function normalizarBase(u: string): string {
	return u.trim().replace(/\/$/, "");
}

/** Por defecto 4 min: cold start + OCR.space / Tesseract en hosts lentos. */
const OCR_TIMEOUT_MS_DEFAULT = 240_000;

export function timeoutMsOcrServidor(): number {
	const raw = process.env.AIDA_OCR_TIMEOUT_MS?.trim();
	const n = raw ? Number.parseInt(raw, 10) : Number.NaN;
	return Number.isFinite(n) && n > 5_000 ? n : OCR_TIMEOUT_MS_DEFAULT;
}

/**
 * 1) `AIDA_OCR_API_BASE_URL` si está definida.
 * 2) Si no: en `NODE_ENV === "development"` o con `AIDA_OCR_USE_RENDER_DEMO=1|true|yes`, la URL demo del handoff.
 * 3) Si no: null (p. ej. producción sin variables → OCR desactivado).
 */
export function resolverBaseUrlOcrServidor(): string | null {
	const primaria = process.env.AIDA_OCR_API_BASE_URL?.trim();
	if (primaria) {
		return normalizarBase(primaria);
	}
	const forzarDemoRaw = process.env.AIDA_OCR_USE_RENDER_DEMO?.trim().toLowerCase();
	const forzarDemo =
		forzarDemoRaw === "1" || forzarDemoRaw === "true" || forzarDemoRaw === "yes";
	const esDev = process.env.NODE_ENV === "development";
	if (esDev || forzarDemo) {
		if (!avisoDemoRegistrado) {
			avisoDemoRegistrado = true;
			if (esDev) {
				console.info(
					"[AIDA OCR] AIDA_OCR_API_BASE_URL vacío: en desarrollo se usa la instancia demo pública (puede tardar en despertar).",
				);
			} else {
				console.info(
					"[AIDA OCR] AIDA_OCR_USE_RENDER_DEMO activo: usando instancia demo pública.",
				);
			}
		}
		return normalizarBase(OCR_BASE_URL_DEMO_HANDOFF);
	}
	return null;
}
