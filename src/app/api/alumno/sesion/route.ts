import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { contarDocumentosSubidosDesdeStorage } from "@/lib/alumno/contar-documentos-subidos";
import { contarEntregasPorCuenta } from "@/lib/alumno/entregas-documento";
import { COOKIE_ALUMNO, verificarTokenAlumno } from "@/lib/alumno/jwt-cookies";
import {
	jsonAlumnoGrupoVencidoCierraSesion,
	padronPerteneceAGrupoVencido,
} from "@/lib/alumno/requiere-grupo-vigente";
import { jsonAlumnoArchivoMuertoCierraSesion } from "@/lib/padron/archivo-muerto";
import { gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";
import { alumnoRequiereCarrera } from "@/lib/padron/requiere-carrera";
import { TIPOS_DOCUMENTO } from "@/lib/nombre-archivo";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET() {
	const jar = await cookies();
	const token = jar.get(COOKIE_ALUMNO)?.value;
	if (!token) {
		return NextResponse.json({ autenticado: false }, { status: 401 });
	}
	try {
		const p = await verificarTokenAlumno(token);
		const supabase = obtenerClienteSupabaseAdmin();
		if (await padronPerteneceAGrupoVencido(supabase, p.padronId)) {
			return jsonAlumnoGrupoVencidoCierraSesion();
		}

		const { data: padGrado, error: errPadG } = await supabase
			.from("padron_alumnos")
			.select("grado_alumno, grupo_token_id, institucion_grupo_id, carrera_id, archivo_muerto_en")
			.eq("id", p.padronId)
			.maybeSingle();

		if (!errPadG && padGrado?.archivo_muerto_en != null) {
			return jsonAlumnoArchivoMuertoCierraSesion();
		}

		let gradoMostrado = p.grado;
		let carreraId: string | null = null;
		let carreraNombre: string | null = null;
		let carreraCodigo: string | null = null;
		let carrerasOpciones: { id: string; codigo: string; nombre: string }[] = [];

		if (!errPadG && padGrado) {
			let gradoToken = p.grado;
			if (padGrado.grupo_token_id) {
				const { data: tok, error: errTok } = await supabase
					.from("grupo_tokens")
					.select("grado")
					.eq("id", padGrado.grupo_token_id)
					.maybeSingle();
				if (!errTok && tok?.grado != null && String(tok.grado).trim() !== "") {
					gradoToken = String(tok.grado).trim();
				}
			} else if (padGrado.institucion_grupo_id) {
				const { data: ig, error: errIg } = await supabase
					.from("institucion_grupos")
					.select("grado")
					.eq("id", padGrado.institucion_grupo_id)
					.maybeSingle();
				if (!errIg && ig?.grado != null && String(ig.grado).trim() !== "") {
					gradoToken = String(ig.grado).trim();
				}
			}
			gradoMostrado = gradoMostradoParaAlumno(padGrado.grado_alumno, gradoToken);
			carreraId =
				padGrado.carrera_id != null && String(padGrado.carrera_id).trim() !== ""
					? String(padGrado.carrera_id).trim()
					: null;

			const requiereCarrera = alumnoRequiereCarrera(gradoMostrado);
			const { data: cats, error: errCat } = await supabase
				.from("carreras")
				.select("id, codigo, nombre")
				.order("nombre", { ascending: true });

			if (!errCat && cats) {
				carrerasOpciones = cats.map((c) => ({
					id: String(c.id),
					codigo: String(c.codigo),
					nombre: String(c.nombre),
				}));
				if (carreraId) {
					const hit = carrerasOpciones.find((x) => x.id === carreraId);
					if (hit) {
						carreraNombre = hit.nombre;
						carreraCodigo = hit.codigo;
					}
				}
			} else if (errCat) {
				console.error("sesion lectura carreras", errCat);
			}

			if (!requiereCarrera) {
				carrerasOpciones = [];
				carreraId = null;
				carreraNombre = null;
				carreraCodigo = null;
			}
		} else if (errPadG) {
			console.error("sesion lectura grado_alumno", errPadG);
		}

		const documentosTotales = Object.keys(TIPOS_DOCUMENTO).length;
		let documentosSubidos = 0;
		let porcentajeDocumentos = 0;
		const bucket = process.env.AIDA_DOCUMENTOS_BUCKET?.trim();
		try {
			const subidosDb = await contarEntregasPorCuenta(supabase, p.cuentaId);
			documentosSubidos = subidosDb;
			if (bucket && subidosDb === 0) {
				const r = await contarDocumentosSubidosDesdeStorage(
					supabase,
					bucket,
					p.nombreCompleto,
				);
				documentosSubidos = r.subidos;
			}
			porcentajeDocumentos =
				documentosTotales > 0
					? Math.round((documentosSubidos / documentosTotales) * 100)
					: 0;
		} catch (e) {
			console.error("sesion avance documentos", e);
		}
		return NextResponse.json({
			autenticado: true,
			nombreCompleto: p.nombreCompleto,
			grupo: p.grupo,
			grado: gradoMostrado,
			requiereCarrera: alumnoRequiereCarrera(gradoMostrado),
			carreraId,
			carreraNombre,
			carreraCodigo,
			carrerasOpciones,
			documentosTotales,
			documentosSubidos,
			porcentajeDocumentos,
		});
	} catch {
		return NextResponse.json({ autenticado: false }, { status: 401 });
	}
}
