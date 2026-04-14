import { NextResponse } from "next/server";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { orientadorEsJefe } from "@/lib/alumno/jwt-cookies";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import {
	gradoGrupoContextoDesdeLog,
	coincideFiltroGrado,
	coincideFiltroGrupo,
} from "@/lib/orientador/logs-filtro-contexto";

export const runtime = "nodejs";

const LIMITE_BASE = 500;
const LIMITE_CON_FILTRO_GRADO_GRUPO = 2500;

function sanitizarPatronIlike(s: string): string {
	return s.replace(/\\/g, "").replace(/%/g, "").replace(/_/g, "");
}

export type RegistroLogHistorial = {
	id: string;
	creado_en: string;
	actor_tipo: string;
	actor_etiqueta: string;
	accion: string;
	entidad: string;
	entidad_id: string | null;
	origen: string;
	grado_contexto: string | null;
	grupo_contexto: string | null;
};

export async function GET(req: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	if (!orientadorEsJefe(orientador)) {
		return NextResponse.json({ error: "No autorizado" }, { status: 403 });
	}

	const url = new URL(req.url);
	const desde = url.searchParams.get("desde")?.trim() ?? "";
	const hasta = url.searchParams.get("hasta")?.trim() ?? "";
	const accion = url.searchParams.get("accion")?.trim() ?? "";
	const correo = sanitizarPatronIlike(url.searchParams.get("correo")?.trim() ?? "");
	const gradoF = url.searchParams.get("grado")?.trim() ?? "";
	const grupoF = url.searchParams.get("grupo")?.trim() ?? "";

	const limite =
		gradoF !== "" || grupoF !== "" ? LIMITE_CON_FILTRO_GRADO_GRUPO : LIMITE_BASE;

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		let q = supabase
			.from("logs")
			.select(
				"id, creado_en, actor_tipo, actor_id, actor_etiqueta, accion, entidad, entidad_id, detalle, origen",
			)
			.order("creado_en", { ascending: false })
			.limit(limite);

		if (desde !== "") {
			const inicio = `${desde}T00:00:00.000Z`;
			q = q.gte("creado_en", inicio);
		}
		if (hasta !== "") {
			const fin = `${hasta}T23:59:59.999Z`;
			q = q.lte("creado_en", fin);
		}
		if (accion !== "") {
			q = q.eq("accion", accion);
		}
		if (correo !== "") {
			q = q.ilike("actor_etiqueta", `%${correo}%`);
		}

		const { data, error } = await q;

		if (error) {
			console.error("logs GET", error);
			return NextResponse.json({ error: "No se pudieron cargar los registros" }, { status: 500 });
		}

		const filas = (data ?? []) as Array<{
			id: string;
			creado_en: string;
			actor_tipo: string;
			actor_etiqueta: string;
			accion: string;
			entidad: string;
			entidad_id: string | null;
			detalle: unknown;
			origen: string;
		}>;

		const enriquecidos: RegistroLogHistorial[] = filas.map((row) => {
			const { grado, grupo } = gradoGrupoContextoDesdeLog(row.entidad, row.detalle);
			return {
				id: row.id,
				creado_en: row.creado_en,
				actor_tipo: row.actor_tipo,
				actor_etiqueta: row.actor_etiqueta,
				accion: row.accion,
				entidad: row.entidad,
				entidad_id: row.entidad_id,
				origen: row.origen,
				grado_contexto: grado,
				grupo_contexto: grupo,
			};
		});

		const filtrados =
			gradoF !== "" || grupoF !== ""
				? enriquecidos.filter(
						(r) =>
							coincideFiltroGrado(gradoF, r.grado_contexto) &&
							coincideFiltroGrupo(grupoF, r.grupo_contexto),
					)
				: enriquecidos;

		return NextResponse.json({ ok: true, registros: filtrados });
	} catch (e) {
		console.error("logs GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
