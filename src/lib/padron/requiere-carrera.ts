/** Grado 1: sin carrera. Desde 2.° grado escolar se elige carrera del catálogo. */

export function gradoEscolarNumerico(gradoTexto: string): number {
	const n = Number.parseInt(String(gradoTexto ?? "").trim(), 10);
	return Number.isFinite(n) ? n : 0;
}

export function alumnoRequiereCarrera(gradoMostrado: string): boolean {
	return gradoEscolarNumerico(gradoMostrado) >= 2;
}
