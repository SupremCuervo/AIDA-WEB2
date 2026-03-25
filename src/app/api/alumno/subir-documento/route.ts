import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eliminarArchivosPreviosDelTipo, upsertEntregaDocumento } from "@/lib/alumno/entregas-documento";
import { ESTADOS_ENTREGA_DOCUMENTO } from "@/lib/alumno/estado-documento";
import { COOKIE_ALUMNO, verificarTokenAlumno } from "@/lib/alumno/jwt-cookies";
import {
	jsonAlumnoGrupoVencidoCierraSesion,
	padronPerteneceAGrupoVencido,
} from "@/lib/alumno/requiere-grupo-vigente";
import { jsonAlumnoArchivoMuertoCierraSesion, padronEstaArchivado } from "@/lib/padron/archivo-muerto";
import {
	esTipoDocumentoValido,
	nombreArchivoEstandar,
	type TipoDocumentoClave,
} from "@/lib/nombre-archivo";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const TAMANO_MAX_BYTES = 15 * 1024 * 1024;

function extensionDesdeNombre(nombreArchivo: string): string {
	const i = nombreArchivo.lastIndexOf(".");
	if (i < 0 || i === nombreArchivo.length - 1) {
		return "";
	}
	return nombreArchivo.slice(i + 1);
}

export async function POST(request: Request) {
	const jar = await cookies();
	const token = jar.get(COOKIE_ALUMNO)?.value;
	if (!token) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	let payloadAlumno;
	try {
		payloadAlumno = await verificarTokenAlumno(token);
	} catch {
		return NextResponse.json({ error: "Sesión inválida" }, { status: 401 });
	}

	const supabase = obtenerClienteSupabaseAdmin();
	if (await padronPerteneceAGrupoVencido(supabase, payloadAlumno.padronId)) {
		return jsonAlumnoGrupoVencidoCierraSesion();
	}
	if (await padronEstaArchivado(supabase, payloadAlumno.padronId)) {
		return jsonAlumnoArchivoMuertoCierraSesion();
	}

	const bucket = process.env.AIDA_DOCUMENTOS_BUCKET?.trim();
	if (!bucket) {
		return NextResponse.json(
			{ error: "Subida de documentos no configurada (AIDA_DOCUMENTOS_BUCKET)." },
			{ status: 503 },
		);
	}

	let formData: FormData;
	try {
		formData = await request.formData();
	} catch {
		return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
	}

	const tipoRaw = formData.get("tipoDocumento");
	const archivo = formData.get("archivo");

	if (typeof tipoRaw !== "string" || !esTipoDocumentoValido(tipoRaw)) {
		return NextResponse.json({ error: "tipoDocumento no válido" }, { status: 400 });
	}

	if (!(archivo instanceof File) || archivo.size === 0) {
		return NextResponse.json({ error: "Archivo obligatorio" }, { status: 400 });
	}

	if (archivo.size > TAMANO_MAX_BYTES) {
		return NextResponse.json(
			{ error: "El archivo supera el tamaño máximo permitido (15 MB)." },
			{ status: 400 },
		);
	}

	const tipo = tipoRaw as TipoDocumentoClave;
	const ext = extensionDesdeNombre(archivo.name);
	let nombreTecnico: string;
	try {
		nombreTecnico = nombreArchivoEstandar(
			payloadAlumno.nombreCompleto,
			tipo,
			ext || "pdf",
		).nombreCompleto;
	} catch (e) {
		const msg = e instanceof Error ? e.message : "Nombre de archivo no válido";
		return NextResponse.json({ error: msg }, { status: 400 });
	}

	const bytes = new Uint8Array(await archivo.arrayBuffer());
	const contentType = archivo.type || "application/octet-stream";

	/*
	 * --- Aquí iría validación automática del documento (p. ej. OCR / API externa) ---
	 * Tras analizar el archivo y el tipo esperado, podrías:
	 * - devolver 422 + mensaje si el alumno debe confirmar antes de subir, o
	 * - fijar estado validado + validacionAutomatica true solo si el sistema está 100% seguro.
	 * Mientras no exista esa capa, todas las subidas quedan en revisión manual.
	 */
	const estado = ESTADOS_ENTREGA_DOCUMENTO.PENDIENTE_REVISION_MANUAL;
	const validacionAutomatica = false;

	try {
		await eliminarArchivosPreviosDelTipo(
			supabase,
			bucket,
			payloadAlumno.nombreCompleto,
			tipo,
		);

		const { error: errSubida } = await supabase.storage.from(bucket).upload(nombreTecnico, Buffer.from(bytes), {
			contentType,
			upsert: true,
		});
		if (errSubida) {
			console.error("subir-documento storage", errSubida);
			return NextResponse.json(
				{ error: "No se pudo guardar el archivo. Intenta de nuevo." },
				{ status: 500 },
			);
		}

		const { error: errDb } = await upsertEntregaDocumento(supabase, {
			cuentaId: payloadAlumno.cuentaId,
			tipoDocumento: tipo,
			estado,
			rutaStorage: nombreTecnico,
			validacionAutomatica,
		});
		if (errDb) {
			console.error("subir-documento BD", errDb);
			return NextResponse.json(
				{
					error:
						"El archivo se guardó pero no se registró el estado. Ejecuta el SQL de entregas_documento_alumno en Supabase.",
				},
				{ status: 500 },
			);
		}

		return NextResponse.json({
			ok: true,
			nombreTecnico,
			estado,
			validacionAutomatica,
		});
	} catch (e) {
		console.error("subir-documento", e);
		return NextResponse.json({ error: "Error al subir el archivo" }, { status: 500 });
	}
}
