import { NextResponse } from "next/server";
import { listarEntregasPorCuenta } from "@/lib/alumno/entregas-documento";
import {
	esTipoAdjuntoOrientador,
	esTipoDocumentoValido,
	nombreArchivoDescargaAlumno,
	slugificar,
	type TipoDocumentoClave,
} from "@/lib/nombre-archivo";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function extensionDesdeRuta(ruta: string): string {
	const i = ruta.lastIndexOf(".");
	return i >= 0 ? ruta.slice(i + 1) : "pdf";
}

export async function GET(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const url = new URL(request.url);
	const cuentaId = url.searchParams.get("cuentaId")?.trim() ?? "";
	const tipoRaw = url.searchParams.get("tipo") ?? "";
	const inline = url.searchParams.get("inline") === "1";

	if (!cuentaId || (!esTipoDocumentoValido(tipoRaw) && !esTipoAdjuntoOrientador(tipoRaw))) {
		return NextResponse.json({ error: "Parámetros no válidos" }, { status: 400 });
	}
	const tipo = tipoRaw as TipoDocumentoClave | string;

	const bucket = process.env.AIDA_DOCUMENTOS_BUCKET?.trim();
	if (!bucket) {
		return NextResponse.json({ error: "Storage no configurado" }, { status: 503 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: cuenta, error: errC } = await supabase
			.from("cuentas_alumno")
			.select("id, padron_alumnos ( nombre_completo )")
			.eq("id", cuentaId)
			.maybeSingle();

		if (errC || !cuenta) {
			return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
		}

		const padron = cuenta.padron_alumnos as unknown as { nombre_completo: string };
		const nombreCompleto = padron?.nombre_completo ?? "";

		const filas = await listarEntregasPorCuenta(supabase, cuentaId);
		const fila = filas.find((f) => f.tipo_documento === tipo);
		if (!fila?.ruta_storage) {
			return NextResponse.json({ error: "No hay archivo" }, { status: 404 });
		}

		const { data: blob, error: errD } = await supabase.storage
			.from(bucket)
			.download(fila.ruta_storage);
		if (errD || !blob) {
			return NextResponse.json({ error: "No se pudo descargar" }, { status: 500 });
		}

		const ext = extensionDesdeRuta(fila.ruta_storage);
		let nombreLegible: string;
		if (esTipoDocumentoValido(String(tipo))) {
			try {
				nombreLegible = nombreArchivoDescargaAlumno(nombreCompleto, tipo as TipoDocumentoClave, ext);
			} catch {
				nombreLegible = fila.ruta_storage;
			}
		} else {
			const base =
				fila.etiqueta_personalizada != null && fila.etiqueta_personalizada.trim() !== ""
					? slugificar(fila.etiqueta_personalizada)
					: "documento_adicional";
			nombreLegible = `${slugificar(nombreCompleto)}_${base}.${ext}`;
		}

		const bytes = await blob.arrayBuffer();
		const tipoMime = blob.type || "application/octet-stream";
		const encoded = encodeURIComponent(nombreLegible);
		const disp = inline ? "inline" : "attachment";

		return new NextResponse(bytes, {
			status: 200,
			headers: {
				"Content-Type": tipoMime,
				"Content-Disposition": `${disp}; filename*=UTF-8''${encoded}`,
			},
		});
	} catch (e) {
		console.error("orientador descargar", e);
		return NextResponse.json({ error: "Error al descargar" }, { status: 500 });
	}
}
