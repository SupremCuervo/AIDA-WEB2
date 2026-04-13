import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizarNombreParaComparar } from "@/lib/alumno/normalizar-nombre";

export function normalizarLetraGrupo(letra: string): string {
	return letra.trim().toUpperCase().slice(0, 8);
}

export function claveCargaNormalizada(clave: string): string {
	return clave.trim().toLowerCase();
}

export async function institucionGrupoIdPorGradoLetra(
	supabase: SupabaseClient,
	grado: number,
	letra: string,
): Promise<string | null> {
	const L = normalizarLetraGrupo(letra);
	if (!L) {
		return null;
	}
	const { data, error } = await supabase
		.from("institucion_grupos")
		.select("id")
		.eq("grado", grado)
		.eq("grupo", L)
		.maybeSingle();
	if (error || !data?.id) {
		return null;
	}
	return data.id as string;
}

export type FilaAlumnoCargaInput = { grupoLetra: string; nombreCompleto: string };

export function deduplicarFilasCarga(filas: FilaAlumnoCargaInput[]): FilaAlumnoCargaInput[] {
	const visto = new Set<string>();
	const out: FilaAlumnoCargaInput[] = [];
	for (const f of filas) {
		const g = normalizarLetraGrupo(f.grupoLetra);
		const n = f.nombreCompleto.trim().replace(/\s+/g, " ");
		if (!g || !n) {
			continue;
		}
		const clave = `${normalizarNombreParaComparar(n)}|${g}`;
		if (visto.has(clave)) {
			continue;
		}
		visto.add(clave);
		out.push({ grupoLetra: g, nombreCompleto: n });
	}
	return out;
}
