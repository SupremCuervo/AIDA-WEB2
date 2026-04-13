import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { verificarTokenAlumno, COOKIE_ALUMNO } from "@/lib/alumno/jwt-cookies";
import {
	jsonAlumnoGrupoVencidoCierraSesion,
	padronPerteneceAGrupoVencido,
} from "@/lib/alumno/requiere-grupo-vigente";
import { jsonAlumnoArchivoMuertoCierraSesion, padronEstaArchivado } from "@/lib/padron/archivo-muerto";
import { gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";
import {
	carreraExisteEnCatalogo,
	normalizarCarreraIdPayload,
} from "@/lib/padron/carrera-padron";
import { alumnoRequiereCarrera } from "@/lib/padron/requiere-carrera";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function PATCH(request: Request) {
	const jar = await cookies();
	const token = jar.get(COOKIE_ALUMNO)?.value;
	if (!token) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	let cuerpo: { carreraId?: string | null };
	try {
		cuerpo = (await request.json()) as { carreraId?: string | null };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	if (!Object.prototype.hasOwnProperty.call(cuerpo, "carreraId")) {
		return NextResponse.json({ error: "Indica carreraId (UUID o null)" }, { status: 400 });
	}

	const norm = normalizarCarreraIdPayload(cuerpo.carreraId);
	if (!norm.ok) {
		return NextResponse.json({ error: norm.error }, { status: 400 });
	}

	try {
		const p = await verificarTokenAlumno(token);
		const supabase = obtenerClienteSupabaseAdmin();
		if (await padronPerteneceAGrupoVencido(supabase, p.padronId)) {
			return jsonAlumnoGrupoVencidoCierraSesion();
		}
		if (await padronEstaArchivado(supabase, p.padronId)) {
			return jsonAlumnoArchivoMuertoCierraSesion();
		}

		const { data: padGrado, error: errPad } = await supabase
			.from("padron_alumnos")
			.select("grado_alumno, grupo_token_id, institucion_grupo_id")
			.eq("id", p.padronId)
			.maybeSingle();

		if (errPad || !padGrado) {
			return NextResponse.json({ error: "Registro no encontrado" }, { status: 404 });
		}

		let gradoToken = p.grado;
		if (padGrado.grupo_token_id) {
			const { data: tok, error: errTok } = await supabase
				.from("grupo_tokens")
				.select("grado")
				.eq("id", padGrado.grupo_token_id)
				.maybeSingle();
			if (!errTok && tok?.grado != null && String(tok.grado).trim() !== "") {
				gradoToken = String(tok.grado).trim();
			}
		} else if (padGrado.institucion_grupo_id) {
			const { data: ig, error: errIg } = await supabase
				.from("institucion_grupos")
				.select("grado")
				.eq("id", padGrado.institucion_grupo_id)
				.maybeSingle();
			if (!errIg && ig?.grado != null && String(ig.grado).trim() !== "") {
				gradoToken = String(ig.grado).trim();
			}
		}

		const gradoMostrado = gradoMostradoParaAlumno(padGrado.grado_alumno, gradoToken);
		const requiere = alumnoRequiereCarrera(gradoMostrado);

		if (!requiere && norm.valor != null) {
			return NextResponse.json(
				{ error: "En 1.° grado no aplica carrera; solo a partir de 2.°" },
				{ status: 400 },
			);
		}

		if (norm.valor != null && !(await carreraExisteEnCatalogo(supabase, norm.valor))) {
			return NextResponse.json({ error: "Carrera no válida" }, { status: 400 });
		}

		const { error: errU } = await supabase
			.from("padron_alumnos")
			.update({ carrera_id: norm.valor })
			.eq("id", p.padronId);

		if (errU) {
			console.error("alumno carrera PATCH", errU);
			return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
		}

		return NextResponse.json({ ok: true, carreraId: norm.valor });
	} catch {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
}
