import { NextResponse } from "next/server";
import { gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

export async function GET(
	request: Request,
	ctx: { params: Promise<{ periodoId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	const { periodoId } = await ctx.params;
	if (!periodoId?.trim()) {
		return NextResponse.json({ error: "Periodo no válido" }, { status: 400 });
	}
	const url = new URL(request.url);
	const institucionGrupoIdParam = url.searchParams.get("institucionGrupoId")?.trim() ?? "";
	const grupoTokenIdParam = url.searchParams.get("grupoTokenId")?.trim() ?? "";
	if (!institucionGrupoIdParam && !grupoTokenIdParam) {
		return NextResponse.json(
			{ error: "indica institucionGrupoId o grupoTokenId en la query" },
			{ status: 400 },
		);
	}
	try {
		const supabase = obtenerClienteSupabaseAdmin();

		let igId = institucionGrupoIdParam;
		if (!igId && grupoTokenIdParam) {
			const { data: gt, error: errG } = await supabase
				.from("grupo_tokens")
				.select("institucion_grupo_id")
				.eq("id", grupoTokenIdParam)
				.maybeSingle();
			if (errG || !gt?.institucion_grupo_id) {
				return NextResponse.json({ error: "Grupo (token) no encontrado" }, { status: 404 });
			}
			igId = String(gt.institucion_grupo_id);
		}

		const { data: asignado, error: errA } = await supabase
			.from("periodo_institucion_grupos")
			.select("institucion_grupo_id")
			.eq("periodo_id", periodoId)
			.eq("institucion_grupo_id", igId)
			.maybeSingle();
		if (errA || !asignado) {
			return NextResponse.json(
				{ error: "Este grupo no está asignado a ese periodo" },
				{ status: 403 },
			);
		}

		const { data: igRow, error: errIg } = await supabase
			.from("institucion_grupos")
			.select("grado")
			.eq("id", igId)
			.maybeSingle();
		const gradoTok = errIg || !igRow ? "1" : String(igRow.grado ?? "").trim() || "1";

		const { data: padrones, error: errP } = await supabase
			.from("padron_alumnos")
			.select(`
				id,
				nombre_completo,
				grado_alumno,
				cuentas_alumno ( id )
			`)
			.eq("institucion_grupo_id", igId)
			.is("archivo_muerto_en", null);
		if (errP) {
			console.error("periodo alumnos padron", errP);
			return NextResponse.json({ error: "No se pudo leer el padrón" }, { status: 500 });
		}
		type Fila = {
			id: string;
			nombre_completo: string;
			grado_alumno: string | null;
			cuentas_alumno: { id: string }[] | { id: string } | null;
		};
		const filas = (padrones ?? []) as Fila[];
		const alumnos = filas.map((p) => {
			const c = p.cuentas_alumno;
			let cuentaId: string | null = null;
			if (Array.isArray(c) && c[0]?.id) {
				cuentaId = c[0].id;
			} else if (c && typeof c === "object" && "id" in c) {
				cuentaId = (c as { id: string }).id;
			}
			return {
				padronId: p.id,
				nombreCompleto: p.nombre_completo,
				gradoMostrado: gradoMostradoParaAlumno(p.grado_alumno, gradoTok),
				cuentaId,
			};
		});
		alumnos.sort((a, b) => a.nombreCompleto.localeCompare(b.nombreCompleto, "es"));
		return NextResponse.json({ alumnos });
	} catch (e) {
		console.error("periodo alumnos GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
