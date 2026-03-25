import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { COOKIE_CLAVE_OK, verificarTokenClaveOk } from "@/lib/alumno/jwt-cookies";
import {
	grupoTokenEstaVencido,
	jsonClaveGrupoVencidaCierraCookie,
} from "@/lib/alumno/requiere-grupo-vigente";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

/**
 * Indica si ya pasó la validación de clave (cookie temporal) sin tener sesión de alumno.
 */
export async function GET() {
	const jar = await cookies();
	const token = jar.get(COOKIE_CLAVE_OK)?.value;
	if (!token) {
		return NextResponse.json({ claveValidada: false });
	}
	try {
		const p = await verificarTokenClaveOk(token);
		const supabase = obtenerClienteSupabaseAdmin();
		if (await grupoTokenEstaVencido(supabase, p.grupoTokenId)) {
			return jsonClaveGrupoVencidaCierraCookie();
		}
		const { data: filaGt } = await supabase
			.from("grupo_tokens")
			.select("grado")
			.eq("id", p.grupoTokenId)
			.maybeSingle();
		if (
			!filaGt ||
			Number.parseInt(String(filaGt.grado ?? "").trim(), 10) !== 1
		) {
			const res = NextResponse.json(
				{
					code: "ACCESO_SOLO_PRIMERO",
					error: "El acceso por clave solo aplica a 1.° grado.",
					claveValidada: false,
				},
				{ status: 403 },
			);
			res.cookies.delete(COOKIE_CLAVE_OK);
			return res;
		}
		return NextResponse.json({
			claveValidada: true,
			grupo: p.grupo,
			grado: p.grado,
			claveAcceso: p.claveAcceso ?? "",
		});
	} catch {
		return NextResponse.json({ claveValidada: false });
	}
}
