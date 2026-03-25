/**
 * Estados persistidos para una entrega con archivo.
 * "pendiente_carga" solo existe en UI cuando no hay fila en BD.
 */
export const ESTADOS_ENTREGA_DOCUMENTO = {
	VALIDADO: "validado",
	RECHAZADO: "rechazado",
	PENDIENTE_REVISION_MANUAL: "pendiente_revision_manual",
} as const;

export type EstadoEntregaDocumentoPersistido =
	(typeof ESTADOS_ENTREGA_DOCUMENTO)[keyof typeof ESTADOS_ENTREGA_DOCUMENTO];

export type EstadoEntregaDocumentoUi =
	| EstadoEntregaDocumentoPersistido
	| "pendiente_carga";

export function esEstadoEntregaPersistido(
	v: string,
): v is EstadoEntregaDocumentoPersistido {
	return (
		v === ESTADOS_ENTREGA_DOCUMENTO.VALIDADO ||
		v === ESTADOS_ENTREGA_DOCUMENTO.RECHAZADO ||
		v === ESTADOS_ENTREGA_DOCUMENTO.PENDIENTE_REVISION_MANUAL
	);
}
