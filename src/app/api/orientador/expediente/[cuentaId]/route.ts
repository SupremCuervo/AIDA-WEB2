import { NextResponse } from "next/server";
import { esEstadoEntregaPersistido, type EstadoEntregaDocumentoUi } from "@/lib/alumno/estado-documento";
import { listarEntregasPorCuenta } from "@/lib/alumno/entregas-documento";
import { gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";
import { alumnoRequiereCarrera } from "@/lib/padron/requiere-carrera";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import {
	esTipoAdjuntoOrientador,
	TIPOS_DOCUMENTO,
	type TipoDocumentoClave,
} from "@/lib/nombre-archivo";

export const runtime = "nodejs";

const ETIQUETAS: Record<TipoDocumentoClave, string> = {
	acta_nacimiento: "Acta de nacimiento",
	curp: "CURP",
	ine_tutor: "INE del tutor",
	comprobante_domicilio: "Comprobante de domicilio",
	certificado_medico: "Certificado médico",
};

export async function GET(
	_request: Request,
	ctx: { params: Promise<{ cuentaId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const { cuentaId } = await ctx.params;
	if (!cuentaId) {
		return NextResponse.json({ error: "Cuenta no válida" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: cuenta, error } = await supabase
			.from("cuentas_alumno")
			.select(`
				id,
				padron_alumnos (
					id,
					nombre_completo,
					grupo_token_id,
					institucion_grupo_id,
					grado_alumno,
					carrera_id,
					matricula
				)
			`)
			.eq("id", cuentaId)
			.maybeSingle();

		if (error || !cuenta) {
			return NextResponse.json({ error: "Alumno no encontrado" }, { status: 404 });
		}

		const padron = cuenta.padron_alumnos as unknown as {
			id: string;
			nombre_completo: string;
			grupo_token_id: string | null;
			institucion_grupo_id: string | null;
			grado_alumno: string | null;
			carrera_id: string | null;
			matricula: string | null;
		};

		let gradoToken = "";
		let grupoLetra = "";
		if (padron.grupo_token_id) {
			const { data: tok, error: errTok } = await supabase
				.from("grupo_tokens")
				.select("grado, grupo")
				.eq("id", padron.grupo_token_id)
				.maybeSingle();
			if (!errTok && tok) {
				gradoToken = tok.grado != null ? String(tok.grado) : "";
				grupoLetra = tok.grupo != null ? String(tok.grupo) : "";
			}
		} else if (padron.institucion_grupo_id) {
			const { data: ig, error: errIg } = await supabase
				.from("institucion_grupos")
				.select("grado, grupo")
				.eq("id", padron.institucion_grupo_id)
				.maybeSingle();
			if (!errIg && ig) {
				gradoToken = ig.grado != null ? String(ig.grado) : "";
				grupoLetra = ig.grupo != null ? String(ig.grupo) : "";
			}
		}

		const gradoMostrado = gradoMostradoParaAlumno(padron.grado_alumno, gradoToken);
		const requiereCarrera = alumnoRequiereCarrera(gradoMostrado);

		let carreraNombre: string | null = null;
		let carreraCodigo: string | null = null;
		const carreraIdRaw =
			padron.carrera_id != null && String(padron.carrera_id).trim() !== ""
				? String(padron.carrera_id).trim()
				: null;
		if (carreraIdRaw && requiereCarrera) {
			const { data: car } = await supabase
				.from("carreras")
				.select("nombre, codigo")
				.eq("id", carreraIdRaw)
				.maybeSingle();
			if (car) {
				carreraNombre = car.nombre != null ? String(car.nombre) : null;
				carreraCodigo = car.codigo != null ? String(car.codigo) : null;
			}
		}

		const matriculaMostrada =
			requiereCarrera &&
			padron.matricula != null &&
			String(padron.matricula).trim() !== ""
				? String(padron.matricula).trim()
				: null;

		const { data: carrerasCatalogo, error: errCat } = await supabase
			.from("carreras")
			.select("id, codigo, nombre")
			.order("nombre", { ascending: true });
		if (errCat) {
			console.error("orientador expediente carreras", errCat);
		}

		const filas = await listarEntregasPorCuenta(supabase, cuentaId);
		const porTipo = new Map(filas.map((f) => [f.tipo_documento, f]));

		const documentos = (Object.keys(TIPOS_DOCUMENTO) as TipoDocumentoClave[]).map((tipo) => {
			const f = porTipo.get(tipo);
			let estado: EstadoEntregaDocumentoUi = "pendiente_carga";
			let motivoRechazo: string | null = null;
			let validacionAutomatica = false;
			if (f && esEstadoEntregaPersistido(f.estado)) {
				estado = f.estado;
				motivoRechazo = f.motivo_rechazo;
				validacionAutomatica = f.validacion_automatica;
			} else if (f?.ruta_storage) {
				estado = "pendiente_revision_manual";
			}
			return {
				tipo,
				etiqueta: ETIQUETAS[tipo],
				estado,
				motivoRechazo,
				puedeDescargar: Boolean(f?.ruta_storage),
				validacionAutomatica,
				ocrCampos: f?.ocr_campos ?? null,
				ocrTramite: f?.ocr_tramite ?? null,
				ocrExtraidoEn: f?.ocr_extraido_en ?? null,
				ocrError: f?.ocr_error ?? null,
			};
		});

		const documentosExtras = filas
			.filter((f) => esTipoAdjuntoOrientador(f.tipo_documento))
			.map((f) => {
				let estado: EstadoEntregaDocumentoUi = "pendiente_carga";
				let motivoRechazo: string | null = null;
				let validacionAutomatica = false;
				if (esEstadoEntregaPersistido(f.estado)) {
					estado = f.estado;
					motivoRechazo = f.motivo_rechazo;
					validacionAutomatica = f.validacion_automatica;
				} else if (f.ruta_storage) {
					estado = "pendiente_revision_manual";
				}
				const etiqueta =
					f.etiqueta_personalizada != null && String(f.etiqueta_personalizada).trim() !== ""
						? String(f.etiqueta_personalizada).trim()
						: "Documento adicional";
				return {
					tipo: f.tipo_documento,
					etiqueta,
					estado,
					motivoRechazo,
					puedeDescargar: Boolean(f.ruta_storage),
					validacionAutomatica,
					puedeEliminarOrientador: true,
					ocrCampos: f.ocr_campos ?? null,
					ocrTramite: f.ocr_tramite ?? null,
					ocrExtraidoEn: f.ocr_extraido_en ?? null,
					ocrError: f.ocr_error ?? null,
				};
			});

		return NextResponse.json({
			alumno: {
				cuentaId: cuenta.id,
				padronId: padron.id,
				grupoTokenId: padron.grupo_token_id,
				institucionGrupoId: padron.institucion_grupo_id,
				nombreCompleto: padron.nombre_completo,
				grado: gradoMostrado,
				gradoToken,
				gradoAlumno: padron.grado_alumno,
				grupo: grupoLetra,
				requiereCarrera,
				carreraId: requiereCarrera ? carreraIdRaw : null,
				carreraNombre: requiereCarrera ? carreraNombre : null,
				carreraCodigo: requiereCarrera ? carreraCodigo : null,
				matricula: matriculaMostrada,
			},
			carrerasCatalogo: (carrerasCatalogo ?? []).map((c) => ({
				id: String(c.id),
				codigo: String(c.codigo),
				nombre: String(c.nombre),
			})),
			documentos,
			documentosExtras,
		});
	} catch (e) {
		console.error("orientador expediente", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
