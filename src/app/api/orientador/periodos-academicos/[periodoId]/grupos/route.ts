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
		const { data: secciones, error: errS } = await supabase
			.from("institucion_grupos")
			.select("id, grado, grupo")
			.order("grado", { ascending: true })
			.order("grupo", { ascending: true });
		if (errS) {
			console.error("periodo grupos GET secciones", errS);
			return NextResponse.json({ error: "No se pudieron leer las secciones" }, { status: 500 });
		}
		const ids = [...new Set((secciones ?? []).map((r) => String(r.id)))];
		if (ids.length === 0) {
			return NextResponse.json({ grupos: [] });
		}
		const totalPadronPorIg = new Map<string, number>();
		const { data: padronRows, error: errPad } = await supabase
			.from("padron_alumnos")
			.select("institucion_grupo_id")
			.in("institucion_grupo_id", ids)
			.is("archivo_muerto_en", null);
		if (errPad) {
			console.error("periodo grupos GET padron", errPad);
			return NextResponse.json({ error: "No se pudieron validar los grupos activos" }, { status: 500 });
		}
		for (const row of padronRows ?? []) {
			const ig = row.institucion_grupo_id ? String(row.institucion_grupo_id) : "";
			if (!ig) {
				continue;
			}
			totalPadronPorIg.set(ig, (totalPadronPorIg.get(ig) ?? 0) + 1);
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
		const ordenados = (secciones ?? []).filter((s) => {
			const ig = String(s.id);
			const conAlumnos = (totalPadronPorIg.get(ig) ?? 0) > 0;
			const tieneToken = tokenPorIg.has(ig);
			return conAlumnos || tieneToken;
		}).sort((a, b) => {
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
	_request: Request,
	_ctx: { params: Promise<{ periodoId: string }> },
) {
	return NextResponse.json(
		{ error: "La asignación manual de grupos por ciclo fue eliminada; ahora aplica globalmente." },
		{ status: 410 },
	);
}

export async function DELETE(
	_request: Request,
	_ctx: { params: Promise<{ periodoId: string }> },
) {
	return NextResponse.json(
		{ error: "La asignación manual de grupos por ciclo fue eliminada; ahora aplica globalmente." },
		{ status: 410 },
	);
}
