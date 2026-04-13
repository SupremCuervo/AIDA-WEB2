/**
 * Acorta mensajes del API-OCR (p. ej. Tesseract) para mostrar en tablas y modales.
 */
export function mensajeOcrUiCorto(raw: string | null | undefined): string {
	if (raw == null) {
		return "";
	}
	const s = raw.trim();
	if (s === "") {
		return "";
	}
	const low = s.toLowerCase();
	if (
		low.includes("tesseract") &&
		(low.includes("no devolv") || low.includes("no detect") || low.includes("vacío") || low.includes("vacio"))
	) {
		return "Sin texto reconocible en la imagen.";
	}
	if (low.includes("timeout") && low.includes("tesseract")) {
		return "Tiempo agotado al leer la imagen.";
	}
	if (s.length <= 120) {
		return s;
	}
	return `${s.slice(0, 117)}…`;
}

/** Fecha compacta para líneas tipo “extraído el …”. */
export function fechaOcrUiCorta(iso: string | null | undefined): string {
	if (iso == null || String(iso).trim() === "") {
		return "";
	}
	try {
		const d = new Date(String(iso));
		if (Number.isNaN(d.getTime())) {
			return "";
		}
		return d.toLocaleDateString("es-MX", { day: "2-digit", month: "short", year: "numeric" });
	} catch {
		return "";
	}
}
