import type { PostgrestError, SupabaseClient } from "@supabase/supabase-js";

/** Tamaño razonable para insert masivo; ante 23505 se reintenta fila a fila. */
const TAM_CHUNK = 200;

/**
 * Inserta filas en padron_alumnos ignorando duplicados (índices únicos parciales).
 * PostgREST no puede usar upsert/onConflict con esos índices (error 42P10).
 */
export async function insertarPadronAlumnosIgnorarDuplicados<
	T extends Record<string, unknown>,
>(supabase: SupabaseClient, filas: T[]): Promise<{ error: PostgrestError | null }> {
	for (let i = 0; i < filas.length; i += TAM_CHUNK) {
		const chunk = filas.slice(i, i + TAM_CHUNK);
		const { error } = await supabase.from("padron_alumnos").insert(chunk);
		if (!error) {
			continue;
		}
		if (error.code !== "23505") {
			return { error };
		}
		for (const row of chunk) {
			const { error: errFila } = await supabase.from("padron_alumnos").insert([row]);
			if (errFila && errFila.code !== "23505") {
				return { error: errFila };
			}
		}
	}
	return { error: null };
}
