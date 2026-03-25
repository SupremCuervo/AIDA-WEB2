import { NextResponse } from "next/server";
import { gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";
import { alumnoRequiereCarrera } from "@/lib/padron/requiere-carrera";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function obtenerCuentaId(
	c: { id: string }[] | { id: string } | null,
): string | null {
	if (Array.isArray(c) && c[0]?.id) {
		return c[0].id;
	}
	if (c && typeof c === "object" && "id" in c) {
		return (c as { id: string }).id;
	}
	return null;
}

type FilaToken = {
	id: string;
	clave_acceso: string;
	grupo: string;
	grado: string;
	fecha_limite_entrega: string | null;
	creado_en: string;
	institucion_grupo_id: string | null;
};

type FilaInstitucionGrupo = {
	id: string;
	grado: number;
	grupo: string;
};

function normalizarGradoGrupoToken(t: FilaToken): { grado: string; grupo: string } {
	return {
		grado: String(t.grado ?? "").trim(),
		grupo: String(t.grupo ?? "").trim().toUpperCase(),
	};
}

export async function GET() {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();

		const { data: secciones, error: errS } = await supabase
			.from("institucion_grupos")
			.select("id, grado, grupo")
			.order("grado", { ascending: true })
			.order("grupo", { ascending: true });

		if (errS) {
			console.error("orientador grupos institucion_grupos", errS);
			return NextResponse.json({ error: "No se pudieron cargar las secciones" }, { status: 500 });
		}

		const { data: gruposRaw, error: errG } = await supabase
			.from("grupo_tokens")
			.select("id, clave_acceso, grupo, grado, fecha_limite_entrega, creado_en, institucion_grupo_id")
			.order("grado", { ascending: true })
			.order("grupo", { ascending: true });

		if (errG) {
			console.error("orientador grupos", errG);
			return NextResponse.json({ error: "No se pudieron cargar los grupos" }, { status: 500 });
		}

		const tokens = (gruposRaw ?? []) as FilaToken[];
		const listaIg = (secciones ?? []) as FilaInstitucionGrupo[];

		const tokenPorSeccion = new Map<string, FilaToken>();
		for (const t of tokens) {
			if (t.institucion_grupo_id) {
				tokenPorSeccion.set(t.institucion_grupo_id, t);
			}
		}
		for (const t of tokens) {
			if (t.institucion_grupo_id) {
				continue;
			}
			const { grado: gd, grupo: gp } = normalizarGradoGrupoToken(t);
			const ig = listaIg.find(
				(s) => String(s.grado) === gd && String(s.grupo).toUpperCase() === gp,
			);
			if (ig && !tokenPorSeccion.has(ig.id)) {
				tokenPorSeccion.set(ig.id, t);
			}
		}

		const { data: padrones, error: errP } = await supabase
			.from("padron_alumnos")
			.select(`
				id,
				grupo_token_id,
				institucion_grupo_id,
				grado_alumno,
				carrera_id,
				cuentas_alumno ( id )
			`)
			.is("archivo_muerto_en", null);

		if (errP) {
			console.error("orientador grupos padron", errP);
			return NextResponse.json({ error: "No se pudieron cargar alumnos" }, { status: 500 });
		}

		type FilaPadron = {
			id: string;
			grupo_token_id: string | null;
			institucion_grupo_id: string | null;
			grado_alumno: string | null;
			carrera_id: string | null;
			cuentas_alumno: { id: string }[] | { id: string } | null;
		};

		const filas = (padrones ?? []) as FilaPadron[];
		const cuentaIds: string[] = [];
		for (const r of filas) {
			const c = r.cuentas_alumno;
			if (Array.isArray(c) && c[0]?.id) {
				cuentaIds.push(c[0].id);
			} else if (c && typeof c === "object" && "id" in c && typeof (c as { id: string }).id === "string") {
				cuentaIds.push((c as { id: string }).id);
			}
		}

		let cuentasConDoc = new Set<string>();
		if (cuentaIds.length > 0) {
			const { data: ent, error: errE } = await supabase
				.from("entregas_documento_alumno")
				.select("cuenta_id")
				.in("cuenta_id", cuentaIds);
			if (!errE && ent) {
				cuentasConDoc = new Set(ent.map((e) => e.cuenta_id as string));
			}
		}

		function alumnosEnSeccion(igId: string | null, g: FilaToken | null) {
			return filas.filter((p) => {
				if (igId && p.institucion_grupo_id === igId) {
					return true;
				}
				if (g && p.grupo_token_id === g.id) {
					return true;
				}
				return false;
			});
		}

		function armarResumenFila(g: FilaToken | null, gradoTok: string, grupoLetra: string, igId: string | null) {
			const alumnos = alumnosEnSeccion(igId, g);
			const totalAlumnos = alumnos.length;
			const efectivos = alumnos.map((row) =>
				gradoMostradoParaAlumno(row.grado_alumno, gradoTok),
			);
			const unicos = [...new Set(efectivos)];
			unicos.sort((a, b) => {
				const na = Number.parseInt(a, 10);
				const nb = Number.parseInt(b, 10);
				return (Number.isNaN(na) ? 0 : na) - (Number.isNaN(nb) ? 0 : nb);
			});
			const gradoResumen =
				totalAlumnos === 0 ? gradoTok : unicos.length > 0 ? unicos.join(" · ") : gradoTok;
			let conCuenta = 0;
			let conExpediente = 0;
			for (const a of alumnos) {
				const cid = obtenerCuentaId(a.cuentas_alumno);
				if (cid) {
					conCuenta += 1;
					if (cuentasConDoc.has(cid)) {
						conExpediente += 1;
					}
				}
			}
			return {
				id: g?.id ?? null,
				institucionGrupoId: igId,
				tieneToken: !!g,
				grado: gradoTok,
				grupo: grupoLetra,
				claveAcceso: g ? String(g.clave_acceso) : "",
				fechaLimiteEntrega: g?.fecha_limite_entrega ?? null,
				creadoEn: g?.creado_en ?? null,
				totalAlumnos,
				conCuenta,
				conExpediente,
				gradoResumen,
			};
		}

		const resumen = listaIg.map((ig) => {
			const g = tokenPorSeccion.get(ig.id) ?? null;
			const gradoTok = String(ig.grado);
			const grupoLetra = String(ig.grupo).toUpperCase();
			return armarResumenFila(g, gradoTok, grupoLetra, ig.id);
		});

		const idsEnResumen = new Set(
			resumen.map((r) => r.id).filter((x): x is string => typeof x === "string" && x.length > 0),
		);
		for (const t of tokens) {
			if (idsEnResumen.has(t.id)) {
				continue;
			}
			const { grado: gd, grupo: gp } = normalizarGradoGrupoToken(t);
			const gradoTok = gd || "1";
			resumen.push(armarResumenFila(t, gradoTok, gp || t.grupo, t.institucion_grupo_id));
		}

		resumen.sort((a, b) => {
			const na = Number.parseInt(String(a.grado), 10) || 0;
			const nb = Number.parseInt(String(b.grado), 10) || 0;
			if (na !== nb) {
				return na - nb;
			}
			return String(a.grupo).localeCompare(String(b.grupo), "es");
		});

		const tokensProcesadosEnIg = new Set<string>();
		for (const ig of listaIg) {
			const gTok = tokenPorSeccion.get(ig.id);
			if (gTok) {
				tokensProcesadosEnIg.add(gTok.id);
			}
		}

		const resumenAlumnosDesdeIg = listaIg.flatMap((ig) => {
			const g = tokenPorSeccion.get(ig.id) ?? null;
			const alumnos = alumnosEnSeccion(ig.id, g);
			const gradoTok = String(ig.grado ?? "").trim() || "1";
			const porGrado = new Map<
				string,
				{
					totalAlumnos: number;
					conExpediente: number;
					conCarrera: number;
					carreraIds: Set<string>;
				}
			>();
			for (const a of alumnos) {
				const gradoEf = gradoMostradoParaAlumno(a.grado_alumno, gradoTok);
				const actual = porGrado.get(gradoEf) ?? {
					totalAlumnos: 0,
					conExpediente: 0,
					conCarrera: 0,
					carreraIds: new Set<string>(),
				};
				actual.totalAlumnos += 1;
				const cid = obtenerCuentaId(a.cuentas_alumno);
				if (cid) {
					if (cuentasConDoc.has(cid)) {
						actual.conExpediente += 1;
					}
				}
				const carreraRaw =
					a.carrera_id != null && String(a.carrera_id).trim() !== ""
						? String(a.carrera_id).trim()
						: null;
				if (alumnoRequiereCarrera(gradoEf) && carreraRaw) {
					actual.conCarrera += 1;
					actual.carreraIds.add(carreraRaw);
				}
				porGrado.set(gradoEf, actual);
			}

			const gradoNominalIg = String(ig.grado ?? "").trim() || "1";
			if (porGrado.size > 0 && !porGrado.has(gradoNominalIg)) {
				porGrado.set(gradoNominalIg, {
					totalAlumnos: 0,
					conExpediente: 0,
					conCarrera: 0,
					carreraIds: new Set<string>(),
				});
			}

			if (porGrado.size === 0) {
				return [
					{
						id: `${String(g?.id ?? ig.id)}::${gradoTok}`,
						grupoTokenId: g?.id ?? null,
						institucionGrupoId: ig.id,
						grado: gradoTok,
						gradoResumen: gradoTok,
						grupo: String(ig.grupo),
						claveAcceso: g ? String(g.clave_acceso) : "",
						fechaLimiteEntrega: g?.fecha_limite_entrega ?? null,
						creadoEn: g?.creado_en ?? null,
						totalAlumnos: 0,
						conExpediente: 0,
						conCarrera: 0,
						carreraIds: [] as string[],
					},
				];
			}

			return [...porGrado.entries()]
				.sort((a, b) => Number.parseInt(a[0], 10) - Number.parseInt(b[0], 10))
				.map(([gradoEf, stats]) => ({
					id: `${String(g?.id ?? ig.id)}::${gradoEf}`,
					grupoTokenId: g?.id ?? null,
					institucionGrupoId: ig.id,
					grado: gradoEf,
					gradoResumen: gradoEf,
					grupo: String(ig.grupo),
					claveAcceso: g ? String(g.clave_acceso) : "",
					fechaLimiteEntrega: g?.fecha_limite_entrega ?? null,
					creadoEn: g?.creado_en ?? null,
					totalAlumnos: stats.totalAlumnos,
					conExpediente: stats.conExpediente,
					conCarrera: stats.conCarrera,
					carreraIds: [...stats.carreraIds].sort(),
				}));
		});

		const resumenAlumnosHuerfanos = tokens
			.filter((tok) => !tokensProcesadosEnIg.has(tok.id))
			.flatMap((g) => {
				const alumnos = filas.filter((p) => p.grupo_token_id === g.id);
				const gradoTok = String(g.grado ?? "").trim() || "1";
				const porGrado = new Map<
					string,
					{
						totalAlumnos: number;
						conExpediente: number;
						conCarrera: number;
						carreraIds: Set<string>;
					}
				>();
				for (const a of alumnos) {
					const gradoEf = gradoMostradoParaAlumno(a.grado_alumno, gradoTok);
					const actual = porGrado.get(gradoEf) ?? {
						totalAlumnos: 0,
						conExpediente: 0,
						conCarrera: 0,
						carreraIds: new Set<string>(),
					};
					actual.totalAlumnos += 1;
					const cid = obtenerCuentaId(a.cuentas_alumno);
					if (cid) {
						if (cuentasConDoc.has(cid)) {
							actual.conExpediente += 1;
						}
					}
					const carreraRaw =
						a.carrera_id != null && String(a.carrera_id).trim() !== ""
							? String(a.carrera_id).trim()
							: null;
					if (alumnoRequiereCarrera(gradoEf) && carreraRaw) {
						actual.conCarrera += 1;
						actual.carreraIds.add(carreraRaw);
					}
					porGrado.set(gradoEf, actual);
				}

				if (porGrado.size > 0 && !porGrado.has(gradoTok)) {
					porGrado.set(gradoTok, {
						totalAlumnos: 0,
						conExpediente: 0,
						conCarrera: 0,
						carreraIds: new Set<string>(),
					});
				}

				if (porGrado.size === 0) {
					return [
						{
							id: `${String(g.id)}::${gradoTok}`,
							grupoTokenId: g.id,
							institucionGrupoId: g.institucion_grupo_id,
							grado: gradoTok,
							gradoResumen: gradoTok,
							grupo: g.grupo,
							claveAcceso: g.clave_acceso,
							fechaLimiteEntrega: g.fecha_limite_entrega,
							creadoEn: g.creado_en,
							totalAlumnos: 0,
							conExpediente: 0,
							conCarrera: 0,
							carreraIds: [] as string[],
						},
					];
				}

				return [...porGrado.entries()]
					.sort((a, b) => Number.parseInt(a[0], 10) - Number.parseInt(b[0], 10))
					.map(([gradoEf, stats]) => ({
						id: `${String(g.id)}::${gradoEf}`,
						grupoTokenId: g.id,
						institucionGrupoId: g.institucion_grupo_id,
						grado: gradoEf,
						gradoResumen: gradoEf,
						grupo: g.grupo,
						claveAcceso: g.clave_acceso,
						fechaLimiteEntrega: g.fecha_limite_entrega,
						creadoEn: g.creado_en,
						totalAlumnos: stats.totalAlumnos,
						conExpediente: stats.conExpediente,
						conCarrera: stats.conCarrera,
						carreraIds: [...stats.carreraIds].sort(),
					}));
			});

		const resumenAlumnos = [...resumenAlumnosDesdeIg, ...resumenAlumnosHuerfanos];

		return NextResponse.json({ grupos: resumen, gruposAlumnos: resumenAlumnos });
	} catch (e) {
		console.error("orientador grupos", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
