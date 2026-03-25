import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { GRADO_ESCOLAR_MAX } from "@/lib/padron/grado-alumno";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

/**
 * Fila en institucion_grupos para (grado, letra). Crea la sección si no existe.
 * Devuelve null si falla (el token puede actualizarse solo con grado).
 */
async function obtenerOCrearInstitucionGrupoId(
	supabase: SupabaseClient,
	grado: number,
	grupoLetra: string,
): Promise<string | null> {
	const letra = grupoLetra.toUpperCase().trim();
	if (!letra || letra.length !== 1 || !/^[A-Z]$/u.test(letra)) {
		return null;
	}
	const { data: ex, error: errQ } = await supabase
		.from("institucion_grupos")
		.select("id")
		.eq("grado", grado)
		.eq("grupo", letra)
		.maybeSingle();
	if (errQ) {
		console.error("obtenerOCrearInstitucionGrupoId select", errQ);
		return null;
	}
	if (ex?.id) {
		return ex.id as string;
	}
	const { data: ins, error: errI } = await supabase
		.from("institucion_grupos")
		.insert({ grado, grupo: letra })
		.select("id")
		.single();
	if (errI || !ins) {
		console.error("obtenerOCrearInstitucionGrupoId insert", errI);
		return null;
	}
	return ins.id as string;
}

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
	const gradoStr = String(n);

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: tok, error: errG } = await supabase
			.from("grupo_tokens")
			.select("id, grupo, institucion_grupo_id")
			.eq("id", grupoTokenId)
			.maybeSingle();

		if (errG || !tok) {
			return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
		}

		const letraGrupo = String(tok.grupo ?? "").trim().toUpperCase();
		if (!/^[A-Z]$/u.test(letraGrupo)) {
			return NextResponse.json(
				{ error: "La letra del grupo del token no es válida para enlazar el grado." },
				{ status: 400 },
			);
		}

		const igDestino = await obtenerOCrearInstitucionGrupoId(supabase, n, letraGrupo);
		if (!igDestino) {
			return NextResponse.json(
				{ error: "No se pudo crear o localizar la sección en el catálogo (institucion_grupos)." },
				{ status: 500 },
			);
		}

		const igPrimero = await obtenerOCrearInstitucionGrupoId(supabase, 1, letraGrupo);
		if (!igPrimero) {
			return NextResponse.json(
				{ error: "No se pudo resolver la sección de 1.° en el catálogo." },
				{ status: 500 },
			);
		}

		const esPrimero = n === 1;
		const actualizacionPadron = esPrimero
			? {
					grado_alumno: gradoStr,
					carrera_id: null as string | null,
					matricula: null as string | null,
					institucion_grupo_id: igDestino,
					grupo_token_id: grupoTokenId,
				}
			: {
					grado_alumno: gradoStr,
					institucion_grupo_id: igDestino,
					grupo_token_id: null as string | null,
				};

		const { data: actualizadosConToken, error: errU } = await supabase
			.from("padron_alumnos")
			.update(actualizacionPadron)
			.eq("grupo_token_id", grupoTokenId)
			.is("archivo_muerto_en", null)
			.select("id");

		if (errU) {
			console.error("grado masivo padron", errU);
			return NextResponse.json({ error: "No se pudo actualizar el grado" }, { status: 500 });
		}

		const { data: actualizadosSoloIg, error: errU2 } = await supabase
			.from("padron_alumnos")
			.update(actualizacionPadron)
			.eq("institucion_grupo_id", igPrimero)
			.is("grupo_token_id", null)
			.is("archivo_muerto_en", null)
			.select("id");

		if (errU2) {
			console.error("grado masivo padron solo_ig", errU2);
			return NextResponse.json({ error: "No se pudo actualizar el grado (padrón sin token)" }, { status: 500 });
		}

		const actualizados = [...(actualizadosConToken ?? []), ...(actualizadosSoloIg ?? [])];

		if (!esPrimero) {
			let igOrigenPeriodo: string | null = (tok.institucion_grupo_id as string | null) ?? null;
			if (!igOrigenPeriodo) {
				igOrigenPeriodo = igPrimero;
			}
			if (igOrigenPeriodo && igOrigenPeriodo !== igDestino) {
				const { data: periodosRel } = await supabase
					.from("periodo_institucion_grupos")
					.select("periodo_id")
					.eq("institucion_grupo_id", igOrigenPeriodo);
				for (const pr of periodosRel ?? []) {
					const { error: errP } = await supabase.from("periodo_institucion_grupos").upsert(
						{
							periodo_id: pr.periodo_id as string,
							institucion_grupo_id: igDestino,
						},
						{ onConflict: "periodo_id,institucion_grupo_id" },
					);
					if (errP) {
						console.error("grado masivo periodo_institucion_grupos", errP);
					}
				}
			}

			const { error: errDel } = await supabase.from("grupo_tokens").delete().eq("id", grupoTokenId);
			if (errDel) {
				console.error("grado masivo delete grupo_tokens", errDel);
				return NextResponse.json(
					{
						error:
							"Se actualizó el padrón, pero no se pudo eliminar la fila de grupo_tokens (revisa permisos o dependencias).",
					},
					{ status: 500 },
				);
			}

			return NextResponse.json({
				ok: true,
				grado: gradoStr,
				actualizados: actualizados?.length ?? 0,
				tokenEliminado: true,
				institucionGrupoId: igDestino,
			});
		}

		let errTokUp = (
			await supabase
				.from("grupo_tokens")
				.update({
					grado: gradoStr,
					institucion_grupo_id: igDestino,
				})
				.eq("id", grupoTokenId)
		).error;

		if (errTokUp) {
			const msg = (errTokUp.message ?? "").toLowerCase();
			if (msg.includes("unique") || msg.includes("duplicate")) {
				errTokUp = (
					await supabase
						.from("grupo_tokens")
						.update({ grado: gradoStr, institucion_grupo_id: null })
						.eq("id", grupoTokenId)
				).error;
			}
		}

		if (errTokUp) {
			console.error("grado masivo grupo_tokens", errTokUp);
			return NextResponse.json(
				{ error: "Se actualizó el padrón, pero no el enlace del grupo. Revisa en Tokens de grupo." },
				{ status: 500 },
			);
		}

		return NextResponse.json({
			ok: true,
			grado: gradoStr,
			actualizados: actualizados?.length ?? 0,
			tokenEliminado: false,
			institucionGrupoId: igDestino,
		});
	} catch (e) {
		console.error("grado masivo", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
