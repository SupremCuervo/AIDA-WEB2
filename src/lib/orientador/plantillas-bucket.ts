/**
 * Bucket para plantillas del muro. Si no existe AIDA_PLANTILLAS_BUCKET, reutiliza AIDA_DOCUMENTOS_BUCKET.
 */
export function obtenerBucketPlantillas(): string {
	const dedicado = process.env.AIDA_PLANTILLAS_BUCKET?.trim();
	if (dedicado) {
		return dedicado;
	}
	const doc = process.env.AIDA_DOCUMENTOS_BUCKET?.trim();
	if (!doc) {
		throw new Error(
			"Configura AIDA_PLANTILLAS_BUCKET o AIDA_DOCUMENTOS_BUCKET para el muro de plantillas.",
		);
	}
	return doc;
}
