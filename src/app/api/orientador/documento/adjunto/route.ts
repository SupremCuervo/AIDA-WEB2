import { NextResponse } from "next/server";
import {
	eliminarEntregaPorCuentaYTipo,
	upsertEntregaAdjuntoOrientador,
} from "@/lib/alumno/entregas-documento";
import { parseCamposOcrDesdeJson } from "@/lib/ocr/campos-ocr-vista";
import { ESTADOS_ENTREGA_DOCUMENTO } from "@/lib/alumno/estado-documento";
import {
	crearTipoAdjuntoOrientador,
	esTipoAdjuntoOrientador,
	nombreRutaStorageAdjuntoOrientador,
	slugificar,
} from "@/lib/nombre-archivo";
import {
	bufferImagenJpegPngAPdf,
	esImagenConvertibleApdf,
} from "@/lib/archivos/imagen-a-pdf-buffer";
import { registrarLogApi } from "@/lib/orientador/audit-registrar";
import { mensajeCausaParaUsuario } from "@/lib/mensaje-red-amigable";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

const TAMANO_MAX_BYTES = 15 * 1024 * 1024;
const ETIQUETA_MAX = 80;
const OCR_JSON_MAX_CHARS = 120_000;

function extensionDesdeNombre(nombreArchivo: string): string {
	const i = nombreArchivo.lastIndexOf(".");
	if (i < 0 || i === nombreArchivo.length - 1) {
		return "";
	}
	return nombreArchivo.slice(i + 1);
}

export async function POST(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const bucket = process.env.AIDA_DOCUMENTOS_BUCKET?.trim();
	if (!bucket) {
		return NextResponse.json(
			{ error: "AIDA_DOCUMENTOS_BUCKET no configurado" },
			{ status: 503 },
		);
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
	}

	const cuentaIdRaw = formData.get("cuentaId");
	const etiquetaRaw = formData.get("etiqueta");
	const archivo = formData.get("archivo");
	const ocrCamposJsonRaw = formData.get("ocrCamposJson");
	const ocrTramiteRaw = formData.get("ocrTramite");

	const cuentaId = typeof cuentaIdRaw === "string" ? cuentaIdRaw.trim() : "";
	if (!cuentaId) {
		return NextResponse.json({ error: "cuentaId obligatorio" }, { status: 400 });
	}
	let etiqueta: string | null =
		typeof etiquetaRaw === "string" ? etiquetaRaw.trim().slice(0, ETIQUETA_MAX) : "";
	if (etiqueta === "") {
		etiqueta = "Documento adicional";
	}
	if (!(archivo instanceof File) || archivo.size === 0) {
		return NextResponse.json({ error: "Archivo obligatorio" }, { status: 400 });
	}
	if (archivo.size > TAMANO_MAX_BYTES) {
		return NextResponse.json({ error: "Archivo demasiado grande (máx. 15 MB)" }, { status: 400 });
	}

	const tipoNuevo = crearTipoAdjuntoOrientador();

	let ocrCamposParsed: ReturnType<typeof parseCamposOcrDesdeJson> = null;
	let ocrTramiteAdj: string | null = null;
	if (typeof ocrTramiteRaw === "string" && ocrTramiteRaw.trim() !== "") {
		ocrTramiteAdj = ocrTramiteRaw.trim().slice(0, 64);
	}
	let ocrErrorAdj: string | null = null;
	if (typeof ocrCamposJsonRaw === "string" && ocrCamposJsonRaw.length > 0) {
		if (ocrCamposJsonRaw.length > OCR_JSON_MAX_CHARS) {
			return NextResponse.json({ error: "ocrCamposJson demasiado grande" }, { status: 400 });
		}
		try {
			const parsed = JSON.parse(ocrCamposJsonRaw) as unknown;
			ocrCamposParsed = parseCamposOcrDesdeJson(parsed);
		} catch {
			return NextResponse.json({ error: "ocrCamposJson no es JSON válido" }, { status: 400 });
		}
		if (!ocrCamposParsed) {
			ocrErrorAdj = "ocr_sin_campos_validos";
		}
	}
	const ahoraOcr = new Date().toISOString();
	const ocrExtraidoAdj = ocrCamposParsed ? ahoraOcr : null;

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: cuenta, error: errC } = await supabase
			.from("cuentas_alumno")
			.select("id, padron_alumnos ( nombre_completo )")
			.eq("id", cuentaId)
			.maybeSingle();

		if (errC || !cuenta) {
			return NextResponse.json(
				{ error: "La cuenta del alumno no existe (debe haber entrado al menos una vez)." },
				{ status: 404 },
			);
		}

		const padron = cuenta.padron_alumnos as unknown as { nombre_completo: string };
		const nombreCompleto = padron?.nombre_completo ?? "";
		if (!nombreCompleto) {
			return NextResponse.json({ error: "No se pudo resolver el nombre del padrón" }, { status: 500 });
		}

		let bytes: Uint8Array;
		try {
			bytes = new Uint8Array(await archivo.arrayBuffer());
		} catch (e) {
			console.error("orientador adjunto lectura archivo", e);
			return NextResponse.json({ error: "No se pudo leer el archivo" }, { status: 400 });
		}

		let uploadBuf = Buffer.from(bytes);
		let contentType = archivo.type || "application/octet-stream";
		let extFinal = extensionDesdeNombre(archivo.name);
		if (esImagenConvertibleApdf(contentType)) {
			try {
				const pdfBytes = await bufferImagenJpegPngAPdf(uploadBuf, contentType);
				uploadBuf = Buffer.from(pdfBytes);
				contentType = "application/pdf";
				extFinal = "pdf";
			} catch (e) {
				console.error("orientador adjunto imagen a pdf", e);
				return NextResponse.json(
					{ error: "No se pudo convertir la imagen a PDF. Usa JPG o PNG." },
					{ status: 400 },
				);
			}
		}

		const slugAlumno = slugificar(nombreCompleto);
		let nombreTecnico: string;
		try {
			nombreTecnico = nombreRutaStorageAdjuntoOrientador(
				slugAlumno,
				etiqueta,
				tipoNuevo,
				extFinal || "pdf",
			);
		} catch (e) {
			const msg = mensajeCausaParaUsuario(e);
			return NextResponse.json(
				{ error: msg === "Ocurrió un error inesperado." ? "Nombre inválido" : msg },
				{ status: 400 },
			);
		}

		const { error: errS } = await supabase.storage.from(bucket).upload(nombreTecnico, uploadBuf, {
			contentType,
			upsert: true,
		});
		if (errS) {
			console.error("orientador adjunto storage", errS);
			return NextResponse.json({ error: "No se pudo guardar el archivo" }, { status: 500 });
		}

		const { error: errDb } = await upsertEntregaAdjuntoOrientador(supabase, {
			cuentaId,
			tipoDocumento: tipoNuevo,
			estado: ESTADOS_ENTREGA_DOCUMENTO.PENDIENTE_REVISION_MANUAL,
			rutaStorage: nombreTecnico,
			validacionAutomatica: false,
			etiquetaPersonalizada: etiqueta,
			ocrCampos: ocrCamposParsed,
			ocrTramite: ocrTramiteAdj,
			ocrExtraidoEn: ocrExtraidoAdj,
			ocrError: ocrErrorAdj,
		});
		if (errDb) {
			await supabase.storage.from(bucket).remove([nombreTecnico]);
			return NextResponse.json({ error: mensajeCausaParaUsuario(errDb) }, { status: 500 });
		}

		return NextResponse.json({
			ok: true,
			tipoDocumento: tipoNuevo,
			nombreTecnico,
			etiqueta,
		});
	} catch (e) {
		console.error("orientador adjunto POST", e);
		return NextResponse.json({ error: "Error al subir" }, { status: 500 });
	}
}

export async function DELETE(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const bucket = process.env.AIDA_DOCUMENTOS_BUCKET?.trim();
	if (!bucket) {
		return NextResponse.json(
			{ error: "AIDA_DOCUMENTOS_BUCKET no configurado" },
			{ status: 503 },
		);
	}

	let body: { cuentaId?: string; tipoDocumento?: string };
	try {
		body = (await request.json()) as { cuentaId?: string; tipoDocumento?: string };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const cuentaId = typeof body.cuentaId === "string" ? body.cuentaId.trim() : "";
	const tipoDocumento = typeof body.tipoDocumento === "string" ? body.tipoDocumento.trim() : "";
	if (!cuentaId || !esTipoAdjuntoOrientador(tipoDocumento)) {
		return NextResponse.json({ error: "Parámetros no válidos" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { error } = await eliminarEntregaPorCuentaYTipo(supabase, bucket, cuentaId, tipoDocumento);
		if (error) {
			return NextResponse.json({ error: mensajeCausaParaUsuario(error) }, { status: 400 });
		}
		await registrarLogApi({
			orientador,
			accion: `Documento de orientador eliminado (${tipoDocumento})`,
			entidad: "entregas_documento_alumno",
			entidadId: cuentaId,
			detalle: { cuenta_id: cuentaId, tipo_documento: tipoDocumento },
		});
		return NextResponse.json({ ok: true });
	} catch (e) {
		console.error("orientador adjunto DELETE", e);
		return NextResponse.json({ error: "Error al eliminar" }, { status: 500 });
	}
}
