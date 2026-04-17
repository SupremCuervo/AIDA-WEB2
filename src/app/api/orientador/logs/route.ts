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
	/** Correo para mostrar en columnas de auditoría (resuelve orientador por `actor_id` si hace falta). */
	correo_electronico: string;
	accion: string;
	entidad: string;
	entidad_id: string | null;
	origen: string;
	grado_contexto: string | null;
	grupo_contexto: string | null;
};

function etiquetaEsSistema(etiqueta: string): boolean {
	const t = etiqueta.trim().toLowerCase();
	return t === "" || t === "sistema";
}

function correoDesdeFila(
	row: {
		actor_tipo: string;
		actor_id: string | null;
		actor_etiqueta: string;
		detalle?: unknown;
	},
	emailsPorOrientadorId: Map<string, string>,
): string {
	const tipo = String(row.actor_tipo ?? "").trim().toLowerCase();
	if (tipo === "orientador" && row.actor_id) {
		const deTabla = emailsPorOrientadorId.get(row.actor_id);
		if (deTabla && deTabla.trim() !== "") {
			return deTabla.trim();
		}
	}
	const et = String(row.actor_etiqueta ?? "").trim();
	if (!etiquetaEsSistema(et) && et.includes("@")) {
		return et;
	}
	const orientadorIdDetalle = orientadorIdDesdeDetalle(row.detalle);
	if (orientadorIdDetalle) {
		const deDetalle = emailsPorOrientadorId.get(orientadorIdDetalle);
		if (deDetalle && deDetalle.trim() !== "") {
			return deDetalle.trim();
		}
	}
	return "";
}

function orientadorIdDesdeDetalle(detalle: unknown): string | null {
	if (!detalle || typeof detalle !== "object") {
		return null;
	}
	const d = detalle as Record<string, unknown>;
	const despues =
		d.despues && typeof d.despues === "object" ? (d.despues as Record<string, unknown>) : null;
	const antes = d.antes && typeof d.antes === "object" ? (d.antes as Record<string, unknown>) : null;
	const candidatoDespues = typeof despues?.orientador_id === "string" ? despues.orientador_id.trim() : "";
	if (candidatoDespues !== "") {
		return candidatoDespues;
	}
	const candidatoAntes = typeof antes?.orientador_id === "string" ? antes.orientador_id.trim() : "";
	if (candidatoAntes !== "") {
		return candidatoAntes;
	}
	return null;
}

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
			.eq("origen", "api")
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
		const accionFiltro = sanitizarPatronIlike(accion);
		if (accionFiltro !== "") {
			q = q.ilike("accion", `%${accionFiltro}%`);
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
			actor_id: string | null;
			actor_etiqueta: string;
			accion: string;
			entidad: string;
			entidad_id: string | null;
			detalle: unknown;
			origen: string;
		}>;

		const idsOrientador = new Set<string>();
		for (const row of filas) {
			const tipo = String(row.actor_tipo ?? "").trim().toLowerCase();
			if (tipo === "orientador" && row.actor_id) {
				idsOrientador.add(row.actor_id);
			}
			const oidDetalle = orientadorIdDesdeDetalle(row.detalle);
			if (oidDetalle) {
				idsOrientador.add(oidDetalle);
			}
		}
		const emailsPorOrientadorId = new Map<string, string>();
		if (idsOrientador.size > 0) {
			const { data: orientadoresRows, error: errOrientadores } = await supabase
				.from("orientadores")
				.select("id, email")
				.in("id", [...idsOrientador]);
			if (errOrientadores) {
				console.error("logs GET orientadores email", errOrientadores);
			} else {
				for (const o of orientadoresRows ?? []) {
					const id = typeof o.id === "string" ? o.id : "";
					const em = typeof o.email === "string" ? o.email.trim() : "";
					if (id !== "" && em !== "") {
						emailsPorOrientadorId.set(id, em);
					}
				}
			}
		}

		const enriquecidos: RegistroLogHistorial[] = filas.map((row) => {
			const { grado, grupo } = gradoGrupoContextoDesdeLog(row.entidad, row.detalle);
			return {
				id: row.id,
				creado_en: row.creado_en,
				actor_tipo: row.actor_tipo,
				actor_etiqueta: row.actor_etiqueta,
				correo_electronico: correoDesdeFila(
					{
						actor_tipo: row.actor_tipo,
						actor_id: row.actor_id,
						actor_etiqueta: row.actor_etiqueta,
						detalle: row.detalle,
					},
					emailsPorOrientadorId,
				),
				accion: row.accion,
				entidad: row.entidad,
				entidad_id: row.entidad_id,
				origen: row.origen,
				grado_contexto: grado,
				grupo_contexto: grupo,
			};
		});

		const conCorreo = enriquecidos.filter((r) => r.correo_electronico.trim() !== "");

		const filtrados =
			gradoF !== "" || grupoF !== ""
				? conCorreo.filter(
						(r) =>
							coincideFiltroGrado(gradoF, r.grado_contexto) &&
							coincideFiltroGrupo(grupoF, r.grupo_contexto),
					)
				: conCorreo;

		return NextResponse.json({ ok: true, registros: filtrados });
	} catch (e) {
		console.error("logs GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
