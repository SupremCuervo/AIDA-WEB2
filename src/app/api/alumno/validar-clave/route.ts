import { NextResponse } from "next/server";
import { firmarTokenClaveOk, COOKIE_CLAVE_OK } from "@/lib/alumno/jwt-cookies";
import { opcionesCookieHttp } from "@/lib/alumno/cookie-opts";
import { esGrupoAccesoCerradoPorFecha } from "@/lib/grupo-tokens/fecha-limite-acceso";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function POST(request: Request) {
	let clave = "";
	try {
		const body = (await request.json()) as { clave?: string };
		clave = typeof body.clave === "string" ? body.clave.trim() : "";
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	if (!clave) {
		return NextResponse.json({ error: "La clave es obligatoria" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data, error } = await supabase
			.from("grupo_tokens")
			.select("id, grupo, grado, fecha_limite_entrega")
			.eq("clave_acceso", clave)
			.maybeSingle();

		if (error) {
			console.error("validar-clave supabase", error);
			return NextResponse.json({ error: "Error al validar la clave" }, { status: 500 });
		}

		if (!data) {
			return NextResponse.json(
				{ code: "CLAVE_INVALIDA", error: "Clave no válida o inexistente" },
				{ status: 401 },
			);
		}

		if (esGrupoAccesoCerradoPorFecha(data.fecha_limite_entrega)) {
			return NextResponse.json(
				{
					code: "GRUPO_VENCIDO",
					error:
						"Esta clave ya no permite acceso: finalizó la fecha límite configurada para el grupo.",
				},
				{ status: 403 },
			);
		}

		if (Number.parseInt(String(data.grado ?? "").trim(), 10) !== 1) {
			return NextResponse.json(
				{
					code: "CLAVE_NO_PRIMERO",
					error:
						"El acceso con clave solo aplica a 1.° grado. Desde 2.° el alumno no usa token de grupo.",
				},
				{ status: 403 },
			);
		}

		const jwt = await firmarTokenClaveOk({
			grupoTokenId: data.id,
			grupo: data.grupo,
			grado: data.grado,
			claveAcceso: clave,
		});

		const res = NextResponse.json({
			ok: true,
			grupo: data.grupo,
			grado: data.grado,
		});
		res.cookies.set(COOKIE_CLAVE_OK, jwt, opcionesCookieHttp(30 * 60));
		return res;
	} catch (e) {
		console.error(e);
		return NextResponse.json(
			{ code: "CONFIG_ERROR", error: "Configuración del servidor incompleta" },
			{ status: 500 },
		);
	}
}
