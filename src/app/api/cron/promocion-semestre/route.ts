import { NextResponse } from "next/server";
import { ejecutarPromocionSemestreSiCorresponde } from "@/lib/orientador/promocion-semestre";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Programar con Vercel Cron, Supabase pg_cron + pg_net, o similar: GET diario.
 * Seguridad: `Authorization: Bearer <CRON_SECRET>` (misma variable en el servidor y en el scheduler).
 */
export async function GET(request: Request) {
	const secreto = process.env.CRON_SECRET?.trim();
	if (!secreto) {
		return NextResponse.json({ error: "CRON_SECRET no configurado" }, { status: 503 });
	}
	const auth = request.headers.get("authorization") ?? "";
	const esperado = `Bearer ${secreto}`;
	if (auth !== esperado) {
		return NextResponse.json({ error: "No autorizado" }, { status: 401 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const r = await ejecutarPromocionSemestreSiCorresponde(supabase);
		if (!r.ejecutado) {
			return NextResponse.json({ ok: true, ejecutado: false, motivo: r.motivo });
		}
		return NextResponse.json({ ok: true, ejecutado: true, tipo: r.tipo });
	} catch (e) {
		console.error("cron promocion-semestre", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
