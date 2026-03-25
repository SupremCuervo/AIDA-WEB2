/** Normaliza nombre para emparejar filas de Excel con `padron_alumnos.nombre_completo`. */
export function normalizarNombrePadronMatch(texto: string): string {
	return texto
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/\s+/g, " ")
		.trim();
}
