import { NextResponse } from "next/server";
import type { SupabaseClient } from "@supabase/supabase-js";
import { registrarLogApi } from "@/lib/orientador/audit-registrar";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function limpiar(v: unknown): string {
	return typeof v === "string" ? v.trim() : "";
}

const MSG_TOKEN_SOLO_PRIMERO =
	"Solo 1.° grado puede tener token de acceso; en 2.°–6.° no aplica token.";

function gradoNumericoToken(grado: string): number {
	return Number.parseInt(String(grado ?? "").trim(), 10);
}

function descomponerGrupo(valor: string): { grado: string; grupo: string } | null {
	const limpio = valor.trim().replace(/\s+/g, "");
	const soloLetra = /^[a-zA-Z]$/u.exec(limpio);
	if (soloLetra) {
		return { grado: "1", grupo: soloLetra[0].toUpperCase() };
	}
	const gradoYLetra = /^(\d+)([a-zA-Z])$/u.exec(limpio);
	if (!gradoYLetra) {
		return null;
	}
	const num = Number.parseInt(gradoYLetra[1], 10);
	if (Number.isNaN(num) || num < 1 || num > 6) {
		return null;
	}
	return { grado: String(num), grupo: gradoYLetra[2].toUpperCase() };
}

async function asegurarInstitucionGrupo(
	supabase: SupabaseClient,
	grado: string,
	grupo: string,
): Promise<{ id: string | null; error?: string }> {
	const gNum = Number.parseInt(grado, 10);
	if (Number.isNaN(gNum) || gNum < 1 || gNum > 6) {
		return { id: null, error: "El grado debe estar entre 1 y 6" };
	}
	const gLetra = grupo.toUpperCase().trim();
	if (!gLetra || gLetra.length !== 1 || !/^[A-Z]$/u.test(gLetra)) {
		return { id: null, error: "La letra de grupo debe ser una sola letra (A–Z)" };
	}
	const { data: ex, error: errQ } = await supabase
		.from("institucion_grupos")
		.select("id")
		.eq("grado", gNum)
		.eq("grupo", gLetra)
		.maybeSingle();
	if (errQ) {
		console.error("asegurarInstitucionGrupo select", errQ);
		return { id: null, error: "No se pudo consultar el catálogo de secciones" };
	}
	if (ex?.id) {
		return { id: ex.id };
	}
	const { data: ins, error: errI } = await supabase
		.from("institucion_grupos")
		.insert({ grado: gNum, grupo: gLetra })
		.select("id")
		.single();
	if (errI || !ins) {
		console.error("asegurarInstitucionGrupo insert", errI);
		return { id: null, error: "No se pudo registrar la sección" };
	}
	return { id: ins.id as string };
}

export async function POST(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	try {
		const body = (await request.json()) as {
			grado?: string;
			grupo?: string;
			grupoTexto?: string;
			claveAcceso?: string;
			institucionGrupoId?: string;
		};
		const fromTexto = body.grupoTexto ? descomponerGrupo(body.grupoTexto) : null;
		let grado = limpiar(body.grado) || fromTexto?.grado || "";
		let grupo = (limpiar(body.grupo).toUpperCase() || fromTexto?.grupo || "").toUpperCase();
		const institucionGrupoIdBody = limpiar(body.institucionGrupoId);

		const supabase = obtenerClienteSupabaseAdmin();

		if (institucionGrupoIdBody) {
			const { data: sec, error: errSec } = await supabase
				.from("institucion_grupos")
				.select("id, grado, grupo")
				.eq("id", institucionGrupoIdBody)
				.maybeSingle();
			if (errSec || !sec) {
				return NextResponse.json({ error: "Sección no encontrada" }, { status: 400 });
			}
			grado = String(sec.grado);
			grupo = String(sec.grupo).toUpperCase();
		}

		if (!grado || !grupo) {
			return NextResponse.json(
				{ error: "Grupo inválido. En 1.° usa solo la letra del grupo (A, B, C…)." },
				{ status: 400 },
			);
		}

		if (gradoNumericoToken(grado) !== 1) {
			return NextResponse.json({ error: MSG_TOKEN_SOLO_PRIMERO }, { status: 400 });
		}

		const claveAcceso = limpiar(body.claveAcceso).toUpperCase();
		if (!claveAcceso) {
			return NextResponse.json(
				{ error: "El token es obligatorio para crear el grupo." },
				{ status: 400 },
			);
		}

		const aig = await asegurarInstitucionGrupo(supabase, grado, grupo);
		const igResuelto = institucionGrupoIdBody || aig.id;
		if (!igResuelto) {
			return NextResponse.json({ error: aig.error ?? "No se pudo resolver la sección" }, { status: 400 });
		}
		if (institucionGrupoIdBody && aig.id && aig.id !== institucionGrupoIdBody) {
			return NextResponse.json({ error: "Datos de sección inconsistentes" }, { status: 400 });
		}

		const { data: ocupado } = await supabase
			.from("grupo_tokens")
			.select("id")
			.eq("institucion_grupo_id", igResuelto)
			.maybeSingle();

		const { data: existeGrupo } = await supabase
			.from("grupo_tokens")
			.select("id, clave_acceso, institucion_grupo_id")
			.eq("grado", grado)
			.eq("grupo", grupo)
			.maybeSingle();

		if (existeGrupo) {
			if (ocupado && ocupado.id !== existeGrupo.id) {
				return NextResponse.json(
					{ error: "Esa sección ya tiene asignado otro token" },
					{ status: 409 },
				);
			}
			if (String(existeGrupo.clave_acceso).toUpperCase() === claveAcceso) {
				const { error: errL } = await supabase
					.from("grupo_tokens")
					.update({ institucion_grupo_id: igResuelto })
					.eq("id", existeGrupo.id)
					.is("institucion_grupo_id", null);
				if (errL) {
					console.error("enlazar token existente a sección", errL);
				}
				return NextResponse.json({ ok: true, claveAcceso, actualizado: false });
			}
			const { error: errorUpdate } = await supabase
				.from("grupo_tokens")
				.update({ clave_acceso: claveAcceso, institucion_grupo_id: igResuelto })
				.eq("id", existeGrupo.id);
			if (errorUpdate) {
				console.error("actualizar token por grupo existente", errorUpdate);
				const msg = (errorUpdate.message || "").toLowerCase();
				if (msg.includes("duplicate") || msg.includes("unique")) {
					return NextResponse.json({ error: "La clave de acceso ya existe" }, { status: 409 });
				}
				return NextResponse.json({ error: "No se pudo actualizar el token del grupo" }, { status: 500 });
			}
			return NextResponse.json({ ok: true, claveAcceso, actualizado: true });
		}

		if (ocupado) {
			return NextResponse.json({ error: "Esa sección ya tiene un token" }, { status: 409 });
		}

		const { error } = await supabase.from("grupo_tokens").insert({
			grado,
			grupo,
			clave_acceso: claveAcceso,
			institucion_grupo_id: igResuelto,
		});
		if (error) {
			console.error("crear grupo token", error);
			const msg = (error.message || "").toLowerCase();
			if (msg.includes("duplicate") || msg.includes("unique")) {
				return NextResponse.json({ error: "La clave o la sección ya están en uso" }, { status: 409 });
			}
			return NextResponse.json({ error: "No se pudo crear el token" }, { status: 500 });
		}

		return NextResponse.json({ ok: true, claveAcceso });
	} catch (e) {
		console.error("crear grupo token", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function PUT(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	try {
		const body = (await request.json()) as {
			id?: string;
			grupoTexto?: string;
			claveAcceso?: string;
		};
		const id = limpiar(body.id);
		const grupoTexto = limpiar(body.grupoTexto);
		const claveAcceso = limpiar(body.claveAcceso).toUpperCase();
		if (!id || !grupoTexto || !claveAcceso) {
			return NextResponse.json(
				{ error: "id, grupo y token son obligatorios para guardar" },
				{ status: 400 },
			);
		}
		const gg = descomponerGrupo(grupoTexto);
		if (!gg) {
			return NextResponse.json(
				{ error: "Grupo inválido. Solo 1.°: escribe la letra (A, B, C…)." },
				{ status: 400 },
			);
		}

		if (gradoNumericoToken(gg.grado) !== 1) {
			return NextResponse.json({ error: MSG_TOKEN_SOLO_PRIMERO }, { status: 400 });
		}

		const supabase = obtenerClienteSupabaseAdmin();
		const aig = await asegurarInstitucionGrupo(supabase, gg.grado, gg.grupo);
		if (!aig.id) {
			return NextResponse.json({ error: aig.error ?? "No se pudo resolver la sección" }, { status: 400 });
		}

		const { data: conflicto } = await supabase
			.from("grupo_tokens")
			.select("id")
			.eq("institucion_grupo_id", aig.id)
			.maybeSingle();
		if (conflicto && conflicto.id !== id) {
			return NextResponse.json(
				{ error: "Ya existe un token para esa sección (grado y letra)" },
				{ status: 409 },
			);
		}

		const { error } = await supabase
			.from("grupo_tokens")
			.update({
				grado: gg.grado,
				grupo: gg.grupo,
				clave_acceso: claveAcceso,
				institucion_grupo_id: aig.id,
			})
			.eq("id", id);

		if (error) {
			console.error("actualizar grupo token", error);
			const msg = (error.message || "").toLowerCase();
			if (msg.includes("duplicate") || msg.includes("unique")) {
				return NextResponse.json(
					{ error: "Ese token o grupo ya existe. Usa valores distintos." },
					{ status: 409 },
				);
			}
			return NextResponse.json({ error: "No se pudo actualizar el token" }, { status: 500 });
		}
		return NextResponse.json({ ok: true });
	} catch (e) {
		console.error("actualizar grupo token", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

/**
 * Actualización parcial: clave y/o fecha de cierre sin mover la sección (cualquier grado).
 */
export async function PATCH(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	try {
		const body = (await request.json()) as {
			id?: string;
			claveAcceso?: string;
			fechaLimiteEntrega?: string | null;
		};
		const id = limpiar(body.id);
		if (!id) {
			return NextResponse.json({ error: "id obligatorio" }, { status: 400 });
		}
		const enviaClave = typeof body.claveAcceso === "string";
		const enviaFecha = body.fechaLimiteEntrega !== undefined;
		if (!enviaClave && !enviaFecha) {
			return NextResponse.json(
				{ error: "Indica claveAcceso y/o fechaLimiteEntrega" },
				{ status: 400 },
			);
		}

		const supabase = obtenerClienteSupabaseAdmin();
		const { data: existe, error: errQ } = await supabase
			.from("grupo_tokens")
			.select("id")
			.eq("id", id)
			.maybeSingle();
		if (errQ || !existe) {
			return NextResponse.json({ error: "Token no encontrado" }, { status: 404 });
		}

		const patch: { clave_acceso?: string; fecha_limite_entrega?: string | null } = {};
		if (enviaClave) {
			const c = limpiar(body.claveAcceso).toUpperCase();
			if (!c) {
				return NextResponse.json({ error: "La clave no puede quedar vacía" }, { status: 400 });
			}
			patch.clave_acceso = c;
		}
		if (enviaFecha) {
			let fecha: string | null = null;
			if (body.fechaLimiteEntrega === null || body.fechaLimiteEntrega === "") {
				fecha = null;
			} else if (typeof body.fechaLimiteEntrega === "string") {
				const s = body.fechaLimiteEntrega.trim();
				if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
					return NextResponse.json(
						{ error: "fechaLimiteEntrega debe ser YYYY-MM-DD o vacía" },
						{ status: 400 },
					);
				}
				fecha = s;
			} else {
				return NextResponse.json({ error: "fechaLimiteEntrega no válida" }, { status: 400 });
			}
			patch.fecha_limite_entrega = fecha;
		}

		const { error } = await supabase.from("grupo_tokens").update(patch).eq("id", id);
		if (error) {
			console.error("patch grupo token", error);
			const msg = (error.message || "").toLowerCase();
			if (msg.includes("duplicate") || msg.includes("unique")) {
				return NextResponse.json({ error: "Esa clave ya está en uso" }, { status: 409 });
			}
			return NextResponse.json({ error: "No se pudo actualizar el token" }, { status: 500 });
		}
		return NextResponse.json({ ok: true });
	} catch (e) {
		console.error("patch grupo token", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function DELETE(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	try {
		const body = (await request.json()) as { id?: string };
		const id = limpiar(body.id);
		if (!id) {
			return NextResponse.json({ error: "ID requerido" }, { status: 400 });
		}

		const supabase = obtenerClienteSupabaseAdmin();
		const { data: fila, error: errQ } = await supabase
			.from("grupo_tokens")
			.select("id, grado, grupo, clave_acceso, institucion_grupo_id")
			.eq("id", id)
			.maybeSingle();
		if (errQ || !fila) {
			return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
		}
		let igParaPadron = fila.institucion_grupo_id as string | null;
		if (!igParaPadron) {
			const aig = await asegurarInstitucionGrupo(
				supabase,
				String(fila.grado ?? "1").trim(),
				String(fila.grupo ?? "").trim(),
			);
			igParaPadron = aig.id ?? null;
		}
		if (igParaPadron) {
			const { error: errPad } = await supabase
				.from("padron_alumnos")
				.update({
					grupo_token_id: null,
					institucion_grupo_id: igParaPadron,
				})
				.eq("grupo_token_id", id);
			if (errPad) {
				console.error("padron al desvincular token", errPad);
				return NextResponse.json(
					{ error: "No se pudo conservar el padrón al eliminar el token" },
					{ status: 500 },
				);
			}
		}
		const { error } = await supabase.from("grupo_tokens").delete().eq("id", id);
		if (error) {
			console.error("eliminar grupo token", error);
			return NextResponse.json({ error: "No se pudo eliminar el token" }, { status: 500 });
		}
		await registrarLogApi({
			orientador,
			accion: `Eliminación de token de acceso (${String(fila.grado ?? "").trim()}°${String(fila.grupo ?? "").trim().toUpperCase()})`,
			entidad: "grupo_tokens",
			entidadId: id,
			detalle: {
				grado: fila.grado,
				grupo: fila.grupo,
				clave_acceso: fila.clave_acceso,
			},
		});
		return NextResponse.json({ ok: true });
	} catch (e) {
		console.error("eliminar grupo token", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
