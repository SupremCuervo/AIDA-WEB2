import { NextResponse } from "next/server";
import { gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";
import { esTipoDocumentoValido } from "@/lib/nombre-archivo";
import { resolverGrupoSeccionPorId } from "@/lib/orientador/resolver-grupo-seccion";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { insertarPadronAlumnosIgnorarDuplicados } from "@/lib/orientador/insertar-padron-lote";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function cuentaIdDesdePadron(
	c: { id: string }[] | { id: string } | null,
): string | null {
	if (!c) {
		return null;
	}
	if (Array.isArray(c)) {
		return c[0]?.id ?? null;
	}
	return typeof c.id === "string" ? c.id : null;
}

function aplicarFiltroPadronSeccion(
	q: ReturnType<ReturnType<typeof obtenerClienteSupabaseAdmin>["from"]>,
	resolucion: Awaited<ReturnType<typeof resolverGrupoSeccionPorId>> extends { ok: true; resolucion: infer R }
		? R
		: never,
) {
	if (resolucion.tipo === "solo_institucion") {
		return q.eq("institucion_grupo_id", resolucion.institucionGrupoId);
	}
	if (resolucion.institucionGrupoId) {
		return q.or(
			`grupo_token_id.eq.${resolucion.grupoTokenId},institucion_grupo_id.eq.${resolucion.institucionGrupoId}`,
		);
	}
	return q.eq("grupo_token_id", resolucion.grupoTokenId);
}

export async function GET(
	_request: Request,
	ctx: { params: Promise<{ grupoTokenId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const { grupoTokenId } = await ctx.params;
	if (!grupoTokenId) {
		return NextResponse.json({ error: "Grupo no válido" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const res = await resolverGrupoSeccionPorId(supabase, grupoTokenId);
		if (!res.ok) {
			return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
		}
		const { resolucion } = res;

		let q = supabase
			.from("padron_alumnos")
			.select(`
				id,
				nombre_completo,
				grado_alumno,
				carrera_id,
				matricula,
				cuentas_alumno ( id )
			`)
			.is("archivo_muerto_en", null)
			.order("nombre_completo", { ascending: true });

		if (resolucion.tipo === "solo_institucion") {
			q = q.eq("institucion_grupo_id", resolucion.institucionGrupoId);
		} else if (resolucion.institucionGrupoId) {
			q = q.or(
				`grupo_token_id.eq.${resolucion.grupoTokenId},institucion_grupo_id.eq.${resolucion.institucionGrupoId}`,
			);
		} else {
			q = q.eq("grupo_token_id", resolucion.grupoTokenId);
		}

		const { data: padrones, error: errP } = await q;

		if (errP) {
			console.error("orientador alumnos", errP);
			return NextResponse.json({ error: "No se pudieron cargar los alumnos" }, { status: 500 });
		}

		type Fila = {
			id: string;
			nombre_completo: string;
			grado_alumno: string | null;
			carrera_id: string | null;
			matricula: string | null;
			cuentas_alumno: { id: string }[] | { id: string } | null;
		};

		const lista = (padrones ?? []) as Fila[];
		const idsCarrera = [...new Set(lista.map((r) => r.carrera_id).filter((x): x is string => Boolean(x)))];
		const mapaCarrera = new Map<string, { nombre: string; codigo: string }>();
		if (idsCarrera.length > 0) {
			const { data: cars } = await supabase
				.from("carreras")
				.select("id, nombre, codigo")
				.in("id", idsCarrera);
			for (const c of cars ?? []) {
				mapaCarrera.set(String(c.id), {
					nombre: String(c.nombre),
					codigo: String(c.codigo),
				});
			}
		}
		const cuentaIds = lista
			.map((r) => cuentaIdDesdePadron(r.cuentas_alumno))
			.filter((x): x is string => Boolean(x));

		const counts = new Map<string, number>();
		if (cuentaIds.length > 0) {
			const { data: ent } = await supabase
				.from("entregas_documento_alumno")
				.select("cuenta_id, tipo_documento")
				.in("cuenta_id", cuentaIds);
			for (const e of ent ?? []) {
				const tipo = String((e as { tipo_documento?: string }).tipo_documento ?? "");
				if (!esTipoDocumentoValido(tipo)) {
					continue;
				}
				const id = e.cuenta_id as string;
				counts.set(id, (counts.get(id) ?? 0) + 1);
			}
		}

		const gradoToken = String(resolucion.grado ?? "");
		const alumnos = lista.map((r) => {
			const cid = cuentaIdDesdePadron(r.cuentas_alumno);
			const cr = r.carrera_id ? mapaCarrera.get(String(r.carrera_id)) : undefined;
			const matriculaVal =
				r.matricula != null && String(r.matricula).trim() !== "" ? String(r.matricula).trim() : null;
			return {
				padronId: r.id,
				nombreCompleto: r.nombre_completo,
				gradoAlumno: r.grado_alumno,
				gradoMostrado: gradoMostradoParaAlumno(r.grado_alumno, gradoToken),
				carreraId: r.carrera_id != null ? String(r.carrera_id) : null,
				carreraNombre: cr?.nombre ?? null,
				carreraCodigo: cr?.codigo ?? null,
				matricula: matriculaVal,
				cuentaId: cid,
				tieneCuenta: Boolean(cid),
				documentosSubidos: cid ? (counts.get(cid) ?? 0) : 0,
			};
		});

		const idGrupoResp =
			resolucion.tipo === "token" ? resolucion.grupoTokenId : resolucion.institucionGrupoId;

		return NextResponse.json({
			grupo: {
				id: idGrupoResp,
				grado: resolucion.grado,
				grupo: resolucion.grupo,
				fechaLimiteEntrega: resolucion.fechaLimiteEntrega,
				tieneToken: resolucion.tipo === "token",
				institucionGrupoId: resolucion.institucionGrupoId,
			},
			alumnos,
		});
	} catch (e) {
		console.error("orientador alumnos", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

function limpiarNombreAlumno(v: unknown): string {
	return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
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
	if (!grupoTokenId) {
		return NextResponse.json({ error: "Grupo no válido" }, { status: 400 });
	}

	let cuerpo: { nombreCompleto?: string; nombres?: string[] };
	try {
		cuerpo = (await request.json()) as { nombreCompleto?: string; nombres?: string[] };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const res = await resolverGrupoSeccionPorId(supabase, grupoTokenId);
		if (!res.ok) {
			return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
		}
		const { resolucion } = res;

		if (resolucion.tipo === "solo_institucion") {
			const igId = resolucion.institucionGrupoId;
			if (Array.isArray(cuerpo.nombres)) {
				const brutos = cuerpo.nombres.map((n) => limpiarNombreAlumno(n)).filter(Boolean);
				const unicos = [...new Set(brutos)];
				if (unicos.length === 0) {
					return NextResponse.json({ error: "La lista de nombres está vacía" }, { status: 400 });
				}
				const filas = unicos.map((nombre_completo) => ({
					institucion_grupo_id: igId,
					grupo_token_id: null as string | null,
					nombre_completo,
				}));
				const { error: errI } = await insertarPadronAlumnosIgnorarDuplicados(supabase, filas);
				if (errI) {
					console.error("orientador alumnos POST lote solo_ig", errI);
					return NextResponse.json({ error: "No se pudieron guardar los nombres" }, { status: 500 });
				}
				return NextResponse.json({
					ok: true,
					recibidos: cuerpo.nombres.length,
					unicosEnviados: unicos.length,
				});
			}
			const nombre = limpiarNombreAlumno(cuerpo.nombreCompleto);
			if (!nombre) {
				return NextResponse.json({ error: "nombreCompleto obligatorio" }, { status: 400 });
			}
			const { data: insertada, error: errUno } = await supabase
				.from("padron_alumnos")
				.insert({
					institucion_grupo_id: igId,
					grupo_token_id: null,
					nombre_completo: nombre,
				})
				.select("id")
				.single();
			if (errUno) {
				if (errUno.code === "23505") {
					return NextResponse.json(
						{ error: "Ese nombre ya está en el padrón de este grupo" },
						{ status: 409 },
					);
				}
				console.error("orientador alumnos POST uno solo_ig", errUno);
				return NextResponse.json({ error: "No se pudo agregar al alumno" }, { status: 500 });
			}
			return NextResponse.json({
				ok: true,
				padronId: insertada.id,
				nombreCompleto: nombre,
			});
		}

		const tokId = resolucion.grupoTokenId;
		const igDeToken = resolucion.institucionGrupoId;
		if (!igDeToken) {
			return NextResponse.json(
				{ error: "El token no está enlazado al catálogo de secciones; revisa Tokens de grupo." },
				{ status: 400 },
			);
		}

		if (Array.isArray(cuerpo.nombres)) {
			const brutos = cuerpo.nombres.map((n) => limpiarNombreAlumno(n)).filter(Boolean);
			const unicos = [...new Set(brutos)];
			if (unicos.length === 0) {
				return NextResponse.json({ error: "La lista de nombres está vacía" }, { status: 400 });
			}
			const filas = unicos.map((nombre_completo) => ({
				grupo_token_id: tokId,
				institucion_grupo_id: igDeToken,
				nombre_completo,
			}));
			const { error: errI } = await insertarPadronAlumnosIgnorarDuplicados(supabase, filas);
			if (errI) {
				console.error("orientador alumnos POST lote", errI);
				return NextResponse.json({ error: "No se pudieron guardar los nombres" }, { status: 500 });
			}
			return NextResponse.json({
				ok: true,
				recibidos: cuerpo.nombres.length,
				unicosEnviados: unicos.length,
			});
		}

		const nombre = limpiarNombreAlumno(cuerpo.nombreCompleto);
		if (!nombre) {
			return NextResponse.json({ error: "nombreCompleto obligatorio" }, { status: 400 });
		}

		const { data: insertada, error: errUno } = await supabase
			.from("padron_alumnos")
			.insert({
				grupo_token_id: tokId,
				institucion_grupo_id: igDeToken,
				nombre_completo: nombre,
			})
			.select("id")
			.single();

		if (errUno) {
			if (errUno.code === "23505") {
				return NextResponse.json(
					{ error: "Ese nombre ya está en el padrón de este grupo" },
					{ status: 409 },
				);
			}
			console.error("orientador alumnos POST uno", errUno);
			return NextResponse.json({ error: "No se pudo agregar al alumno" }, { status: 500 });
		}

		return NextResponse.json({
			ok: true,
			padronId: insertada.id,
			nombreCompleto: nombre,
		});
	} catch (e) {
		console.error("orientador alumnos POST", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
