export const MENSAJE_SIN_INTERNET = "No hay conexión a internet";

function textoIndicaSinRed(s: string): boolean {
	const t = s.toLowerCase();
	if (!t.trim()) {
		return false;
	}
	return (
		t.includes("failed to fetch") ||
		t.includes("networkerror") ||
		t.includes("network request failed") ||
		t.includes("load failed") ||
		t.includes("socketexception") ||
		t.includes("clientexception") ||
		t.includes("failed host lookup") ||
		t.includes("host lookup") ||
		t.includes("lookup failed") ||
		t.includes("getaddrinfo") ||
		t.includes("name resolution") ||
		t.includes("temporary failure in name resolution") ||
		t.includes("network is unreachable") ||
		t.includes("no address associated with hostname") ||
		t.includes("connection refused") ||
		t.includes("connection reset") ||
		t.includes("connection aborted") ||
		t.includes("software caused connection abort") ||
		t.includes("connection timed out") ||
		t.includes("timed out waiting for socket") ||
		t.includes("network_error") ||
		t.includes("network error") ||
		t.includes("errno = 7") ||
		t.includes("errno = 8") ||
		t.includes("errno = 51") ||
		t.includes("errno = 101") ||
		t.includes("errno = 103") ||
		(t.includes("os error") && (t.includes("host") || t.includes("network") || t.includes("unreachable"))) ||
		t.includes("unable to connect") ||
		t.includes("could not connect") ||
		t.includes("no route to host") ||
		t.includes("failed to connect") ||
		t.includes("xmlhttprequest error") ||
		t.includes("err_internet_disconnected") ||
		t.includes("internet connection appears to be offline") ||
		(t.includes("connection") && t.includes("reset")) ||
		(t.includes("connection") && t.includes("refused")) ||
		t.includes("econnreset") ||
		t.includes("etimedout") ||
		t.includes("enotfound") ||
		t.includes("econnrefused")
	);
}

/** Mensaje legible a partir de texto de error (Postgres, fetch, etc.). */
function mensajeDesdeTextoCrudo(name: string, msg: string): string {
	const raw = `${name} ${msg}`.trim();
	const lower = raw.toLowerCase();
	if (textoIndicaSinRed(lower)) {
		return MENSAJE_SIN_INTERNET;
	}
	const m = msg.trim();
	if (!m) {
		return "Ocurrió un error inesperado.";
	}
	if (name === "AbortError" || lower.includes("abort")) {
		return "La operación fue cancelada o superó el tiempo de espera.";
	}
	const statusMatch = m.match(/status\s+code\s+(?:of\s+)?(\d{3})\b/i);
	if (statusMatch) {
		const code = statusMatch[1];
		if (code === "504" || code === "408") {
			return "El servidor tardó demasiado en responder. Intenta de nuevo en un momento.";
		}
		if (code === "502" || code === "503") {
			return "El servicio no está disponible temporalmente. Intenta más tarde.";
		}
		if (code.startsWith("5")) {
			return `El servidor devolvió un error (${code}). Intenta de nuevo más tarde.`;
		}
		if (code.startsWith("4")) {
			return `La petición no fue aceptada (${code}). Revisa los datos e intenta de nuevo.`;
		}
	}
	if (/\b504\b/.test(m) && /gateway|timeout/i.test(m)) {
		return "El servidor tardó demasiado en responder. Intenta de nuevo en un momento.";
	}
	if (/ECONNRESET|ETIMEDOUT|ENOTFOUND|ECONNREFUSED|UND_ERR_|socket hang up/i.test(m)) {
		return MENSAJE_SIN_INTERNET;
	}
	if (/jwt expired|token expired|invalid jwt/i.test(lower)) {
		return "La sesión caducó. Vuelve a iniciar sesión.";
	}
	if (/permission denied|row-level security|rls/i.test(lower)) {
		return "No tienes permiso para esta acción.";
	}
	if (/duplicate key|unique constraint/i.test(lower)) {
		return "Ese registro ya existe o está duplicado.";
	}
	if (/foreign key constraint/i.test(lower)) {
		return "No se puede completar: hay datos relacionados que lo impiden.";
	}
	if (m.length > 220 && /exception|was thrown|stack|at\s+\w+\s+\(/i.test(m)) {
		return "Ocurrió un error al comunicarse con el servidor. Revisa la conexión e intenta de nuevo.";
	}
	return m;
}

/**
 * Texto para mostrar al usuario ante un `catch (e)` o error de Supabase/PostgREST.
 * Evita mensajes crudos del runtime (p. ej. «status code of 504»).
 */
export function mensajeCausaParaUsuario(error: unknown): string {
	if (error instanceof Error) {
		return mensajeDesdeTextoCrudo(error.name, error.message);
	}
	if (error && typeof error === "object" && typeof (error as { message?: unknown }).message === "string") {
		return mensajeDesdeTextoCrudo("", (error as { message: string }).message);
	}
	const s = String(error ?? "").trim();
	if (!s) {
		return "Ocurrió un error inesperado.";
	}
	return mensajeDesdeTextoCrudo("", s);
}

/** Evita mensajes crudos del navegador (p. ej. "Failed host lookup", fetch sin red). */
export function mensajeRedAmigable(error: unknown): string {
	return mensajeCausaParaUsuario(error);
}

/** Normaliza un texto ya extraído (p. ej. cuerpo de error de API). */
export function mensajeRedAmigableTexto(texto: string): string {
	if (textoIndicaSinRed(texto.toLowerCase())) {
		return MENSAJE_SIN_INTERNET;
	}
	return texto;
}
