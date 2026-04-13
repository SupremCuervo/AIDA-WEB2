/**
 * Compara nombres del padrón con lo que escribe el alumno (mayúsculas/acentos/espacios).
 */
export function normalizarNombreParaComparar(texto: string): string {
	const sinAcentos = texto
		.normalize("NFD")
		.replace(/\p{M}/gu, "");
	return sinAcentos
		.trim()
		.toLowerCase()
		.replace(/\s+/g, " ");
}
