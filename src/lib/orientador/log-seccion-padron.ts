import type { SupabaseClient } from "@supabase/supabase-js";
import { gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";

/** Campos que escribe la API en `logs.detalle` para columnas Grado/Grupo del historial. */
export type SeccionPadronLog = {
	seccion_grado: string | null;
	seccion_grupo: string | null;
};

/**
 * Grado mostrado y letra de sección (A, B, …) a partir del padrón y sus enlaces.
 */
export async function seccionGradoGrupoParaLogPadron(
	supabase: SupabaseClient,
	padronId: string,
): Promise<SeccionPadronLog> {
	const { data, error } = await supabase
		.from("padron_alumnos")
		.select("grado_alumno, grupo_tokens ( grado, grupo ), institucion_grupos ( grado, grupo )")
		.eq("id", padronId)
		.maybeSingle();
	if (error || !data) {
		return { seccion_grado: null, seccion_grupo: null };
	}
	const gt = data.grupo_tokens as { grado?: unknown; grupo?: unknown } | null;
	const ig = data.institucion_grupos as { grado?: unknown; grupo?: unknown } | null;
	const gradoTok = gt?.grado != null ? String(gt.grado).trim() : "";
	const gradoIg = ig?.grado != null ? String(ig.grado).trim() : "";
	const gradoTokenBase = gradoTok || gradoIg || "1";
	const ga = data.grado_alumno;
	const gradoMostrado = gradoMostradoParaAlumno(
		ga != null && String(ga).trim() !== "" ? String(ga).trim() : null,
		gradoTokenBase,
	);
	let letra: string | null = null;
	if (ig?.grupo != null && String(ig.grupo).trim() !== "") {
		letra = String(ig.grupo).trim().toUpperCase();
	} else if (gt?.grupo != null && String(gt.grupo).trim() !== "") {
		letra = String(gt.grupo).trim().toUpperCase();
	}
	return {
		seccion_grado: gradoMostrado.trim() !== "" ? gradoMostrado : null,
		seccion_grupo: letra,
	};
}

/** Sección escolar vía `cuentas_alumno` → padrón (p. ej. eliminación de adjunto orientador). */
export async function seccionGradoGrupoParaLogCuentaAlumno(
	supabase: SupabaseClient,
	cuentaId: string,
): Promise<SeccionPadronLog> {
	const { data, error } = await supabase
		.from("cuentas_alumno")
		.select("padron_id")
		.eq("id", cuentaId)
		.maybeSingle();
	if (error || !data || typeof data.padron_id !== "string" || data.padron_id.trim() === "") {
		return { seccion_grado: null, seccion_grupo: null };
	}
	return seccionGradoGrupoParaLogPadron(supabase, data.padron_id.trim());
}

/** Sección a partir del token de grupo (p. ej. inactivación masiva por grupo). */
export async function seccionGradoGrupoParaLogGrupoToken(
	supabase: SupabaseClient,
	grupoTokenId: string,
): Promise<SeccionPadronLog> {
	const { data, error } = await supabase
		.from("grupo_tokens")
		.select("grado, grupo, institucion_grupos ( grado, grupo )")
		.eq("id", grupoTokenId)
		.maybeSingle();
	if (error || !data) {
		return { seccion_grado: null, seccion_grupo: null };
	}
	const ig = data.institucion_grupos as { grado?: unknown; grupo?: unknown } | null;
	const gradoTok = data.grado != null ? String(data.grado).trim() : "";
	const gradoIg = ig?.grado != null ? String(ig.grado).trim() : "";
	const base = gradoTok || gradoIg || "1";
	const gm = gradoMostradoParaAlumno(null, base);
	let letra: string | null = null;
	if (ig?.grupo != null && String(ig.grupo).trim() !== "") {
		letra = String(ig.grupo).trim().toUpperCase();
	} else if (data.grupo != null && String(data.grupo).trim() !== "") {
		letra = String(data.grupo).trim().toUpperCase();
	}
	return {
		seccion_grado: gm.trim() !== "" ? gm : null,
		seccion_grupo: letra,
	};
}
