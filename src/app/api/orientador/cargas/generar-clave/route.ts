import { NextResponse } from "next/server";
import { generarClaveGrupoTokenLibre } from "@/lib/orientador/carga-grupo-tokens";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Clave numérica 00001–99999 no usada en `grupo_tokens` (orientador puede asignarla manualmente a un grupo).
 */
export async function POST() {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const supabase = obtenerClienteSupabaseAdmin();
	const clave = await generarClaveGrupoTokenLibre(supabase);
	if (!clave) {
		return NextResponse.json(
			{ error: "No se encontró una clave libre tras varios intentos. Vuelve a intentar." },
			{ status: 503 },
		);
	}
	return NextResponse.json({ clave });
}
