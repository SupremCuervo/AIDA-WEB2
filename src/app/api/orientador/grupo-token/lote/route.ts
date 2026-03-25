import { NextResponse } from "next/server";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function limpiar(v: unknown): string {
	return typeof v === "string" ? v.trim() : "";
}

function descomponerGrupo(valor: string): { grado: string; grupo: string } | null {
	const limpio = valor.trim().replace(/\s+/g, "");
	const soloLetra = /^[a-zA-Z]$/u.exec(limpio);
	if (soloLetra) {
		return { grado: "1", grupo: soloLetra[0].toUpperCase() };
	}
	return null;
}

export async function POST(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	try {
		const body = (await request.json()) as {
			filas?: Array<{ grupo?: string; token?: string }>;
		};
		const entrada = Array.isArray(body.filas) ? body.filas : [];
		const preparadas: { grado: string; grupo: string; clave_acceso: string }[] = [];
		let omitidas = 0;

		for (const f of entrada) {
			const gTxt = limpiar(f.grupo);
			const tok = limpiar(f.token).toUpperCase();
			if (!gTxt || !tok) {
				omitidas += 1;
				continue;
			}
			const gg = descomponerGrupo(gTxt);
			if (!gg) {
				omitidas += 1;
				continue;
			}
			preparadas.push({
				grado: gg.grado,
				grupo: gg.grupo,
				clave_acceso: tok,
			});
		}

		if (preparadas.length === 0) {
			return NextResponse.json(
				{
					error:
						"No hay filas válidas. Cada fila necesita grupo (solo letra de 1.°, ej. G) y token.",
				},
				{ status: 400 },
			);
		}

		const supabase = obtenerClienteSupabaseAdmin();
		const { error } = await supabase.from("grupo_tokens").upsert(preparadas, {
			onConflict: "clave_acceso",
		});
		if (error) {
			console.error("grupo-token lote", error);
			return NextResponse.json({ error: "No se pudieron guardar los tokens" }, { status: 500 });
		}

		return NextResponse.json({
			ok: true,
			guardadas: preparadas.length,
			omitidas,
		});
	} catch (e) {
		console.error("grupo-token lote", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
