/** Matrícula institucional: solo aplica con grado mostrado ≥ 2 (misma regla que carrera). */

const MAX_LEN = 48;

export function normalizarMatriculaPayload(
	v: unknown,
): { ok: true; valor: string | null } | { ok: false; error: string } {
	if (v === null || v === undefined) {
		return { ok: true, valor: null };
	}
	if (typeof v !== "string") {
		return { ok: false, error: "matricula debe ser texto" };
	}
	const t = v.trim().replace(/\s+/g, " ");
	if (t === "") {
		return { ok: true, valor: null };
	}
	if (t.length > MAX_LEN) {
		return { ok: false, error: `Matrícula demasiado larga (máx. ${MAX_LEN} caracteres)` };
	}
	return { ok: true, valor: t };
}
