import type { SupabaseClient } from "@supabase/supabase-js";
import {
	institucionGrupoIdPorGradoLetra,
	normalizarLetraGrupo,
} from "@/lib/orientador/cargas-helpers";

/** Claves de acceso actuales por letra de grupo (desde `grupo_tokens` por sección). */
export async function mapClavesPorLetraCarga(
	supabase: SupabaseClient,
	gradoCarga: number,
	gruposLetras: string[],
): Promise<Record<string, string>> {
	const out: Record<string, string> = {};
	for (const raw of gruposLetras) {
		const g = normalizarLetraGrupo(String(raw));
		if (!g) {
			continue;
		}
		const ig = await institucionGrupoIdPorGradoLetra(supabase, gradoCarga, g);
		if (!ig) {
			continue;
		}
		const { data: tok } = await supabase
			.from("grupo_tokens")
			.select("clave_acceso")
			.eq("institucion_grupo_id", ig)
			.maybeSingle();
		if (tok?.clave_acceso) {
			out[g] = String(tok.clave_acceso);
		}
	}
	return out;
}
