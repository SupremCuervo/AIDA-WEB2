import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import {
	actualizarOcrCamposEnEntrega,
	listarEntregasPorCuenta,
} from "@/lib/alumno/entregas-documento";
import { COOKIE_ALUMNO, verificarTokenAlumno } from "@/lib/alumno/jwt-cookies";
import {
	jsonAlumnoGrupoVencidoCierraSesion,
	padronPerteneceAGrupoVencido,
} from "@/lib/alumno/requiere-grupo-vigente";
import { jsonAlumnoArchivoMuertoCierraSesion, padronEstaArchivado } from "@/lib/padron/archivo-muerto";
import {
	esEstadoEntregaPersistido,
	type EstadoEntregaDocumentoUi,
} from "@/lib/alumno/estado-documento";
import {
	esTipoDocumentoValido,
	TIPOS_DOCUMENTO,
	type TipoDocumentoClave,
} from "@/lib/nombre-archivo";
import {
	aplicarEdicionOcrCampos,
	parseCamposOcrDesdeJson,
} from "@/lib/ocr/campos-ocr-vista";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const OCR_BODY_MAX_CHARS = 120_000;

const ETIQUETAS: Record<TipoDocumentoClave, string> = {
	acta_nacimiento: "Acta de nacimiento",
	curp: "CURP",
	ine_tutor: "INE del tutor",
	comprobante_domicilio: "Comprobante de domicilio",
	certificado_medico: "Certificado médico",
};

export async function GET() {
	const jar = await cookies();
	const token = jar.get(COOKIE_ALUMNO)?.value;
	if (!token) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	try {
		const p = await verificarTokenAlumno(token);
		const supabase = obtenerClienteSupabaseAdmin();
		if (await padronPerteneceAGrupoVencido(supabase, p.padronId)) {
			return jsonAlumnoGrupoVencidoCierraSesion();
		}
		if (await padronEstaArchivado(supabase, p.padronId)) {
			return jsonAlumnoArchivoMuertoCierraSesion();
		}
		const filas = await listarEntregasPorCuenta(supabase, p.cuentaId);
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

		return NextResponse.json({ documentos });
	} catch (e) {
		console.error("documentos GET", e);
		return NextResponse.json({ error: "No se pudieron cargar los documentos" }, { status: 500 });
	}
}

export async function PATCH(request: Request) {
	const jar = await cookies();
	const token = jar.get(COOKIE_ALUMNO)?.value;
	if (!token) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	let texto: string;
	try {
		texto = await request.text();
	} catch {
		return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
	}
	if (texto.length > OCR_BODY_MAX_CHARS) {
		return NextResponse.json({ error: "Demasiados datos en la solicitud" }, { status: 400 });
	}

	let body: { tipoDocumento?: unknown; campos?: unknown };
	try {
		body = JSON.parse(texto) as typeof body;
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	if (typeof body.tipoDocumento !== "string" || !esTipoDocumentoValido(body.tipoDocumento)) {
		return NextResponse.json({ error: "tipoDocumento no válido" }, { status: 400 });
	}
	const tipo = body.tipoDocumento as TipoDocumentoClave;
	if (body.campos == null || typeof body.campos !== "object" || Array.isArray(body.campos)) {
		return NextResponse.json({ error: "campos debe ser un objeto" }, { status: 400 });
	}
	const camposIn = body.campos as Record<string, unknown>;
	if (Object.keys(camposIn).length > 80) {
		return NextResponse.json({ error: "Demasiados campos" }, { status: 400 });
	}

	try {
		const p = await verificarTokenAlumno(token);
		const supabase = obtenerClienteSupabaseAdmin();
		if (await padronPerteneceAGrupoVencido(supabase, p.padronId)) {
			return jsonAlumnoGrupoVencidoCierraSesion();
		}
		if (await padronEstaArchivado(supabase, p.padronId)) {
			return jsonAlumnoArchivoMuertoCierraSesion();
		}

		const { data: fila, error: errQ } = await supabase
			.from("entregas_documento_alumno")
			.select("ocr_campos")
			.eq("cuenta_id", p.cuentaId)
			.eq("tipo_documento", tipo)
			.maybeSingle();
		if (errQ) {
			console.error("documentos PATCH select", errQ);
			return NextResponse.json({ error: "No se pudo leer la entrega" }, { status: 500 });
		}
		const previo = parseCamposOcrDesdeJson(fila?.ocr_campos ?? null);
		const fusion = aplicarEdicionOcrCampos(previo, camposIn);
		if (Object.keys(fusion).length === 0) {
			return NextResponse.json({ error: "Indica al menos un campo" }, { status: 400 });
		}

		const jsonStr = JSON.stringify(fusion);
		if (jsonStr.length > OCR_BODY_MAX_CHARS) {
			return NextResponse.json({ error: "Los datos OCR superan el tamaño permitido" }, { status: 400 });
		}

		const { error: errU } = await actualizarOcrCamposEnEntrega(supabase, p.cuentaId, tipo, fusion);
		if (errU) {
			const msg = errU.message;
			if (msg.includes("No hay documento")) {
				return NextResponse.json({ error: msg }, { status: 404 });
			}
			console.error("documentos PATCH update", errU);
			return NextResponse.json({ error: "No se pudieron guardar los datos" }, { status: 500 });
		}

		return NextResponse.json({ ok: true, ocrCampos: fusion });
	} catch (e) {
		console.error("documentos PATCH", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
