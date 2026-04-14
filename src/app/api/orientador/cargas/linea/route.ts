import { NextResponse } from "next/server";
import {
	institucionGrupoIdPorGradoLetra,
	normalizarLetraGrupo,
} from "@/lib/orientador/cargas-helpers";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";

const PREFIJO_PADRON_VIRTUAL = "padron:";

function padronIdDesdeLineaVirtual(lineaId: string): string | null {
	const t = lineaId.trim();
	if (!t.startsWith(PREFIJO_PADRON_VIRTUAL)) {
		return null;
	}
	const id = t.slice(PREFIJO_PADRON_VIRTUAL.length).trim();
	return id || null;
}

async function cargaDeOrientador(
	supabase: SupabaseClient,
	cargaId: string,
	orientadorId: string,
): Promise<{ ok: true; gradoCarga: number; gruposLetras: string[] } | { ok: false }> {
	const { data: carga, error } = await supabase
		.from("cargas_alumnos")
		.select("orientador_id, grupos_letras, grado_carga")
		.eq("id", cargaId)
		.maybeSingle();
	if (error || !carga || (carga.orientador_id as string) !== orientadorId) {
		return { ok: false };
	}
	return {
		ok: true,
		gradoCarga: Number(carga.grado_carga),
		gruposLetras: ((carga.grupos_letras as string[]) ?? []).map((x) => normalizarLetraGrupo(String(x))),
	};
}

/** Padrón en sección de la carga (grado + letra permitidos) y sin fila en esa carga. */
async function validarPadronSoloVistaCarga(
	supabase: SupabaseClient,
	padronId: string,
	cargaId: string,
	gradoCarga: number,
	letrasPermitidas: string[],
): Promise<{ ok: true } | { ok: false; motivo: string }> {
	const { data: lineaMismaCarga } = await supabase
		.from("carga_alumnos_linea")
		.select("id")
		.eq("carga_id", cargaId)
		.eq("padron_id", padronId)
		.maybeSingle();
	if (lineaMismaCarga) {
		return { ok: false, motivo: "Este alumno ya tiene fila en esta carga; recarga la página." };
	}
	const { data: p, error: errP } = await supabase
		.from("padron_alumnos")
		.select("institucion_grupo_id")
		.eq("id", padronId)
		.maybeSingle();
	if (errP || !p?.institucion_grupo_id) {
		return { ok: false, motivo: "Alumno no encontrado en el padrón." };
	}
	const { data: ig, error: errI } = await supabase
		.from("institucion_grupos")
		.select("grado, grupo")
		.eq("id", p.institucion_grupo_id as string)
		.maybeSingle();
	if (errI || !ig) {
		return { ok: false, motivo: "Sección del alumno no encontrada." };
	}
	const g = Number(ig.grado);
	const letra = normalizarLetraGrupo(String(ig.grupo ?? ""));
	if (g !== gradoCarga || !letrasPermitidas.includes(letra)) {
		return { ok: false, motivo: "El alumno no pertenece a los grupos de esta carga." };
	}
	return { ok: true };
}

async function lineaPerteneceAOrientador(
	supabase: ReturnType<typeof obtenerClienteSupabaseAdmin>,
	lineaId: string,
	orientadorId: string,
): Promise<{
	ok: true;
	linea: { id: string; carga_id: string; padron_id: string; grupo_letra: string };
	carga: { grupos_letras: string[]; grado_carga: number };
} | { ok: false }> {
	const { data: linea, error } = await supabase
		.from("carga_alumnos_linea")
		.select("id, carga_id, padron_id, grupo_letra")
		.eq("id", lineaId)
		.maybeSingle();
	if (error || !linea) {
		return { ok: false };
	}
	const { data: carga, error: errC } = await supabase
		.from("cargas_alumnos")
		.select("orientador_id, grupos_letras, grado_carga")
		.eq("id", linea.carga_id as string)
		.maybeSingle();
	if (errC || !carga || (carga.orientador_id as string) !== orientadorId) {
		return { ok: false };
	}
	return {
		ok: true,
		linea: {
			id: linea.id as string,
			carga_id: linea.carga_id as string,
			padron_id: linea.padron_id as string,
			grupo_letra: linea.grupo_letra as string,
		},
		carga: {
			grupos_letras: (carga.grupos_letras as string[]) ?? [],
			grado_carga: Number(carga.grado_carga),
		},
	};
}

export async function PATCH(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	let body: { lineaId?: unknown; nuevoGrupoLetra?: unknown; cargaId?: unknown };
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}
	const lineaId = typeof body.lineaId === "string" ? body.lineaId.trim() : "";
	const nuevoG = normalizarLetraGrupo(
		typeof body.nuevoGrupoLetra === "string" ? body.nuevoGrupoLetra : "",
	);
	if (!lineaId || !nuevoG) {
		return NextResponse.json({ error: "lineaId y nuevoGrupoLetra obligatorios" }, { status: 400 });
	}

	const supabase = obtenerClienteSupabaseAdmin();
	const padronVirtual = padronIdDesdeLineaVirtual(lineaId);

	if (padronVirtual) {
		const cargaId = typeof body.cargaId === "string" ? body.cargaId.trim() : "";
		if (!cargaId) {
			return NextResponse.json(
				{ error: "Para alumnos agregados solo por expediente, envía también cargaId (carga que estás viendo)." },
				{ status: 400 },
			);
		}
		const carga = await cargaDeOrientador(supabase, cargaId, orientador.orientadorId);
		if (!carga.ok) {
			return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
		}
		const letras = carga.gruposLetras;
		if (!letras.includes(nuevoG)) {
			return NextResponse.json(
				{ error: "El nuevo grupo debe ser uno de los grupos de esa carga." },
				{ status: 400 },
			);
		}
		const val = await validarPadronSoloVistaCarga(
			supabase,
			padronVirtual,
			cargaId,
			carga.gradoCarga,
			letras,
		);
		if (!val.ok) {
			return NextResponse.json({ error: val.motivo }, { status: 400 });
		}
		const igId = await institucionGrupoIdPorGradoLetra(supabase, carga.gradoCarga, nuevoG);
		if (!igId) {
			return NextResponse.json({ error: "Sección de destino no existe en el catálogo." }, { status: 400 });
		}
		const { data: tokDest } = await supabase
			.from("grupo_tokens")
			.select("id")
			.eq("institucion_grupo_id", igId)
			.maybeSingle();
		const nuevoTokenId = (tokDest?.id as string | undefined) ?? null;
		const { error: errP } = await supabase
			.from("padron_alumnos")
			.update({ institucion_grupo_id: igId, grupo_token_id: nuevoTokenId })
			.eq("id", padronVirtual);
		if (errP) {
			if (errP.code === "23505") {
				return NextResponse.json(
					{ error: "Ya existe otro alumno con el mismo nombre en el grupo destino." },
					{ status: 409 },
				);
			}
			console.error("cargas linea PATCH padron virtual", errP);
			return NextResponse.json({ error: "No se pudo actualizar el padrón" }, { status: 500 });
		}
		return NextResponse.json({ ok: true });
	}

	const res = await lineaPerteneceAOrientador(supabase, lineaId, orientador.orientadorId);
	if (!res.ok) {
		return NextResponse.json({ error: "Línea no encontrada" }, { status: 404 });
	}

	const letras = res.carga.grupos_letras.map((x) => normalizarLetraGrupo(String(x)));
	if (!letras.includes(nuevoG)) {
		return NextResponse.json(
			{ error: "El nuevo grupo debe ser uno de los grupos de esa carga." },
			{ status: 400 },
		);
	}

	const igId = await institucionGrupoIdPorGradoLetra(supabase, res.carga.grado_carga, nuevoG);
	if (!igId) {
		return NextResponse.json({ error: "Sección de destino no existe en el catálogo." }, { status: 400 });
	}

	const { data: tokDest } = await supabase
		.from("grupo_tokens")
		.select("id")
		.eq("institucion_grupo_id", igId)
		.maybeSingle();
	const nuevoTokenId = (tokDest?.id as string | undefined) ?? null;

	const { error: errP } = await supabase
		.from("padron_alumnos")
		.update({ institucion_grupo_id: igId, grupo_token_id: nuevoTokenId })
		.eq("id", res.linea.padron_id);

	if (errP) {
		if (errP.code === "23505") {
			return NextResponse.json(
				{ error: "Ya existe otro alumno con el mismo nombre en el grupo destino." },
				{ status: 409 },
			);
		}
		console.error("cargas linea PATCH padron", errP);
		return NextResponse.json({ error: "No se pudo actualizar el padrón" }, { status: 500 });
	}

	const { error: errL } = await supabase
		.from("carga_alumnos_linea")
		.update({ grupo_letra: nuevoG })
		.eq("id", lineaId);

	if (errL) {
		console.error("cargas linea PATCH linea", errL);
		return NextResponse.json({ error: "No se pudo actualizar la línea" }, { status: 500 });
	}

	return NextResponse.json({ ok: true });
}

export async function DELETE(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	const url = new URL(request.url);
	const lineaId = url.searchParams.get("lineaId")?.trim() ?? "";
	const cargaIdParam = url.searchParams.get("cargaId")?.trim() ?? "";
	if (!lineaId) {
		return NextResponse.json({ error: "lineaId obligatorio" }, { status: 400 });
	}

	const supabase = obtenerClienteSupabaseAdmin();
	const padronVirtual = padronIdDesdeLineaVirtual(lineaId);

	if (padronVirtual) {
		if (!cargaIdParam) {
			return NextResponse.json(
				{
					error:
						"Para alumnos agregados solo por expediente, añade cargaId en la URL (la carga que estás viendo).",
				},
				{ status: 400 },
			);
		}
		const carga = await cargaDeOrientador(supabase, cargaIdParam, orientador.orientadorId);
		if (!carga.ok) {
			return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
		}
		const val = await validarPadronSoloVistaCarga(
			supabase,
			padronVirtual,
			cargaIdParam,
			carga.gradoCarga,
			carga.gruposLetras,
		);
		if (!val.ok) {
			return NextResponse.json({ error: val.motivo }, { status: 400 });
		}
		const { count } = await supabase
			.from("cuentas_alumno")
			.select("id", { count: "exact", head: true })
			.eq("padron_id", padronVirtual);
		if (count && count > 0) {
			return NextResponse.json(
				{
					error:
						"No se puede quitar del padrón: el alumno ya tiene cuenta de acceso. Gestiona su baja desde expedientes si aplica.",
				},
				{ status: 409 },
			);
		}
		const { error: errDel } = await supabase.from("padron_alumnos").delete().eq("id", padronVirtual);
		if (errDel) {
			console.error("cargas linea DELETE padron virtual", errDel);
			return NextResponse.json({ error: "No se pudo eliminar del padrón" }, { status: 500 });
		}
		return NextResponse.json({ ok: true });
	}

	const res = await lineaPerteneceAOrientador(supabase, lineaId, orientador.orientadorId);
	if (!res.ok) {
		return NextResponse.json({ error: "Línea no encontrada" }, { status: 404 });
	}

	const { error: errD } = await supabase.from("carga_alumnos_linea").delete().eq("id", lineaId);
	if (errD) {
		console.error("cargas linea DELETE", errD);
		return NextResponse.json({ error: "No se pudo eliminar" }, { status: 500 });
	}

	const { count } = await supabase
		.from("cuentas_alumno")
		.select("id", { count: "exact", head: true })
		.eq("padron_id", res.linea.padron_id);

	if (!count || count === 0) {
		await supabase.from("padron_alumnos").delete().eq("id", res.linea.padron_id);
	}

	return NextResponse.json({ ok: true });
}
