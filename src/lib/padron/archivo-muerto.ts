import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { COOKIE_ALUMNO } from "@/lib/alumno/jwt-cookies";

export async function padronEstaArchivado(
	supabase: SupabaseClient,
	padronId: string,
): Promise<boolean> {
	const { data, error } = await supabase
		.from("padron_alumnos")
		.select("archivo_muerto_en")
		.eq("id", padronId)
		.maybeSingle();
	if (error || !data) {
		return false;
	}
	return data.archivo_muerto_en != null;
}

export function jsonAlumnoArchivoMuertoCierraSesion(): NextResponse {
	const res = NextResponse.json(
		{
			code: "ARCHIVO_MUERTO" as const,
			error:
				"Tu expediente está en archivo muerto (inactivo). Si necesitas acceso, contacta al orientador.",
		},
		{ status: 401 },
	);
	res.cookies.delete(COOKIE_ALUMNO);
	return res;
}
