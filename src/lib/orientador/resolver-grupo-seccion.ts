import type { SupabaseClient } from "@supabase/supabase-js";

export type ResolucionGrupoSeccion =
	| {
			tipo: "token";
			grupoTokenId: string;
			/** Null si el token aún no enlaza al catálogo (solo filtra por grupo_token_id). */
			institucionGrupoId: string | null;
			grado: string;
			grupo: string;
			fechaLimiteEntrega: string | null;
	  }
	| {
			tipo: "solo_institucion";
			institucionGrupoId: string;
			grado: string;
			grupo: string;
			fechaLimiteEntrega: null;
	  };

/**
 * El parámetro de ruta `/orientador/panel/grupo/[id]` puede ser `grupo_tokens.id`
 * o `institucion_grupos.id` (grupo sin token, p. ej. tras cambio de grado).
 */
export async function resolverGrupoSeccionPorId(
	supabase: SupabaseClient,
	paramId: string,
): Promise<
	{ ok: true; resolucion: ResolucionGrupoSeccion } | { ok: false; status: 404 }
> {
	const { data: tok, error: errT } = await supabase
		.from("grupo_tokens")
		.select("id, grado, grupo, fecha_limite_entrega, institucion_grupo_id")
		.eq("id", paramId)
		.maybeSingle();

	if (!errT && tok) {
		let igId = tok.institucion_grupo_id as string | null;
		if (!igId) {
			const gn = Number.parseInt(String(tok.grado ?? "").trim(), 10);
			const letra = String(tok.grupo ?? "")
				.trim()
				.toUpperCase();
			if (!Number.isNaN(gn) && gn >= 1 && gn <= 6 && /^[A-Z]$/u.test(letra)) {
				const { data: ig } = await supabase
					.from("institucion_grupos")
					.select("id")
					.eq("grado", gn)
					.eq("grupo", letra)
					.maybeSingle();
				igId = ig?.id ?? null;
			}
		}
		return {
			ok: true,
			resolucion: {
				tipo: "token",
				grupoTokenId: tok.id as string,
				institucionGrupoId: igId,
				grado: String(tok.grado ?? "").trim() || "1",
				grupo: String(tok.grupo ?? "")
					.trim()
					.toUpperCase(),
				fechaLimiteEntrega: (tok.fecha_limite_entrega as string | null) ?? null,
			},
		};
	}

	const { data: ig, error: errI } = await supabase
		.from("institucion_grupos")
		.select("id, grado, grupo")
		.eq("id", paramId)
		.maybeSingle();

	if (!errI && ig) {
		return {
			ok: true,
			resolucion: {
				tipo: "solo_institucion",
				institucionGrupoId: ig.id as string,
				grado: String(ig.grado ?? "").trim(),
				grupo: String(ig.grupo ?? "")
					.trim()
					.toUpperCase(),
				fechaLimiteEntrega: null,
			},
		};
	}

	return { ok: false, status: 404 };
}

/** Filtro padrón: pertenecen a la sección (token y/o catálogo). */
export function padronPerteneceASeccion(
	fila: { grupo_token_id: string | null; institucion_grupo_id: string | null },
	resolucion: ResolucionGrupoSeccion,
): boolean {
	if (resolucion.tipo === "token") {
		if (resolucion.institucionGrupoId) {
			return (
				fila.grupo_token_id === resolucion.grupoTokenId ||
				fila.institucion_grupo_id === resolucion.institucionGrupoId
			);
		}
		return fila.grupo_token_id === resolucion.grupoTokenId;
	}
	return fila.institucion_grupo_id === resolucion.institucionGrupoId;
}
