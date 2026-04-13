/**
 * Diálogo estándar antes de archivar, eliminar del padrón, borrar plantillas, etc.
 * Solo usar desde el cliente (componentes "use client").
 */
export function confirmarAccionDestructiva(detalle: string): boolean {
	if (typeof window === "undefined") {
		return false;
	}
	return window.confirm(
		`${detalle}\n\n¿Estás de acuerdo?\nPulsa «Aceptar» para continuar o «Cancelar» para no hacer nada.`,
	);
}
