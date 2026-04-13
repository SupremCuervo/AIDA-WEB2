import { NextResponse } from "next/server";
import { gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";
import { normalizarMatriculaPayload } from "@/lib/padron/matricula-padron";
import { alumnoRequiereCarrera } from "@/lib/padron/requiere-carrera";
import { normalizarNombrePadronMatch } from "@/lib/orientador/nombre-padron-match";
import {
	padronPerteneceASeccion,
	resolverGrupoSeccionPorId,
	type ResolucionGrupoSeccion,
} from "@/lib/orientador/resolver-grupo-seccion";
import { leerFilasXlsx } from "@/lib/orientador/xlsx-lectura";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function normalizarEncabezado(texto: string): string {
	return texto
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "")
		.trim();
}

function aplicarFiltroPadronPorResolucion<
	Q extends { eq: (column: string, value: string) => Q; or: (filters: string) => Q },
>(q: Q, resolucion: ResolucionGrupoSeccion): Q {
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

	const supabase = obtenerClienteSupabaseAdmin();
	const resGrupo = await resolverGrupoSeccionPorId(supabase, grupoTokenId);
	if (!resGrupo.ok) {
		return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
	}
	const { resolucion } = resGrupo;
	const gradoTok = String(resolucion.grado ?? "").trim() || "1";

	const ct = request.headers.get("content-type") ?? "";

	if (ct.includes("multipart/form-data")) {
		try {
			const form = await request.formData();
			const archivo = form.get("archivo");
			if (!(archivo instanceof File)) {
				return NextResponse.json({ error: "Adjunta un archivo XLSX" }, { status: 400 });
			}
			if (!archivo.name.toLowerCase().endsWith(".xlsx")) {
				return NextResponse.json({ error: "El archivo debe ser .xlsx" }, { status: 400 });
			}

			const filasXlsx = await leerFilasXlsx(archivo);
			if (filasXlsx.length < 2) {
				return NextResponse.json({ error: "El XLSX no tiene filas de datos" }, { status: 400 });
			}

			const headers = (filasXlsx[0] ?? []).map(normalizarEncabezado);
			const idxNombre = headers.findIndex((h) =>
				["nombrecompleto", "nombre", "alumno", "estudiante", "name"].includes(h),
			);
			const idxMat = headers.findIndex((h) =>
				["matricula", "matrícula", "matriculaescolar", "no_matricula", "numeromatricula"].includes(h),
			);
			const colNombre = idxNombre >= 0 ? idxNombre : 0;
			const colMat = idxMat >= 0 ? idxMat : 1;

			let qP = supabase
				.from("padron_alumnos")
				.select("id, nombre_completo, grado_alumno")
				.is("archivo_muerto_en", null);
			qP = aplicarFiltroPadronPorResolucion(qP, resolucion);
			const { data: padrones, error: errP } = await qP;

			if (errP) {
				console.error("matriculas xlsx padron", errP);
				return NextResponse.json({ error: "No se pudo leer el padrón" }, { status: 500 });
			}

			const porNombre = new Map<string, string[]>();
			for (const p of padrones ?? []) {
				const clave = normalizarNombrePadronMatch(String(p.nombre_completo ?? ""));
				if (!clave) {
					continue;
				}
				const arr = porNombre.get(clave) ?? [];
				arr.push(String(p.id));
				porNombre.set(clave, arr);
			}

			let actualizados = 0;
			let omitidas = 0;
			let sinCoincidencia = 0;
			let ambiguos = 0;
			let gradoInvalido = 0;

			for (const row of filasXlsx.slice(1)) {
				const nombreRaw = (row[colNombre] ?? "").trim();
				const matRaw = (row[colMat] ?? "").trim();
				if (!nombreRaw) {
					omitidas += 1;
					continue;
				}
				const clave = normalizarNombrePadronMatch(nombreRaw);
				const ids = porNombre.get(clave);
				if (!ids || ids.length === 0) {
					sinCoincidencia += 1;
					continue;
				}
				if (ids.length > 1) {
					ambiguos += 1;
					continue;
				}
				const padronId = ids[0];
				const filaPadron = (padrones ?? []).find((p) => String(p.id) === padronId);
				if (!filaPadron) {
					sinCoincidencia += 1;
					continue;
				}
				const gm = gradoMostradoParaAlumno(filaPadron.grado_alumno, gradoTok);
				if (!alumnoRequiereCarrera(gm)) {
					gradoInvalido += 1;
					continue;
				}
				const m = normalizarMatriculaPayload(matRaw === "" ? null : matRaw);
				if (!m.ok) {
					omitidas += 1;
					continue;
				}
				const { error: errU } = await supabase
					.from("padron_alumnos")
					.update({ matricula: m.valor })
					.eq("id", padronId);
				if (errU) {
					console.error("matricula xlsx update", errU);
					omitidas += 1;
					continue;
				}
				actualizados += 1;
			}

			return NextResponse.json({
				ok: true,
				resumen: {
					actualizados,
					omitidas,
					sinCoincidencia,
					ambiguos,
					gradoInvalido,
				},
			});
		} catch (e) {
			console.error("matriculas xlsx", e);
			return NextResponse.json({ error: "Error al procesar el XLSX" }, { status: 500 });
		}
	}

	let cuerpo: { actualizaciones?: Array<{ padronId?: string; matricula?: string | null }> };
	try {
		cuerpo = (await request.json()) as {
			actualizaciones?: Array<{ padronId?: string; matricula?: string | null }>;
		};
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const lista = Array.isArray(cuerpo.actualizaciones) ? cuerpo.actualizaciones : [];
	if (lista.length === 0) {
		return NextResponse.json({ error: "actualizaciones vacío" }, { status: 400 });
	}

	let actualizados = 0;
	let omitidas = 0;
	const errores: string[] = [];

	for (const u of lista) {
		const pid = typeof u.padronId === "string" ? u.padronId.trim() : "";
		if (!pid) {
			omitidas += 1;
			continue;
		}
		const { data: row, error: errR } = await supabase
			.from("padron_alumnos")
			.select("id, grupo_token_id, institucion_grupo_id, grado_alumno")
			.eq("id", pid)
			.maybeSingle();
		if (
			errR ||
			!row ||
			!padronPerteneceASeccion(
				{
					grupo_token_id: row.grupo_token_id as string | null,
					institucion_grupo_id: row.institucion_grupo_id as string | null,
				},
				resolucion,
			)
		) {
			omitidas += 1;
			continue;
		}
		const gm = gradoMostradoParaAlumno(row.grado_alumno, gradoTok);
		if (!alumnoRequiereCarrera(gm)) {
			omitidas += 1;
			continue;
		}
		const m = normalizarMatriculaPayload(
			Object.prototype.hasOwnProperty.call(u, "matricula") ? u.matricula : undefined,
		);
		if (!m.ok) {
			errores.push(`${pid}: ${m.error}`);
			omitidas += 1;
			continue;
		}
		const { error: errU } = await supabase
			.from("padron_alumnos")
			.update({ matricula: m.valor })
			.eq("id", pid);
		if (errU) {
			console.error("matricula lote update", errU);
			omitidas += 1;
			continue;
		}
		actualizados += 1;
	}

	return NextResponse.json({
		ok: true,
		actualizados,
		omitidas,
		errores: errores.slice(0, 20),
	});
}
