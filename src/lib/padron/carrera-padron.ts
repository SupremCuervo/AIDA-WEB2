import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export type ResultadoNormalizarCarreraId =
	| { ok: true; valor: string | null }
	| { ok: false; error: string };

const UUID_RE =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function normalizarCarreraIdPayload(v: unknown): ResultadoNormalizarCarreraId {
	if (v === null || v === undefined) {
		return { ok: true, valor: null };
	}
	if (typeof v !== "string") {
		return { ok: false, error: "carreraId debe ser texto UUID o null" };
	}
	const s = v.trim();
	if (s === "") {
		return { ok: true, valor: null };
	}
	if (!UUID_RE.test(s)) {
		return { ok: false, error: "carreraId no es un UUID válido" };
	}
	return { ok: true, valor: s };
}

export async function carreraExisteEnCatalogo(
	supabase: SupabaseClient,
	carreraId: string,
): Promise<boolean> {
	const { data, error } = await supabase.from("carreras").select("id").eq("id", carreraId).maybeSingle();
	return !error && Boolean(data?.id);
}
