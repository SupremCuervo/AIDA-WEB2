import { NextResponse } from "next/server";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import {
	carreraExisteEnCatalogo,
	normalizarCarreraIdPayload,
} from "@/lib/padron/carrera-padron";
import { gradoMostradoParaAlumno, normalizarGradoAlumnoPayload } from "@/lib/padron/grado-alumno";
import { normalizarMatriculaPayload } from "@/lib/padron/matricula-padron";
import { alumnoRequiereCarrera } from "@/lib/padron/requiere-carrera";
import { normalizarLetraGrupo } from "@/lib/orientador/cargas-helpers";
import { TIPOS_DOCUMENTO } from "@/lib/nombre-archivo";
import { registrarLogApi } from "@/lib/orientador/audit-registrar";
import { seccionGradoGrupoParaLogPadron } from "@/lib/orientador/log-seccion-padron";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type FilaPadron = {
	id: string;
	nombre_completo: string;
	matricula: string | null;
	grado_alumno: string | null;
	archivo_muerto_en: string | null;
	carrera_id: string | null;
	grupo_token_id: string | null;
	institucion_grupo_id: string | null;
	grupo_tokens: { grado: string | number; grupo: string } | null;
	institucion_grupos: { grado: string | number; grupo: string } | null;
	cuentas_alumno: { id: string }[] | { id: string } | null;
};

type FilaEntregaMin = {
	cuenta_id: string;
	tipo_documento: string;
	estado?: string | null;
};

function limpiarNombreCompleto(v: unknown): string {
	return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

function cuentaIdDesdePadron(c: { id: string }[] | { id: string } | null): string | null {
	if (!c) {
		return null;
	}
	if (Array.isArray(c)) {
		return c[0]?.id ?? null;
	}
	return typeof c.id === "string" ? c.id : null;
}

export async function GET(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const url = new URL(request.url);
	const estado = (url.searchParams.get("estado") ?? "activo").trim().toLowerCase();
	const nombre = (url.searchParams.get("nombre") ?? "").trim();
	const matricula = (url.searchParams.get("matricula") ?? "").trim();
	const grado = (url.searchParams.get("grado") ?? "").trim();
	const grupo = (url.searchParams.get("grupo") ?? "").trim().toUpperCase();
	const carreraId = (url.searchParams.get("carreraId") ?? "").trim();

	try {
		const supabase = obtenerClienteSupabaseAdmin();

		let q = supabase
			.from("padron_alumnos")
			.select(
				`
				id,
				nombre_completo,
				matricula,
				grado_alumno,
				archivo_muerto_en,
				carrera_id,
				grupo_token_id,
				institucion_grupo_id,
				grupo_tokens ( grado, grupo ),
				institucion_grupos ( grado, grupo ),
				cuentas_alumno ( id )
			`,
			)
			.order("nombre_completo", { ascending: true });

		if (estado === "inactivo") {
			q = q.not("archivo_muerto_en", "is", null);
		} else {
			q = q.is("archivo_muerto_en", null);
		}
		if (nombre) {
			q = q.ilike("nombre_completo", `%${nombre}%`);
		}
		if (matricula) {
			q = q.ilike("matricula", `%${matricula}%`);
		}
		if (carreraId) {
			q = q.eq("carrera_id", carreraId);
		}

		const { data: filasRaw, error } = await q;
		if (error) {
			console.error("orientador expediente", error);
			return NextResponse.json({ error: "No se pudo cargar expediente" }, { status: 500 });
		}

		const filas = (filasRaw ?? []) as unknown as FilaPadron[];
		const cuentaIds = filas
			.map((f) => cuentaIdDesdePadron(f.cuentas_alumno))
			.filter((x): x is string => typeof x === "string" && x.trim() !== "");
		const docsBasePorCuenta = new Map<string, number>();
		const cuentaConRechazo = new Set<string>();
		const cuentaConAceptado = new Set<string>();
		if (cuentaIds.length > 0) {
			const { data: entregas } = await supabase
				.from("entregas_documento_alumno")
				.select("cuenta_id, tipo_documento, estado")
				.in("cuenta_id", cuentaIds)
				.in("tipo_documento", Object.keys(TIPOS_DOCUMENTO));
			const filasEnt = (entregas ?? []) as unknown as FilaEntregaMin[];
			const uniqPorCuenta = new Map<string, Set<string>>();
			for (const e of filasEnt) {
				const cid = String(e.cuenta_id ?? "").trim();
				const tipo = String(e.tipo_documento ?? "").trim();
				if (!cid || !tipo) {
					continue;
				}
				const s = uniqPorCuenta.get(cid) ?? new Set<string>();
				s.add(tipo);
				uniqPorCuenta.set(cid, s);
				if (String(e.estado ?? "").trim().toLowerCase() === "rechazado") {
					cuentaConRechazo.add(cid);
				}
				if (String(e.estado ?? "").trim().toLowerCase() === "validado") {
					cuentaConAceptado.add(cid);
				}
			}
			for (const [cid, set] of uniqPorCuenta.entries()) {
				docsBasePorCuenta.set(cid, set.size);
			}
		}
		const totalDocsBase = Object.keys(TIPOS_DOCUMENTO).length;
		const idsCarrera = [
			...new Set(filas.map((f) => f.carrera_id).filter((x): x is string => typeof x === "string" && x !== "")),
		];
		const mapaCarrera = new Map<string, { id: string; nombre: string; codigo: string }>();

		if (idsCarrera.length > 0) {
			const { data: carreras } = await supabase
				.from("carreras")
				.select("id, nombre, codigo")
				.in("id", idsCarrera);
			for (const c of carreras ?? []) {
				mapaCarrera.set(String(c.id), {
					id: String(c.id),
					nombre: String(c.nombre),
					codigo: String(c.codigo),
				});
			}
		}

		const alumnos = filas
			.map((f) => {
				const gradoBase =
					f.grupo_tokens?.grado != null
						? String(f.grupo_tokens.grado)
						: f.institucion_grupos?.grado != null
							? String(f.institucion_grupos.grado)
							: "1";
				const grupoBase =
					f.grupo_tokens?.grupo != null
						? String(f.grupo_tokens.grupo).toUpperCase()
						: f.institucion_grupos?.grupo != null
							? String(f.institucion_grupos.grupo).toUpperCase()
							: "";
				const gradoMostrado = gradoMostradoParaAlumno(f.grado_alumno, gradoBase);
				const carrera = f.carrera_id ? mapaCarrera.get(String(f.carrera_id)) : undefined;
				const tokenId = f.grupo_token_id != null && String(f.grupo_token_id).trim() !== "" ? String(f.grupo_token_id) : null;
				const igId =
					f.institucion_grupo_id != null && String(f.institucion_grupo_id).trim() !== ""
						? String(f.institucion_grupo_id)
						: null;
				const cuentaId = cuentaIdDesdePadron(f.cuentas_alumno);
				const documentosBaseSubidos = cuentaId ? (docsBasePorCuenta.get(cuentaId) ?? 0) : 0;
				return {
					padronId: f.id,
					nombreCompleto: f.nombre_completo,
					matricula: f.matricula ?? "",
					grado: gradoMostrado,
					grupo: grupoBase,
					grupoTokenId: tokenId,
					institucionGrupoId: igId,
					carreraId: carrera?.id ?? null,
					carreraNombre: carrera?.nombre ?? "",
					carreraCodigo: carrera?.codigo ?? "",
					estado: f.archivo_muerto_en ? "inactivo" : "activo",
					cuentaId,
					documentosBaseSubidos,
					documentosBaseTotales: totalDocsBase,
					expedienteCompleto: documentosBaseSubidos >= totalDocsBase && totalDocsBase > 0,
					tieneDocumentoRechazado: cuentaId ? cuentaConRechazo.has(cuentaId) : false,
					tieneDocumentoAceptado: cuentaId ? cuentaConAceptado.has(cuentaId) : false,
				};
			})
			.filter((a) => (grado ? a.grado === grado : true))
			.filter((a) => (grupo ? a.grupo === grupo : true));

		const carrerasFiltro = [...mapaCarrera.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
		return NextResponse.json({ alumnos, carreras: carrerasFiltro });
	} catch (e) {
		console.error("orientador expediente", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function POST(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	let cuerpo: {
		nombreCompleto?: string;
		grupoTokenIdDestino?: string;
		gradoAlumno?: string | null;
		carreraId?: string | null;
		matricula?: string | null;
		cargaAlumnosId?: string | null;
	};
	try {
		cuerpo = (await request.json()) as {
			nombreCompleto?: string;
			grupoTokenIdDestino?: string;
			gradoAlumno?: string | null;
			carreraId?: string | null;
			matricula?: string | null;
			cargaAlumnosId?: string | null;
		};
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const nombre = limpiarNombreCompleto(cuerpo.nombreCompleto);
	const destino =
		typeof cuerpo.grupoTokenIdDestino === "string" ? cuerpo.grupoTokenIdDestino.trim() : "";
	if (!nombre) {
		return NextResponse.json({ error: "nombreCompleto obligatorio" }, { status: 400 });
	}
	if (!destino) {
		return NextResponse.json({ error: "Selecciona un grupo (grupoTokenIdDestino)" }, { status: 400 });
	}

	const tocaGrado = Object.prototype.hasOwnProperty.call(cuerpo, "gradoAlumno");
	let gradoAlumnoDb: string | null = null;
	if (tocaGrado) {
		const norm = normalizarGradoAlumnoPayload(cuerpo.gradoAlumno);
		if (!norm.ok) {
			return NextResponse.json({ error: norm.error }, { status: 400 });
		}
		gradoAlumnoDb = norm.valor;
	}

	const carreraNorm = normalizarCarreraIdPayload(cuerpo.carreraId);
	if (!carreraNorm.ok) {
		return NextResponse.json({ error: carreraNorm.error }, { status: 400 });
	}
	const matriculaNorm = normalizarMatriculaPayload(cuerpo.matricula);
	if (!matriculaNorm.ok) {
		return NextResponse.json({ error: matriculaNorm.error }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();

		let grupoTokenDestino: string | null = null;
		let institucionGrupoDestino: string | null = null;

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

		let gradoTok = "";
		if (grupoTokenDestino) {
			const { data: tok } = await supabase
				.from("grupo_tokens")
				.select("grado")
				.eq("id", grupoTokenDestino)
				.maybeSingle();
			if (tok?.grado != null) {
				gradoTok = String(tok.grado).trim();
			}
		}
		if (gradoTok === "" && institucionGrupoDestino) {
			const { data: igRow } = await supabase
				.from("institucion_grupos")
				.select("grado")
				.eq("id", institucionGrupoDestino)
				.maybeSingle();
			if (igRow?.grado != null) {
				gradoTok = String(igRow.grado).trim();
			}
		}
		if (gradoTok === "") {
			gradoTok = "1";
		}

		const gradoMostrado = gradoMostradoParaAlumno(gradoAlumnoDb, gradoTok);
		const requiereCarrera = alumnoRequiereCarrera(gradoMostrado);

		if (carreraNorm.valor != null && !requiereCarrera) {
			return NextResponse.json(
				{ error: "En 1.° grado no aplica carrera; solo a partir de 2.°" },
				{ status: 400 },
			);
		}
		if (matriculaNorm.valor != null && !requiereCarrera) {
			return NextResponse.json(
				{ error: "En 1.° grado no aplica matrícula; solo a partir de 2.°" },
				{ status: 400 },
			);
		}
		if (
			carreraNorm.valor != null &&
			!(await carreraExisteEnCatalogo(supabase, carreraNorm.valor))
		) {
			return NextResponse.json({ error: "Carrera no válida" }, { status: 400 });
		}

		if (!institucionGrupoDestino) {
			return NextResponse.json({ error: "Grupo destino sin sección institucional" }, { status: 400 });
		}
		const { data: igSeccion } = await supabase
			.from("institucion_grupos")
			.select("grupo")
			.eq("id", institucionGrupoDestino)
			.maybeSingle();
		const letraAlumno = normalizarLetraGrupo(String(igSeccion?.grupo ?? ""));
		if (!letraAlumno) {
			return NextResponse.json({ error: "No se pudo resolver la letra de grupo" }, { status: 400 });
		}

		let cargaInscripcionId: string | null = null;
		if (!requiereCarrera) {
			const rawCarga =
				typeof cuerpo.cargaAlumnosId === "string" ? cuerpo.cargaAlumnosId.trim() : "";
			if (!rawCarga) {
				return NextResponse.json(
					{
						error:
							"En 1.° grado elige el plazo de inscripción (fecha de cierre de la carga) para asociar al alumno solo a ese periodo.",
					},
					{ status: 400 },
				);
			}
			const { data: cargaRow, error: errCarga } = await supabase
				.from("cargas_alumnos")
				.select("id, orientador_id, grado_carga, grupos_letras")
				.eq("id", rawCarga)
				.maybeSingle();
			if (errCarga || !cargaRow) {
				return NextResponse.json({ error: "La carga indicada no existe" }, { status: 400 });
			}
			if ((cargaRow.orientador_id as string) !== orientador.orientadorId) {
				return NextResponse.json({ error: "No autorizado para esa carga" }, { status: 403 });
			}
			const gCarga = Number(cargaRow.grado_carga);
			const gTok = Number.parseInt(String(gradoTok).trim(), 10) || 0;
			if (gCarga !== gTok) {
				return NextResponse.json(
					{ error: "El grado de la carga no coincide con el grupo escolar del alumno" },
					{ status: 400 },
				);
			}
			const letrasPermitidas = ((cargaRow.grupos_letras as string[]) ?? []).map((x) =>
				normalizarLetraGrupo(String(x)),
			);
			if (!letrasPermitidas.includes(letraAlumno)) {
				return NextResponse.json(
					{
						error:
							"Esa carga no incluye la letra de grupo del alumno; elige otra fecha de cierre o amplía los grupos de la carga.",
					},
					{ status: 400 },
				);
			}
			cargaInscripcionId = rawCarga;
		}

		let carreraInsert: string | null;
		let matriculaInsert: string | null;
		if (!requiereCarrera) {
			carreraInsert = null;
			matriculaInsert = null;
		} else {
			carreraInsert = carreraNorm.valor;
			matriculaInsert = matriculaNorm.valor;
		}

		const filaInsert: Record<string, unknown> = {
			nombre_completo: nombre,
			grupo_token_id: grupoTokenDestino,
			institucion_grupo_id: institucionGrupoDestino,
			carrera_id: carreraInsert,
			matricula: matriculaInsert,
			archivo_muerto_en: null,
		};
		if (tocaGrado) {
			filaInsert.grado_alumno = gradoAlumnoDb;
		}

		const { data: insertada, error: errInsert } = await supabase
			.from("padron_alumnos")
			.insert(filaInsert)
			.select("id")
			.single();

		if (errInsert) {
			if (errInsert.code === "23505") {
				return NextResponse.json(
					{ error: "Ya existe ese nombre en el grupo seleccionado" },
					{ status: 409 },
				);
			}
			console.error("orientador expediente POST", errInsert);
			return NextResponse.json({ error: "No se pudo crear el expediente" }, { status: 500 });
		}

		const padronNuevoId = insertada.id as string;

		if (cargaInscripcionId) {
			const { error: errLinea } = await supabase.from("carga_alumnos_linea").insert({
				carga_id: cargaInscripcionId,
				grupo_letra: letraAlumno,
				nombre_completo: nombre,
				padron_id: padronNuevoId,
			});
			if (errLinea) {
				await supabase.from("padron_alumnos").delete().eq("id", padronNuevoId);
				if (errLinea.code === "23505") {
					return NextResponse.json(
						{
							error:
								"Ese nombre ya está en la lista de esa carga y fecha de cierre; elige otro plazo o revisa duplicados.",
						},
						{ status: 409 },
					);
				}
				console.error("orientador expediente POST linea carga", errLinea);
				return NextResponse.json(
					{ error: "No se pudo vincular el alumno al plazo de carga" },
					{ status: 500 },
				);
			}
		}

		const secLog = await seccionGradoGrupoParaLogPadron(supabase, padronNuevoId);
		await registrarLogApi({
			orientador,
			accion: `Creacion expediente - ${nombre}`,
			entidad: "padron_alumnos",
			entidadId: padronNuevoId,
			detalle: {
				nombre_completo: nombre,
				grupo_token_id: grupoTokenDestino,
				institucion_grupo_id: institucionGrupoDestino,
				carga_alumnos_id: cargaInscripcionId,
				...secLog,
			},
		});

		return NextResponse.json({
			ok: true,
			padronId: padronNuevoId,
			nombreCompleto: nombre,
		});
	} catch (e) {
		console.error("orientador expediente POST", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

