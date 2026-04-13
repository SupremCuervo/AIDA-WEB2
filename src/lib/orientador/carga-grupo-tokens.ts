import type { SupabaseClient } from "@supabase/supabase-js";
import { claveCargaNormalizada, normalizarLetraGrupo } from "@/lib/orientador/cargas-helpers";

const MIN = 1;
const MAX = 99999;
const INTENTOS_MAX = 120;

function codigoCincoDigitos(n: number): string {
	return String(Math.floor(n)).padStart(5, "0");
}

/**
 * Clave numérica 00001–99999 no usada en `grupo_tokens` (comparación insensible a mayúsculas).
 */
export async function generarClaveGrupoTokenLibre(
	supabase: SupabaseClient,
): Promise<string | null> {
	for (let intento = 0; intento < INTENTOS_MAX; intento++) {
		const n = MIN + Math.floor(Math.random() * (MAX - MIN + 1));
		const codigo = codigoCincoDigitos(n);
		const claveNorm = claveCargaNormalizada(codigo);
		const { data: enToken, error: errT } = await supabase
			.from("grupo_tokens")
			.select("id")
			.ilike("clave_acceso", claveNorm)
			.maybeSingle();
		if (errT && errT.code !== "PGRST116") {
			return null;
		}
		if (!enToken) {
			return claveNorm;
		}
	}
	return null;
}

export type TokenSeccionResult = {
	tokenId: string;
	claveAcceso: string;
	tokenExistente: boolean;
};

/**
 * Garantiza una fila en `grupo_tokens` por sección (1:1 con institucion_grupo_id).
 * Si ya existe, solo actualiza `fecha_limite_entrega`.
 */
export async function asegurarTokenParaSeccionCarga(
	supabase: SupabaseClient,
	opts: {
		institucionGrupoId: string;
		gradoCarga: number;
		letraGrupo: string;
		fechaLimiteIso: string;
	},
): Promise<TokenSeccionResult | { error: string }> {
	const L = normalizarLetraGrupo(opts.letraGrupo);
	const { data: existente, error: errE } = await supabase
		.from("grupo_tokens")
		.select("id, clave_acceso")
		.eq("institucion_grupo_id", opts.institucionGrupoId)
		.maybeSingle();
	if (errE && errE.code !== "PGRST116") {
		return { error: "Error al consultar token del grupo" };
	}
	if (existente?.id) {
		const { error: errU } = await supabase
			.from("grupo_tokens")
			.update({ fecha_limite_entrega: opts.fechaLimiteIso })
			.eq("id", existente.id);
		if (errU) {
			return { error: "No se pudo actualizar la fecha límite del token" };
		}
		return {
			tokenId: existente.id as string,
			claveAcceso: String(existente.clave_acceso),
			tokenExistente: true,
		};
	}
	const clave = await generarClaveGrupoTokenLibre(supabase);
	if (!clave) {
		return { error: "No se pudo generar una clave única para el grupo" };
	}
	const { data: ins, error: errI } = await supabase
		.from("grupo_tokens")
		.insert({
			clave_acceso: clave,
			grupo: L,
			grado: String(opts.gradoCarga),
			institucion_grupo_id: opts.institucionGrupoId,
			fecha_limite_entrega: opts.fechaLimiteIso,
		})
		.select("id")
		.single();
	if (errI || !ins?.id) {
		return { error: "No se pudo crear el token del grupo" };
	}
	return {
		tokenId: ins.id as string,
		claveAcceso: clave,
		tokenExistente: false,
	};
}
