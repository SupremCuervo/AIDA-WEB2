import type { SupabaseClient } from "@supabase/supabase-js";
import { NextResponse } from "next/server";
import { esGrupoAccesoCerradoPorFecha } from "@/lib/grupo-tokens/fecha-limite-acceso";
import { COOKIE_ALUMNO, COOKIE_CLAVE_OK, type PayloadClaveOk } from "@/lib/alumno/jwt-cookies";

const CUERPO_VENCIDO = {
	code: "GRUPO_VENCIDO" as const,
	error: "El periodo de acceso de este grupo ha finalizado. Contacta al orientador.",
};

export function jsonAlumnoGrupoVencidoCierraSesion(): NextResponse {
	const res = NextResponse.json(CUERPO_VENCIDO, { status: 401 });
	res.cookies.delete(COOKIE_ALUMNO);
	return res;
}

export function jsonClaveGrupoVencidaCierraCookie(): NextResponse {
	const res = NextResponse.json(
		{
			code: "GRUPO_VENCIDO" as const,
			error:
				"El acceso con esta clave ya no está disponible: finalizó la fecha límite del grupo.",
		},
		{ status: 403 },
	);
	res.cookies.delete(COOKIE_CLAVE_OK);
	return res;
}

export async function grupoTokenEstaVencido(
	supabase: SupabaseClient,
	grupoTokenId: string,
): Promise<boolean> {
	const { data: gt, error } = await supabase
		.from("grupo_tokens")
		.select("fecha_limite_entrega")
		.eq("id", grupoTokenId)
		.maybeSingle();
	if (error || !gt) {
		return true;
	}
	return esGrupoAccesoCerradoPorFecha(gt.fecha_limite_entrega);
}

export async function claveAccesoContextoVencido(
	supabase: SupabaseClient,
	p: PayloadClaveOk,
): Promise<boolean> {
	return grupoTokenEstaVencido(supabase, p.grupoTokenId);
}

export async function padronPerteneceAGrupoVencido(
	supabase: SupabaseClient,
	padronId: string,
): Promise<boolean> {
	const { data: padron, error } = await supabase
		.from("padron_alumnos")
		.select("grupo_token_id")
		.eq("id", padronId)
		.maybeSingle();
	if (error || !padron) {
		return true;
	}
	if (!padron.grupo_token_id) {
		return false;
	}
	return grupoTokenEstaVencido(supabase, padron.grupo_token_id);
}
