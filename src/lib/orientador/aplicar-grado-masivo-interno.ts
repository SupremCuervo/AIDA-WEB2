import type { SupabaseClient } from "@supabase/supabase-js";
import { GRADO_ESCOLAR_MAX } from "@/lib/padron/grado-alumno";

export type ResultadoGradoMasivoInterno =
	| {
			ok: true;
			grado: string;
			actualizados: number;
			padronIdsActualizados: string[];
			tokenEliminado: boolean;
			institucionGrupoId: string;
		}
	| { ok: false; error: string };

export type OpcionesGradoMasivoInterno = {
	/**
	 * Si es false, no se aplica el segundo update del padrón (solo alumnos con `grupo_token_id`).
	 * El flujo manual del orientador lo deja en true para alinear 1.° sin token con el token;
	 * el cron de promoción por semestre debe usar false para no arrastrar 1.° al grado del token en subidas 2.°→3.°, etc.
	 */
	incluirPadronSoloPrimeroSinToken: boolean;
};

/**
 * Fila en institucion_grupos para (grado, letra). Crea la sección si no existe.
 */
export async function obtenerOCrearInstitucionGrupoId(
	supabase: SupabaseClient,
	grado: number,
	grupoLetra: string,
): Promise<string | null> {
	const letra = grupoLetra.toUpperCase().trim();
	if (!letra || letra.length !== 1 || !/^[A-Z]$/u.test(letra)) {
		return null;
	}
	const { data: ex, error: errQ } = await supabase
		.from("institucion_grupos")
		.select("id")
		.eq("grado", grado)
		.eq("grupo", letra)
		.maybeSingle();
	if (errQ) {
		console.error("obtenerOCrearInstitucionGrupoId select", errQ);
		return null;
	}
	if (ex?.id) {
		return ex.id as string;
	}
	const { data: ins, error: errI } = await supabase
		.from("institucion_grupos")
		.insert({ grado, grupo: letra })
		.select("id")
		.single();
	if (errI || !ins) {
		console.error("obtenerOCrearInstitucionGrupoId insert", errI);
		return null;
	}
	return ins.id as string;
}

/** Replica filas de `periodo_institucion_grupos` de una sección a otra (promoción / grado masivo). */
export async function copiarPeriodosHaciaNuevaSeccion(
	supabase: SupabaseClient,
	igOrigen: string,
	igDestino: string,
): Promise<void> {
	if (!igOrigen || igOrigen === igDestino) {
		return;
	}
	const { data: periodosRel } = await supabase
		.from("periodo_institucion_grupos")
		.select("periodo_id")
		.eq("institucion_grupo_id", igOrigen);
	for (const pr of periodosRel ?? []) {
		const { error: errP } = await supabase.from("periodo_institucion_grupos").upsert(
			{
				periodo_id: pr.periodo_id as string,
				institucion_grupo_id: igDestino,
			},
			{ onConflict: "periodo_id,institucion_grupo_id" },
		);
		if (errP) {
			console.error("grado masivo periodo_institucion_grupos", errP);
		}
	}
}

/**
 * Misma lógica que POST `/api/orientador/grupo/[grupoTokenId]/grado-masivo` (orientador).
 */
export async function aplicarGradoMasivoInterno(
	supabase: SupabaseClient,
	grupoTokenId: string,
	gradoTarget: number,
	opciones: OpcionesGradoMasivoInterno,
): Promise<ResultadoGradoMasivoInterno> {
	if (gradoTarget < 1 || gradoTarget > GRADO_ESCOLAR_MAX) {
		return { ok: false, error: `El grado debe estar entre 1 y ${GRADO_ESCOLAR_MAX}` };
	}
	const gradoStr = String(gradoTarget);
	const { data: tok, error: errG } = await supabase
		.from("grupo_tokens")
		.select("id, grupo, institucion_grupo_id")
		.eq("id", grupoTokenId)
		.maybeSingle();

	if (errG || !tok) {
		return { ok: false, error: "Grupo no encontrado" };
	}

	const letraGrupo = String(tok.grupo ?? "").trim().toUpperCase();
	if (!/^[A-Z]$/u.test(letraGrupo)) {
		return { ok: false, error: "La letra del grupo del token no es válida para enlazar el grado." };
	}

	const igDestino = await obtenerOCrearInstitucionGrupoId(supabase, gradoTarget, letraGrupo);
	if (!igDestino) {
		return { ok: false, error: "No se pudo crear o localizar la sección en el catálogo (institucion_grupos)." };
	}

	const igPrimero = await obtenerOCrearInstitucionGrupoId(supabase, 1, letraGrupo);
	if (!igPrimero) {
		return { ok: false, error: "No se pudo resolver la sección de 1.° en el catálogo." };
	}

	const esPrimero = gradoTarget === 1;
	const actualizacionPadron = esPrimero
		? {
				grado_alumno: gradoStr,
				carrera_id: null as string | null,
				matricula: null as string | null,
				institucion_grupo_id: igDestino,
				grupo_token_id: grupoTokenId,
			}
		: {
				grado_alumno: gradoStr,
				institucion_grupo_id: igDestino,
				grupo_token_id: null as string | null,
			};

	const { data: actualizadosConToken, error: errU } = await supabase
		.from("padron_alumnos")
		.update(actualizacionPadron)
		.eq("grupo_token_id", grupoTokenId)
		.is("archivo_muerto_en", null)
		.select("id");

	if (errU) {
		console.error("grado masivo padron", errU);
		return { ok: false, error: "No se pudo actualizar el grado" };
	}

	let actualizadosSoloIg: { id: string }[] | null = null;
	if (opciones.incluirPadronSoloPrimeroSinToken) {
		const { data: soloIg, error: errU2 } = await supabase
			.from("padron_alumnos")
			.update(actualizacionPadron)
			.eq("institucion_grupo_id", igPrimero)
			.is("grupo_token_id", null)
			.is("archivo_muerto_en", null)
			.select("id");
		if (errU2) {
			console.error("grado masivo padron solo_ig", errU2);
			return { ok: false, error: "No se pudo actualizar el grado (padrón sin token)" };
		}
		actualizadosSoloIg = soloIg;
	}

	const actualizados = [...(actualizadosConToken ?? []), ...(actualizadosSoloIg ?? [])];

	if (!esPrimero) {
		let igOrigenPeriodo: string | null = (tok.institucion_grupo_id as string | null) ?? null;
		if (!igOrigenPeriodo) {
			igOrigenPeriodo = igPrimero;
		}
		if (igOrigenPeriodo && igOrigenPeriodo !== igDestino) {
			await copiarPeriodosHaciaNuevaSeccion(supabase, igOrigenPeriodo, igDestino);
		}

		const { error: errDel } = await supabase.from("grupo_tokens").delete().eq("id", grupoTokenId);
		if (errDel) {
			console.error("grado masivo delete grupo_tokens", errDel);
			return {
				ok: false,
				error:
					"Se actualizó el padrón, pero no se pudo eliminar la fila de grupo_tokens (revisa permisos o dependencias).",
			};
		}

		return {
			ok: true,
			grado: gradoStr,
			actualizados: actualizados?.length ?? 0,
			padronIdsActualizados: actualizados.map((x) => x.id),
			tokenEliminado: true,
			institucionGrupoId: igDestino,
		};
	}

	let errTokUp = (
		await supabase
			.from("grupo_tokens")
			.update({
				grado: gradoStr,
				institucion_grupo_id: igDestino,
			})
			.eq("id", grupoTokenId)
	).error;

	if (errTokUp) {
		const msg = (errTokUp.message ?? "").toLowerCase();
		if (msg.includes("unique") || msg.includes("duplicate")) {
			errTokUp = (
				await supabase
					.from("grupo_tokens")
					.update({ grado: gradoStr, institucion_grupo_id: null })
					.eq("id", grupoTokenId)
			).error;
		}
	}

	if (errTokUp) {
		console.error("grado masivo grupo_tokens", errTokUp);
		return {
			ok: false,
			error: "Se actualizó el padrón, pero no el enlace del grupo. Revisa en Tokens de grupo.",
		};
	}

	return {
		ok: true,
		grado: gradoStr,
		actualizados: actualizados?.length ?? 0,
		padronIdsActualizados: actualizados.map((x) => x.id),
		tokenEliminado: false,
		institucionGrupoId: igDestino,
	};
}
