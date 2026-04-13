import type { SupabaseClient } from "@supabase/supabase-js";
import { normalizarUuidPadron } from "@/lib/orientador/carga-padron-sin-mezclar";
import { normalizarLetraGrupo } from "@/lib/orientador/cargas-helpers";
import {
	copiarPeriodosHaciaNuevaSeccion,
	obtenerOCrearInstitucionGrupoId,
} from "@/lib/orientador/aplicar-grado-masivo-interno";
import { GRADO_ESCOLAR_MAX } from "@/lib/padron/grado-alumno";

export type ResultadoGradoSubconjuntoPadron =
	| { ok: true; grado: string; actualizados: number; padronIdsActualizados: string[] }
	| { ok: false; error: string };

/**
 * Expedientes activos de una carga concretos que siguen en una sección (institucion_grupo_id).
 */
export async function obtenerPadronIdsActivosCargaEnSeccion(
	supabase: SupabaseClient,
	cargaId: string,
	letra: string,
	institucionGrupoId: string,
): Promise<string[]> {
	const L = normalizarLetraGrupo(letra);
	if (!L) {
		return [];
	}
	const { data: lineas, error: errL } = await supabase
		.from("carga_alumnos_linea")
		.select("padron_id, grupo_letra")
		.eq("carga_id", cargaId);
	if (errL) {
		console.error("obtenerPadronIdsActivosCargaEnSeccion lineas", errL);
		return [];
	}
	const pidsLinea = new Set<string>();
	for (const ln of lineas ?? []) {
		if (normalizarLetraGrupo(String((ln as { grupo_letra?: string }).grupo_letra ?? "")) !== L) {
			continue;
		}
		const id = normalizarUuidPadron((ln as { padron_id?: unknown }).padron_id);
		if (id) {
			pidsLinea.add(id);
		}
	}
	if (pidsLinea.size === 0) {
		return [];
	}
	const { data: padron, error: errP } = await supabase
		.from("padron_alumnos")
		.select("id")
		.in("id", [...pidsLinea])
		.eq("institucion_grupo_id", institucionGrupoId)
		.is("archivo_muerto_en", null);
	if (errP) {
		console.error("obtenerPadronIdsActivosCargaEnSeccion padron", errP);
		return [];
	}
	return (padron ?? []).map((r) => String(r.id));
}

/**
 * Cambia grado solo para los padron_id indicados (p. ej. alumnos de una carga concreta).
 * No elimina filas de grupo_tokens: el resto de alumnos del token o sección no se mueve.
 */
export async function aplicarGradoSubconjuntoPadron(
	supabase: SupabaseClient,
	padronIds: string[],
	gradoTarget: number,
	letraGrupo: string,
	opciones?: { carreraIdSiPasaAGrado2?: string },
): Promise<ResultadoGradoSubconjuntoPadron> {
	const ids = [...new Set(padronIds.map((x) => String(x).trim()).filter(Boolean))];
	if (ids.length === 0) {
		return { ok: false, error: "No hay alumnos seleccionados" };
	}
	if (gradoTarget < 1 || gradoTarget > GRADO_ESCOLAR_MAX) {
		return { ok: false, error: `El grado debe estar entre 1 y ${GRADO_ESCOLAR_MAX}` };
	}
	const gradoStr = String(gradoTarget);
	const letra = normalizarLetraGrupo(letraGrupo);
	if (!letra || !/^[A-Z]$/u.test(letra)) {
		return { ok: false, error: "Letra de grupo no válida" };
	}

	const { data: antes, error: errAntes } = await supabase
		.from("padron_alumnos")
		.select("id, institucion_grupo_id")
		.in("id", ids)
		.is("archivo_muerto_en", null);
	if (errAntes || !antes?.length) {
		return { ok: false, error: "No se encontraron expedientes activos para actualizar" };
	}
	const igOrigen = String(antes[0].institucion_grupo_id ?? "");
	if (!igOrigen) {
		return { ok: false, error: "Falta sección en el padrón" };
	}
	const distinto = antes.some((r) => String(r.institucion_grupo_id ?? "") !== igOrigen);
	if (distinto) {
		return { ok: false, error: "Los alumnos no pertenecen a la misma sección" };
	}

	const igDestino = await obtenerOCrearInstitucionGrupoId(supabase, gradoTarget, letra);
	if (!igDestino) {
		return { ok: false, error: "No se pudo resolver la sección destino" };
	}
	const igPrimero = await obtenerOCrearInstitucionGrupoId(supabase, 1, letra);
	if (!igPrimero) {
		return { ok: false, error: "No se pudo resolver la sección de 1.°" };
	}

	const esPrimero = gradoTarget === 1;
	const carrera12 = opciones?.carreraIdSiPasaAGrado2?.trim() ?? "";
	const actualizacionPadron = esPrimero
		? {
				grado_alumno: gradoStr,
				carrera_id: null as string | null,
				matricula: null as string | null,
				institucion_grupo_id: igDestino,
				grupo_token_id: null as string | null,
			}
		: gradoTarget === 2 && carrera12
			? {
					grado_alumno: gradoStr,
					carrera_id: carrera12,
					institucion_grupo_id: igDestino,
					grupo_token_id: null as string | null,
				}
			: {
					grado_alumno: gradoStr,
					institucion_grupo_id: igDestino,
					grupo_token_id: null as string | null,
				};

	if (!esPrimero && igOrigen && igOrigen !== igDestino) {
		await copiarPeriodosHaciaNuevaSeccion(supabase, igOrigen, igDestino);
	}

	const { data: updated, error: errU } = await supabase
		.from("padron_alumnos")
		.update(actualizacionPadron)
		.in("id", ids)
		.is("archivo_muerto_en", null)
		.select("id");

	if (errU) {
		console.error("aplicarGradoSubconjuntoPadron update", errU);
		return { ok: false, error: "No se pudo actualizar el grado" };
	}

	return {
		ok: true,
		grado: gradoStr,
		actualizados: updated?.length ?? 0,
		padronIdsActualizados: (updated ?? []).map((x) => String(x.id)),
	};
}
