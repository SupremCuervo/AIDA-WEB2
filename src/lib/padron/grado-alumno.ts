/** Rango de grado escolar en la app (primaria u homólogo 1–6). */
export const GRADO_ESCOLAR_MAX = 6;

/**
 * Grado escolar mostrado en toda la app (expediente, panel alumno, listados): un solo valor.
 * Opcional por fila en padrón (`grado_alumno`); si no va definido, se usa el grado del enlace
 * del grupo (`grupo_tokens.grado`, a menudo 1 solo como clave técnica). No hay conflicto: 2 en
 * padrón y 1 en el token es válido.
 */
export type ResultadoNormalizarGradoAlumno =
	| { ok: true; valor: string | null }
	| { ok: false; error: string };

export function normalizarGradoAlumnoPayload(v: unknown): ResultadoNormalizarGradoAlumno {
	if (v === null) {
		return { ok: true, valor: null };
	}
	if (typeof v !== "string") {
		return { ok: false, error: "gradoAlumno debe ser texto, null o vacío" };
	}
	const s = v.trim();
	if (s === "") {
		return { ok: true, valor: null };
	}
	if (!/^\d+$/.test(s)) {
		return { ok: false, error: `Grado: usa un número entre 1 y ${GRADO_ESCOLAR_MAX}` };
	}
	const n = Number.parseInt(s, 10);
	if (n < 1 || n > GRADO_ESCOLAR_MAX) {
		return { ok: false, error: `Grado: debe estar entre 1 y ${GRADO_ESCOLAR_MAX}` };
	}
	return { ok: true, valor: String(n) };
}

export function gradoMostradoParaAlumno(
	gradoAlumno: string | null | undefined,
	gradoToken: string,
): string {
	const o =
		gradoAlumno != null && String(gradoAlumno).trim() !== ""
			? String(gradoAlumno).trim()
			: "";
	return o || gradoToken;
}

const GRADO_ETIQUETA_VISTA: Record<string, string> = {
	"1": "PRIMERO",
};

/** Vista alumno: grado numérico `1` → `PRIMERO`; cualquier otro valor se muestra igual. */
export function gradoEtiquetaParaVistaAlumno(grado: string | null | undefined): string {
	if (grado == null) {
		return "";
	}
	const t = String(grado).trim();
	if (t === "") {
		return "";
	}
	return GRADO_ETIQUETA_VISTA[t] ?? t;
}
