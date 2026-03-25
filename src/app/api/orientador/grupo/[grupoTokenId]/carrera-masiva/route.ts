import { NextResponse } from "next/server";
import { gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";
import {
	carreraExisteEnCatalogo,
	normalizarCarreraIdPayload,
} from "@/lib/padron/carrera-padron";
import { alumnoRequiereCarrera } from "@/lib/padron/requiere-carrera";
import { resolverGrupoSeccionPorId } from "@/lib/orientador/resolver-grupo-seccion";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

export async function POST(
	request: Request,
	ctx: { params: Promise<{ grupoTokenId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const { grupoTokenId } = await ctx.params;
	if (!grupoTokenId?.trim()) {
		return NextResponse.json({ error: "Grupo no válido" }, { status: 400 });
	}

	let cuerpo: { carreraId?: string | null; gradoMostradoFiltro?: string | null };
	try {
		cuerpo = (await request.json()) as {
			carreraId?: string | null;
			gradoMostradoFiltro?: string | null;
		};
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const norm = normalizarCarreraIdPayload(cuerpo.carreraId);
	if (!norm.ok) {
		return NextResponse.json({ error: norm.error }, { status: 400 });
	}

	const filtroGrado =
		typeof cuerpo.gradoMostradoFiltro === "string" && cuerpo.gradoMostradoFiltro.trim() !== ""
			? cuerpo.gradoMostradoFiltro.trim()
			: null;

	try {
		const supabase = obtenerClienteSupabaseAdmin();

		if (norm.valor != null && !(await carreraExisteEnCatalogo(supabase, norm.valor))) {
			return NextResponse.json({ error: "Carrera no válida" }, { status: 400 });
		}

		const resol = await resolverGrupoSeccionPorId(supabase, grupoTokenId);
		if (!resol.ok) {
			return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
		}
		const { resolucion } = resol;
		const gradoTok = String(resolucion.grado ?? "").trim() || "1";

		let qP = supabase.from("padron_alumnos").select("id, grado_alumno").is("archivo_muerto_en", null);
		if (resolucion.tipo === "solo_institucion") {
			qP = qP.eq("institucion_grupo_id", resolucion.institucionGrupoId);
		} else if (resolucion.institucionGrupoId) {
			qP = qP.or(
				`grupo_token_id.eq.${resolucion.grupoTokenId},institucion_grupo_id.eq.${resolucion.institucionGrupoId}`,
			);
		} else {
			qP = qP.eq("grupo_token_id", resolucion.grupoTokenId);
		}

		const { data: padrones, error: errP } = await qP;

		if (errP) {
			console.error("carrera masiva padron", errP);
			return NextResponse.json({ error: "No se pudo leer el padrón" }, { status: 500 });
		}

		const ids: string[] = [];
		for (const r of padrones ?? []) {
			const gm = gradoMostradoParaAlumno(r.grado_alumno, gradoTok);
			if (!alumnoRequiereCarrera(gm)) {
				continue;
			}
			if (filtroGrado !== null && gm !== filtroGrado) {
				continue;
			}
			ids.push(String(r.id));
		}

		if (ids.length === 0) {
			return NextResponse.json({
				ok: true,
				actualizados: 0,
				mensaje: "Ningún alumno en 2.° grado o superior coincide con el filtro.",
			});
		}

		const { error: errU } = await supabase
			.from("padron_alumnos")
			.update({ carrera_id: norm.valor })
			.in("id", ids);

		if (errU) {
			console.error("carrera masiva update", errU);
			return NextResponse.json({ error: "No se pudo actualizar la carrera" }, { status: 500 });
		}

		return NextResponse.json({
			ok: true,
			actualizados: ids.length,
		});
	} catch (e) {
		console.error("carrera masiva", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
