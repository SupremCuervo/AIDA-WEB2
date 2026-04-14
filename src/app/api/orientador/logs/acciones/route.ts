import { NextResponse } from "next/server";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { orientadorEsJefe } from "@/lib/alumno/jwt-cookies";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

const LIMITE_FILAS_PARA_DEDUPE = 8000;

async function accionesDedupeDesdeFilas(
	supabase: ReturnType<typeof obtenerClienteSupabaseAdmin>,
): Promise<string[]> {
	const { data, error } = await supabase.from("logs").select("accion").limit(LIMITE_FILAS_PARA_DEDUPE);
	if (error) {
		console.error("logs acciones dedupe", error);
		return [];
	}
	const filas = (data ?? []) as { accion: string | null }[];
	const set = new Set<string>();
	for (const r of filas) {
		const a = typeof r.accion === "string" ? r.accion.trim() : "";
		if (a !== "") {
			set.add(a);
		}
	}
	return [...set].sort((x, y) => x.localeCompare(y, "es"));
}

export async function GET() {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	if (!orientadorEsJefe(orientador)) {
		return NextResponse.json({ error: "No autorizado" }, { status: 403 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const rpc = await supabase.rpc("orientador_logs_lista_acciones");
		if (!rpc.error && Array.isArray(rpc.data)) {
			const lista = (rpc.data as unknown[]).filter((x): x is string => typeof x === "string");
			return NextResponse.json({ ok: true, acciones: lista });
		}
		if (rpc.error) {
			console.warn("logs acciones rpc (usa respaldo)", rpc.error.message);
		}
		const acciones = await accionesDedupeDesdeFilas(supabase);
		return NextResponse.json({ ok: true, acciones });
	} catch (e) {
		console.error("logs acciones GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
