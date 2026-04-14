import { NextResponse } from "next/server";
import {
	eliminarArchivosPreviosDelTipo,
	upsertEntregaDocumento,
} from "@/lib/alumno/entregas-documento";
import { ESTADOS_ENTREGA_DOCUMENTO } from "@/lib/alumno/estado-documento";
import {
	esTipoDocumentoValido,
	nombreArchivoEstandar,
	type TipoDocumentoClave,
} from "@/lib/nombre-archivo";
import {
	bufferImagenJpegPngAPdf,
	esImagenConvertibleApdf,
} from "@/lib/archivos/imagen-a-pdf-buffer";
import { mensajeCausaParaUsuario } from "@/lib/mensaje-red-amigable";
import { extraerCamposOcrServidor } from "@/lib/ocr/extract-servidor";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";
/** OCR en servidor puede acercarse a `timeoutMsOcrServidor()` (p. ej. 240 s). */
export const maxDuration = 300;

const TAMANO_MAX_BYTES = 15 * 1024 * 1024;

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
	const tipoRaw = formData.get("tipoDocumento");
	const archivo = formData.get("archivo");

	const cuentaId = typeof cuentaIdRaw === "string" ? cuentaIdRaw.trim() : "";
	if (!cuentaId) {
		return NextResponse.json({ error: "cuentaId obligatorio" }, { status: 400 });
	}
	if (typeof tipoRaw !== "string" || !esTipoDocumentoValido(tipoRaw)) {
		return NextResponse.json({ error: "tipoDocumento no válido" }, { status: 400 });
	}
	if (!(archivo instanceof File) || archivo.size === 0) {
		return NextResponse.json({ error: "Archivo obligatorio" }, { status: 400 });
	}
	if (archivo.size > TAMANO_MAX_BYTES) {
		return NextResponse.json({ error: "Archivo demasiado grande (máx. 15 MB)" }, { status: 400 });
	}

	const tipo = tipoRaw as TipoDocumentoClave;

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: cuenta, error: errC } = await supabase
			.from("cuentas_alumno")
			.select("id, padron_alumnos ( nombre_completo )")
			.eq("id", cuentaId)
			.maybeSingle();

		if (errC || !cuenta) {
			return NextResponse.json(
				{ error: "La cuenta del alumno no existe (debe haber entrado al menos una vez al sistema)." },
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
			console.error("orientador subir lectura archivo", e);
			return NextResponse.json({ error: "No se pudo leer el archivo" }, { status: 400 });
		}

		let uploadBuf = Buffer.from(bytes);
		let contentType = archivo.type || "application/octet-stream";
		let extFinal = extensionDesdeNombre(archivo.name);
		let nombreParaOcr = archivo.name;
		if (esImagenConvertibleApdf(contentType)) {
			try {
				const pdfBytes = await bufferImagenJpegPngAPdf(uploadBuf, contentType);
				uploadBuf = Buffer.from(pdfBytes);
				contentType = "application/pdf";
				extFinal = "pdf";
				nombreParaOcr = archivo.name.replace(/\.[^.]+$/i, "") + ".pdf";
			} catch (e) {
				console.error("orientador subir imagen a pdf", e);
				return NextResponse.json(
					{ error: "No se pudo convertir la imagen a PDF. Usa JPG o PNG." },
					{ status: 400 },
				);
			}
		}

		let nombreTecnico: string;
		try {
			nombreTecnico = nombreArchivoEstandar(nombreCompleto, tipo, extFinal || "pdf").nombreCompleto;
		} catch (e) {
			const msg = mensajeCausaParaUsuario(e);
			return NextResponse.json(
				{ error: msg === "Ocurrió un error inesperado." ? "Nombre inválido" : msg },
				{ status: 400 },
			);
		}

		const ocrRes = await extraerCamposOcrServidor(uploadBuf, nombreParaOcr, contentType, tipo);
		const ahoraIso = new Date().toISOString();
		const ocrCampos = ocrRes.ok ? ocrRes.fields : null;
		const ocrTramite = ocrRes.tramite;
		const ocrExtraidoEn = ocrRes.ok ? ahoraIso : null;
		const ocrError = ocrRes.ok ? null : ocrRes.error.slice(0, 500);

		await eliminarArchivosPreviosDelTipo(supabase, bucket, nombreCompleto, tipo);

		const { error: errS } = await supabase.storage.from(bucket).upload(nombreTecnico, uploadBuf, {
			contentType,
			upsert: true,
		});
		if (errS) {
			console.error("orientador subir storage", errS);
			return NextResponse.json({ error: "No se pudo guardar el archivo" }, { status: 500 });
		}

		const { error: errDb } = await upsertEntregaDocumento(supabase, {
			cuentaId,
			tipoDocumento: tipo,
			estado: ESTADOS_ENTREGA_DOCUMENTO.PENDIENTE_REVISION_MANUAL,
			rutaStorage: nombreTecnico,
			validacionAutomatica: false,
			ocrCampos,
			ocrTramite,
			ocrExtraidoEn,
			ocrError,
		});
		if (errDb) {
			return NextResponse.json({ error: mensajeCausaParaUsuario(errDb) }, { status: 500 });
		}

		return NextResponse.json({
			ok: true,
			nombreTecnico,
			estado: ESTADOS_ENTREGA_DOCUMENTO.PENDIENTE_REVISION_MANUAL,
			ocr: {
				exitoso: ocrRes.ok,
				campos: ocrCampos,
				tramite: ocrTramite,
				error: ocrError,
			},
		});
	} catch (e) {
		console.error("orientador subir", e);
		return NextResponse.json({ error: mensajeCausaParaUsuario(e) }, { status: 500 });
	}
}
