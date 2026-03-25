import { NextResponse } from "next/server";
import {
	eliminarEntregaPorCuentaYTipo,
	upsertEntregaAdjuntoOrientador,
} from "@/lib/alumno/entregas-documento";
import { ESTADOS_ENTREGA_DOCUMENTO } from "@/lib/alumno/estado-documento";
import {
	crearTipoAdjuntoOrientador,
	esTipoAdjuntoOrientador,
	nombreRutaStorageAdjuntoOrientador,
	slugificar,
} from "@/lib/nombre-archivo";
import { registrarLogApi } from "@/lib/orientador/audit-registrar";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

const TAMANO_MAX_BYTES = 15 * 1024 * 1024;
const ETIQUETA_MAX = 80;

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

		const ext = extensionDesdeNombre(archivo.name);
		const slugAlumno = slugificar(nombreCompleto);
		let nombreTecnico: string;
		try {
			nombreTecnico = nombreRutaStorageAdjuntoOrientador(
				slugAlumno,
				etiqueta,
				tipoNuevo,
				ext || "pdf",
			);
		} catch (e) {
			const msg = e instanceof Error ? e.message : "Nombre inválido";
			return NextResponse.json({ error: msg }, { status: 400 });
		}

		const bytes = new Uint8Array(await archivo.arrayBuffer());
		const contentType = archivo.type || "application/octet-stream";

		const { error: errS } = await supabase.storage.from(bucket).upload(nombreTecnico, Buffer.from(bytes), {
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
		});
		if (errDb) {
			await supabase.storage.from(bucket).remove([nombreTecnico]);
			return NextResponse.json({ error: errDb.message }, { status: 500 });
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
			return NextResponse.json({ error: error.message }, { status: 400 });
		}
		await registrarLogApi({
			orientador,
			accion: "ELIMINAR_ADJUNTO_ORIENTADOR",
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
