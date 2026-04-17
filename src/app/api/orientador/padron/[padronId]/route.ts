import { NextResponse } from "next/server";
import {
	carreraExisteEnCatalogo,
	normalizarCarreraIdPayload,
} from "@/lib/padron/carrera-padron";
import { gradoMostradoParaAlumno, normalizarGradoAlumnoPayload } from "@/lib/padron/grado-alumno";
import { normalizarMatriculaPayload } from "@/lib/padron/matricula-padron";
import { alumnoRequiereCarrera } from "@/lib/padron/requiere-carrera";
import { etiquetaAuditoriaOrientador, registrarLogApi } from "@/lib/orientador/audit-registrar";
import { seccionGradoGrupoParaLogPadron } from "@/lib/orientador/log-seccion-padron";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function limpiarNombre(v: unknown): string {
	return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

export async function PATCH(
	request: Request,
	ctx: { params: Promise<{ padronId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const { padronId } = await ctx.params;
	if (!padronId) {
		return NextResponse.json({ error: "Registro no válido" }, { status: 400 });
	}

	let cuerpo: {
		nombreCompleto?: string;
		grupoTokenIdDestino?: string;
		gradoAlumno?: string | null;
		carreraId?: string | null;
		matricula?: string | null;
		estadoExpediente?: string;
	};
	try {
		cuerpo = (await request.json()) as {
			nombreCompleto?: string;
			grupoTokenIdDestino?: string;
			gradoAlumno?: string | null;
			carreraId?: string | null;
			matricula?: string | null;
			estadoExpediente?: string;
		};
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const nombreNuevo = limpiarNombre(cuerpo.nombreCompleto);
	const destino =
		typeof cuerpo.grupoTokenIdDestino === "string" ? cuerpo.grupoTokenIdDestino.trim() : "";
	const tocaGrado = Object.prototype.hasOwnProperty.call(cuerpo, "gradoAlumno");
	const tocaCarrera = Object.prototype.hasOwnProperty.call(cuerpo, "carreraId");
	const tocaMatricula = Object.prototype.hasOwnProperty.call(cuerpo, "matricula");
	const tocaEstado = Object.prototype.hasOwnProperty.call(cuerpo, "estadoExpediente");

	let gradoAlumnoDb: string | null | undefined;
	if (tocaGrado) {
		const norm = normalizarGradoAlumnoPayload(cuerpo.gradoAlumno);
		if (!norm.ok) {
			return NextResponse.json({ error: norm.error }, { status: 400 });
		}
		gradoAlumnoDb = norm.valor;
	}

	let carreraNorm: { ok: true; valor: string | null } | { ok: false; error: string } | null = null;
	if (tocaCarrera) {
		const n = normalizarCarreraIdPayload(cuerpo.carreraId);
		if (!n.ok) {
			return NextResponse.json({ error: n.error }, { status: 400 });
		}
		carreraNorm = n;
	}

	let matriculaNorm: { ok: true; valor: string | null } | { ok: false; error: string } | null = null;
	if (tocaMatricula) {
		const m = normalizarMatriculaPayload(cuerpo.matricula);
		if (!m.ok) {
			return NextResponse.json({ error: m.error }, { status: 400 });
		}
		matriculaNorm = m;
	}

	let estadoNorm: "activo" | "inactivo" | null = null;
	if (tocaEstado) {
		const raw = typeof cuerpo.estadoExpediente === "string" ? cuerpo.estadoExpediente.trim().toLowerCase() : "";
		if (raw !== "activo" && raw !== "inactivo") {
			return NextResponse.json({ error: "estadoExpediente debe ser activo o inactivo" }, { status: 400 });
		}
		estadoNorm = raw;
	}

	if (!nombreNuevo && !destino && !tocaGrado && !tocaCarrera && !tocaMatricula && !tocaEstado) {
		return NextResponse.json(
			{
				error:
					"Indica nombreCompleto, grupoTokenIdDestino, gradoAlumno, carreraId, matricula y/o estadoExpediente",
			},
			{ status: 400 },
		);
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: actual, error: errA } = await supabase
			.from("padron_alumnos")
			.select("id, nombre_completo, grupo_token_id, institucion_grupo_id, grado_alumno, carrera_id, matricula")
			.eq("id", padronId)
			.maybeSingle();

		if (errA || !actual) {
			return NextResponse.json({ error: "Alumno no encontrado en padrón" }, { status: 404 });
		}

		const nombreFinal = nombreNuevo || actual.nombre_completo;

		let grupoTokenDestino: string | null = destino ? destino : actual.grupo_token_id;
		let institucionGrupoDestino: string | null = actual.institucion_grupo_id as string | null;

		if (destino) {
			const { data: gt, error: errG } = await supabase
				.from("grupo_tokens")
				.select("id, institucion_grupo_id")
				.eq("id", destino)
				.maybeSingle();
			if (gt) {
				grupoTokenDestino = gt.id as string;
				institucionGrupoDestino = (gt.institucion_grupo_id as string | null) ?? null;
			} else {
				const { data: ig, error: errI } = await supabase
					.from("institucion_grupos")
					.select("id")
					.eq("id", destino)
					.maybeSingle();
				if (errI || !ig) {
					return NextResponse.json({ error: "Grupo destino no existe" }, { status: 400 });
				}
				institucionGrupoDestino = ig.id as string;
				const { data: tokOp } = await supabase
					.from("grupo_tokens")
					.select("id")
					.eq("institucion_grupo_id", ig.id)
					.maybeSingle();
				grupoTokenDestino = tokOp?.id ? String(tokOp.id) : null;
			}
		}

		const gradoAlumnoFinal = tocaGrado ? (gradoAlumnoDb ?? null) : actual.grado_alumno;

		let gradoTok = "";
		if (grupoTokenDestino) {
			const { data: tok, error: errTok } = await supabase
				.from("grupo_tokens")
				.select("grado")
				.eq("id", grupoTokenDestino)
				.maybeSingle();
			if (!errTok && tok?.grado != null) {
				gradoTok = String(tok.grado).trim();
			}
		}
		if (gradoTok === "" && institucionGrupoDestino) {
			const { data: igRow, error: errIg } = await supabase
				.from("institucion_grupos")
				.select("grado")
				.eq("id", institucionGrupoDestino)
				.maybeSingle();
			if (!errIg && igRow?.grado != null) {
				gradoTok = String(igRow.grado).trim();
			}
		}
		if (gradoTok === "") {
			gradoTok = "1";
		}

		const gradoMostrado = gradoMostradoParaAlumno(gradoAlumnoFinal, gradoTok);
		const requiereCarrera = alumnoRequiereCarrera(gradoMostrado);

		if (tocaCarrera && carreraNorm && carreraNorm.valor != null && !requiereCarrera) {
			return NextResponse.json(
				{ error: "En 1.° grado no aplica carrera; solo a partir de 2.°" },
				{ status: 400 },
			);
		}

		if (tocaMatricula && matriculaNorm && matriculaNorm.valor != null && !requiereCarrera) {
			return NextResponse.json(
				{ error: "En 1.° grado no aplica matrícula; solo a partir de 2.°" },
				{ status: 400 },
			);
		}

		if (
			tocaCarrera &&
			carreraNorm &&
			carreraNorm.valor != null &&
			!(await carreraExisteEnCatalogo(supabase, carreraNorm.valor))
		) {
			return NextResponse.json({ error: "Carrera no válida" }, { status: 400 });
		}

		const actualizacion: {
			nombre_completo?: string;
			grupo_token_id?: string | null;
			institucion_grupo_id?: string | null;
			grado_alumno?: string | null;
			carrera_id?: string | null;
			matricula?: string | null;
			archivo_muerto_en?: string | null;
		} = {};

		if (tocaEstado && estadoNorm) {
			actualizacion.archivo_muerto_en = estadoNorm === "activo" ? null : new Date().toISOString();
		}

		if (nombreNuevo || destino) {
			actualizacion.nombre_completo = nombreFinal;
			actualizacion.grupo_token_id = grupoTokenDestino;
			actualizacion.institucion_grupo_id = institucionGrupoDestino;
		}
		if (tocaGrado) {
			actualizacion.grado_alumno = gradoAlumnoDb ?? null;
		}

		if (!requiereCarrera) {
			actualizacion.carrera_id = null;
			actualizacion.matricula = null;
		} else {
			if (tocaCarrera && carreraNorm) {
				actualizacion.carrera_id = carreraNorm.valor;
			}
			if (tocaMatricula && matriculaNorm) {
				actualizacion.matricula = matriculaNorm.valor;
			}
		}

		const { data: rpcResult, error: errRpc } = await supabase.rpc("orientador_api_update_padron_alumnos", {
			p_padron_id: padronId,
			p_actor_id: orientador.orientadorId,
			p_actor_etiqueta: etiquetaAuditoriaOrientador(orientador),
			p_set: actualizacion,
		});

		if (errRpc) {
			if (errRpc.code === "23505") {
				return NextResponse.json(
					{ error: "Ya existe ese nombre en el grupo destino" },
					{ status: 409 },
				);
			}
			console.error("padron PATCH rpc", errRpc);
			return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
		}

		const rpcOk = rpcResult as { ok?: boolean; error?: string } | null;
		if (!rpcOk?.ok) {
			if (rpcOk?.error === "not_found") {
				return NextResponse.json({ error: "Alumno no encontrado en padrón" }, { status: 404 });
			}
			return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
		}

		const detallesCambios: string[] = [];
		if (nombreNuevo) {
			detallesCambios.push("nombre");
		}
		if (destino) {
			detallesCambios.push("grupo");
		}
		if (tocaGrado) {
			detallesCambios.push("grado");
		}
		if (tocaCarrera) {
			detallesCambios.push("carrera");
		}
		if (tocaMatricula) {
			detallesCambios.push("matricula");
		}
		if (tocaEstado && estadoNorm) {
			detallesCambios.push(estadoNorm === "inactivo" ? "inactivacion" : "reactivacion");
		}
		const accionLog =
			tocaEstado && estadoNorm === "inactivo"
				? `Inactivacion expediente - ${nombreFinal}`
				: tocaEstado && estadoNorm === "activo"
					? `Reactivacion expediente - ${nombreFinal}`
					: `Actualizacion expediente - ${nombreFinal}`;
		const secLog = await seccionGradoGrupoParaLogPadron(supabase, padronId);
		await registrarLogApi({
			orientador,
			accion: accionLog,
			entidad: "padron_alumnos",
			entidadId: padronId,
			detalle: {
				campos: detallesCambios,
				estado_expediente: estadoNorm,
				...secLog,
			},
		});

		return NextResponse.json({
			ok: true,
			padronId,
			nombreCompleto: nombreFinal,
			grupoTokenId: grupoTokenDestino,
			institucionGrupoId: institucionGrupoDestino,
			...(tocaGrado ? { gradoAlumno: gradoAlumnoDb } : {}),
			...(tocaCarrera && carreraNorm ? { carreraId: carreraNorm.valor } : {}),
			...(tocaMatricula && matriculaNorm ? { matricula: matriculaNorm.valor } : {}),
			...(tocaEstado && estadoNorm ? { estadoExpediente: estadoNorm } : {}),
		});
	} catch (e) {
		console.error("padron PATCH", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function DELETE(
	_request: Request,
	ctx: { params: Promise<{ padronId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const { padronId } = await ctx.params;
	if (!padronId) {
		return NextResponse.json({ error: "Registro no válido" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: fila, error: errQ } = await supabase
			.from("padron_alumnos")
			.select("id, nombre_completo, grupo_token_id")
			.eq("id", padronId)
			.maybeSingle();
		if (errQ || !fila) {
			return NextResponse.json({ error: "Alumno no encontrado en padrón" }, { status: 404 });
		}
		const secLog = await seccionGradoGrupoParaLogPadron(supabase, padronId);
		const { error } = await supabase.from("padron_alumnos").delete().eq("id", padronId);
		if (error) {
			console.error("padron DELETE", error);
			return NextResponse.json({ error: "No se pudo eliminar" }, { status: 500 });
		}
		await registrarLogApi({
			orientador,
			accion: `Eliminacion expediente - ${fila.nombre_completo}`,
			entidad: "padron_alumnos",
			entidadId: padronId,
			detalle: {
				nombre_completo: fila.nombre_completo,
				grupo_token_id: fila.grupo_token_id,
				...secLog,
			},
		});
		return NextResponse.json({ ok: true });
	} catch (e) {
		console.error("padron DELETE", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
