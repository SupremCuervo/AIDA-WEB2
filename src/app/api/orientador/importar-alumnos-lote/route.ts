import { NextResponse } from "next/server";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { insertarPadronAlumnosIgnorarDuplicados } from "@/lib/orientador/insertar-padron-lote";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function limpiar(v: unknown): string {
	return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

function descomponerGradoGrupo(valor: string): { grado: string; grupo: string } | null {
	const limpio = valor.trim().replace(/\s+/g, "");
	if (!limpio) {
		return null;
	}
	const soloLetra = /^[a-zA-Z]$/u.exec(limpio);
	if (soloLetra) {
		return { grado: "1", grupo: soloLetra[0].toUpperCase() };
	}
	const m = /^(\d+)([a-zA-Z])$/u.exec(limpio);
	if (!m) {
		return null;
	}
	return {
		grado: m[1],
		grupo: m[2].toUpperCase(),
	};
}

export async function POST(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	try {
		const body = (await request.json()) as {
			filas?: Array<{ nombreCompleto?: string; grupo?: string }>;
		};
		const entrada = Array.isArray(body.filas) ? body.filas : [];

		const supabase = obtenerClienteSupabaseAdmin();
		const { data: grupos, error: errGrupos } = await supabase
			.from("grupo_tokens")
			.select("id, clave_acceso, grado, grupo, institucion_grupo_id");

		if (errGrupos || !grupos) {
			console.error("importar lote grupos", errGrupos);
			return NextResponse.json({ error: "No se pudieron cargar los grupos" }, { status: 500 });
		}

		const porClave = new Map<string, string>();
		const porGradoGrupo = new Map<string, string>();
		const tokenPorId = new Map<string, { institucion_grupo_id: string | null }>();
		for (const g of grupos) {
			porClave.set(String(g.clave_acceso).toLowerCase(), String(g.id));
			const llave = `${String(g.grado).toLowerCase()}|${String(g.grupo).toLowerCase()}`;
			porGradoGrupo.set(llave, String(g.id));
			tokenPorId.set(String(g.id), {
				institucion_grupo_id: (g.institucion_grupo_id as string | null) ?? null,
			});
		}

		const filasPreparadas: {
			grupo_token_id: string;
			institucion_grupo_id: string | null;
			nombre_completo: string;
		}[] = [];
		let omitidas = 0;
		let sinGrupo = 0;

		for (const f of entrada) {
			const nombre = limpiar(f.nombreCompleto);
			const grupoTxt = typeof f.grupo === "string" ? f.grupo.trim().replace(/\s+/g, "") : "";
			if (!nombre || !grupoTxt) {
				omitidas += 1;
				continue;
			}
			const duo = descomponerGradoGrupo(grupoTxt);
			if (!duo) {
				omitidas += 1;
				continue;
			}
			const llave = `${duo.grado.toLowerCase()}|${duo.grupo.toLowerCase()}`;
			const grupoTokenId = porGradoGrupo.get(llave) ?? null;
			if (!grupoTokenId) {
				sinGrupo += 1;
				continue;
			}
			const meta = tokenPorId.get(grupoTokenId);
			filasPreparadas.push({
				grupo_token_id: grupoTokenId,
				institucion_grupo_id: meta?.institucion_grupo_id ?? null,
				nombre_completo: nombre,
			});
		}

		if (filasPreparadas.length === 0) {
			return NextResponse.json(
				{
					error:
						"No hay filas válidas. Usa nombre y grupo (solo letra, ej. G; grado 1 en sistema) que exista en tokens.",
				},
				{ status: 400 },
			);
		}

		const unicas = new Map<
			string,
			{ grupo_token_id: string; institucion_grupo_id: string | null; nombre_completo: string }
		>();
		for (const row of filasPreparadas) {
			const key = `${row.grupo_token_id}|${row.nombre_completo.toLowerCase()}`;
			if (!unicas.has(key)) {
				unicas.set(key, row);
			}
		}
		const filasFinales = [...unicas.values()];

		const { error: errInsert } = await insertarPadronAlumnosIgnorarDuplicados(supabase, filasFinales);

		if (errInsert) {
			console.error("importar lote padron", errInsert);
			return NextResponse.json({ error: "No se pudo guardar el padrón" }, { status: 500 });
		}

		return NextResponse.json({
			ok: true,
			resumen: {
				recibidas: entrada.length,
				guardadas: filasFinales.length,
				omitidas,
				sinGrupoCoincidente: sinGrupo,
			},
		});
	} catch (e) {
		console.error("importar lote", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
