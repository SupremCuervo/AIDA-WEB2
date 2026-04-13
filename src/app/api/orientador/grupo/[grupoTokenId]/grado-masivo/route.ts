import { NextResponse } from "next/server";
import { GRADO_ESCOLAR_MAX } from "@/lib/padron/grado-alumno";
import { aplicarGradoMasivoInterno } from "@/lib/orientador/aplicar-grado-masivo-interno";
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

	let cuerpo: { grado?: string };
	try {
		cuerpo = (await request.json()) as { grado?: string };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const raw = typeof cuerpo.grado === "string" ? cuerpo.grado.trim() : "";
	if (!/^\d+$/.test(raw)) {
		return NextResponse.json(
			{ error: `Indica un grado numérico entre 1 y ${GRADO_ESCOLAR_MAX}` },
			{ status: 400 },
		);
	}
	const n = Number.parseInt(raw, 10);
	if (n < 1 || n > GRADO_ESCOLAR_MAX) {
		return NextResponse.json(
			{ error: `El grado debe estar entre 1 y ${GRADO_ESCOLAR_MAX}` },
			{ status: 400 },
		);
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const r = await aplicarGradoMasivoInterno(supabase, grupoTokenId, n, {
			incluirPadronSoloPrimeroSinToken: true,
		});
		if (!r.ok) {
			const status =
				r.error === "Grupo no encontrado"
					? 404
					: r.error.includes("eliminar la fila de grupo_tokens")
						? 500
						: r.error.includes("catálogo") || r.error.includes("1.°")
							? 500
							: r.error.includes("letra")
								? 400
								: 500;
			return NextResponse.json({ error: r.error }, { status });
		}
		return NextResponse.json({
			ok: true,
			grado: r.grado,
			actualizados: r.actualizados,
			tokenEliminado: r.tokenEliminado,
			institucionGrupoId: r.institucionGrupoId,
		});
	} catch (e) {
		console.error("grado masivo", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
