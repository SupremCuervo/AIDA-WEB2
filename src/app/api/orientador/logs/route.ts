import { NextResponse } from "next/server";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

const LIMITE = 200;

export async function GET() {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data, error } = await supabase
			.from("logs")
			.select(
				"id, creado_en, actor_tipo, actor_id, actor_etiqueta, accion, entidad, entidad_id, detalle, origen",
			)
			.order("creado_en", { ascending: false })
			.limit(LIMITE);

		if (error) {
			console.error("logs GET", error);
			return NextResponse.json({ error: "No se pudieron cargar los registros" }, { status: 500 });
		}

		return NextResponse.json({ ok: true, registros: data ?? [] });
	} catch (e) {
		console.error("logs GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
