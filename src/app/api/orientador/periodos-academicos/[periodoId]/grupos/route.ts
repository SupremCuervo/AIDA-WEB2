import { NextResponse } from "next/server";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

export async function GET(
	_request: Request,
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
	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: periodo, error: errP } = await supabase
			.from("orientador_semestre_fechas")
			.select("id")
			.eq("id", periodoId)
			.maybeSingle();
		if (errP || !periodo) {
			return NextResponse.json({ error: "Periodo no encontrado" }, { status: 404 });
		}
		const { data: rels, error: errR } = await supabase
			.from("periodo_institucion_grupos")
			.select("institucion_grupo_id")
			.eq("periodo_id", periodoId);
		if (errR) {
			console.error("periodo grupos GET rel", errR);
			return NextResponse.json({ error: "No se pudieron leer los grupos" }, { status: 500 });
		}
		const ids = [...new Set((rels ?? []).map((r) => String(r.institucion_grupo_id)))];
		if (ids.length === 0) {
			return NextResponse.json({ grupos: [] });
		}
		const { data: secciones, error: errS } = await supabase
			.from("institucion_grupos")
			.select("id, grado, grupo")
			.in("id", ids);
		if (errS) {
			console.error("periodo grupos GET secciones", errS);
			return NextResponse.json({ error: "No se pudieron leer las secciones" }, { status: 500 });
		}
		const tokenPorIg = new Map<string, { id: string; clave_acceso: string }>();
		const { data: tokens, error: errT } = await supabase
			.from("grupo_tokens")
			.select("id, clave_acceso, institucion_grupo_id")
			.in("institucion_grupo_id", ids);
		if (!errT && tokens) {
			for (const t of tokens) {
				if (t.institucion_grupo_id) {
					tokenPorIg.set(String(t.institucion_grupo_id), {
						id: String(t.id),
						clave_acceso: String(t.clave_acceso ?? ""),
					});
				}
			}
		}
		const ordenados = (secciones ?? []).sort((a, b) => {
			const ga = Number.parseInt(String(a.grado), 10) || 0;
			const gb = Number.parseInt(String(b.grado), 10) || 0;
			if (ga !== gb) {
				return ga - gb;
			}
			return String(a.grupo).localeCompare(String(b.grupo), "es");
		});
		return NextResponse.json({
			grupos: ordenados.map((s) => {
				const tok = tokenPorIg.get(String(s.id));
				return {
					institucionGrupoId: s.id,
					grupoTokenId: tok?.id ?? null,
					grupo: s.grupo,
					grado: String(s.grado),
					claveAcceso: tok?.clave_acceso ?? "",
				};
			}),
		});
	} catch (e) {
		console.error("periodo grupos GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function POST(
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
	let body: { institucionGrupoId?: string; grupoTokenId?: string };
	try {
		body = (await request.json()) as { institucionGrupoId?: string; grupoTokenId?: string };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}
	const rawIg =
		typeof body.institucionGrupoId === "string" ? body.institucionGrupoId.trim() : "";
	const rawTok = typeof body.grupoTokenId === "string" ? body.grupoTokenId.trim() : "";
	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: periodo, error: errP } = await supabase
			.from("orientador_semestre_fechas")
			.select("id")
			.eq("id", periodoId)
			.maybeSingle();
		if (errP || !periodo) {
			return NextResponse.json({ error: "Periodo no encontrado" }, { status: 404 });
		}

		let igId = rawIg;
		if (!igId && rawTok) {
			const { data: gt, error: errG } = await supabase
				.from("grupo_tokens")
				.select("institucion_grupo_id")
				.eq("id", rawTok)
				.maybeSingle();
			if (errG || !gt?.institucion_grupo_id) {
				return NextResponse.json({ error: "Grupo (token) no encontrado o sin sección" }, { status: 404 });
			}
			igId = String(gt.institucion_grupo_id);
		}

		if (!igId) {
			return NextResponse.json({ error: "institucionGrupoId obligatorio" }, { status: 400 });
		}

		const { data: sec, error: errS } = await supabase
			.from("institucion_grupos")
			.select("id")
			.eq("id", igId)
			.maybeSingle();
		if (errS || !sec) {
			return NextResponse.json({ error: "Sección no encontrada" }, { status: 404 });
		}

		const { error: errI } = await supabase.from("periodo_institucion_grupos").insert({
			periodo_id: periodoId,
			institucion_grupo_id: igId,
		});
		if (errI) {
			if (String(errI.code) === "23505") {
				return NextResponse.json({ error: "Ese grupo ya está en el periodo" }, { status: 409 });
			}
			console.error("periodo grupos POST", errI);
			return NextResponse.json({ error: "No se pudo asignar el grupo" }, { status: 500 });
		}
		return NextResponse.json({ ok: true });
	} catch (e) {
		console.error("periodo grupos POST", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function DELETE(
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
	let body: { institucionGrupoId?: string; grupoTokenId?: string };
	try {
		body = (await request.json()) as { institucionGrupoId?: string; grupoTokenId?: string };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}
	const rawIg =
		typeof body.institucionGrupoId === "string" ? body.institucionGrupoId.trim() : "";
	const rawTok = typeof body.grupoTokenId === "string" ? body.grupoTokenId.trim() : "";
	try {
		const supabase = obtenerClienteSupabaseAdmin();

		let igId = rawIg;
		if (!igId && rawTok) {
			const { data: gt, error: errG } = await supabase
				.from("grupo_tokens")
				.select("institucion_grupo_id")
				.eq("id", rawTok)
				.maybeSingle();
			if (!errG && gt?.institucion_grupo_id) {
				igId = String(gt.institucion_grupo_id);
			}
		}

		if (!igId) {
			return NextResponse.json({ error: "institucionGrupoId obligatorio" }, { status: 400 });
		}

		const { error } = await supabase
			.from("periodo_institucion_grupos")
			.delete()
			.eq("periodo_id", periodoId)
			.eq("institucion_grupo_id", igId);
		if (error) {
			console.error("periodo grupos DELETE", error);
			return NextResponse.json({ error: "No se pudo quitar el grupo" }, { status: 500 });
		}
		return NextResponse.json({ ok: true });
	} catch (e) {
		console.error("periodo grupos DELETE", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
