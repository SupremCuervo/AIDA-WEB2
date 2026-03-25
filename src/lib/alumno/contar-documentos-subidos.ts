import type { SupabaseClient } from "@supabase/supabase-js";
import {
	slugificar,
	TIPOS_DOCUMENTO,
	type TipoDocumentoClave,
} from "@/lib/nombre-archivo";

/**
 * Cuenta cuántos tipos de documento obligatorios tienen al menos un archivo
 * en el bucket (nombres generados con nombreArchivoEstandar).
 */
export async function contarDocumentosSubidosDesdeStorage(
	supabase: SupabaseClient,
	bucket: string,
	nombreCompletoAlumno: string,
): Promise<{ subidos: number; total: number }> {
	const total = Object.keys(TIPOS_DOCUMENTO).length;
	const slug = slugificar(nombreCompletoAlumno);
	const { data: archivos, error } = await supabase.storage.from(bucket).list("", {
		search: `${slug}_`,
		limit: 100,
	});
	if (error || !archivos?.length) {
		return { subidos: 0, total };
	}
	const nombres = archivos.map((a) => a.name);
	let subidos = 0;
	for (const tipo of Object.keys(TIPOS_DOCUMENTO) as TipoDocumentoClave[]) {
		const base = `${slug}_${TIPOS_DOCUMENTO[tipo]}`;
		const baseLower = base.toLowerCase();
		if (
			nombres.some((n) => {
				const nl = n.toLowerCase();
				return nl.startsWith(`${baseLower}.`);
			})
		) {
			subidos++;
		}
	}
	return { subidos, total };
}
