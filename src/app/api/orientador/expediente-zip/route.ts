import { NextResponse } from "next/server";
import JSZip from "jszip";
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

const ETIQUETAS: Record<TipoDocumentoClave, string> = {
	acta_nacimiento: "Acta_de_nacimiento",
	curp: "CURP",
	ine_tutor: "INE_del_tutor",
	comprobante_domicilio: "Comprobante_de_domicilio",
	certificado_medico: "Certificado_medico",
};

export async function GET(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const url = new URL(request.url);
	const cuentaId = url.searchParams.get("cuentaId")?.trim() ?? "";
	if (!cuentaId) {
		return NextResponse.json({ error: "cuentaId obligatorio" }, { status: 400 });
	}

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
		const nombreCompleto = padron?.nombre_completo ?? "alumno";

		const filas = await listarEntregasPorCuenta(supabase, cuentaId);
		const conArchivo = filas.filter((f) => f.ruta_storage && esTipoDocumentoValido(f.tipo_documento));
		if (conArchivo.length === 0) {
			return NextResponse.json({ error: "No hay archivos en el expediente" }, { status: 404 });
		}

		const zip = new JSZip();
		const slugBase = nombreCompleto.replace(/\s+/g, "_").slice(0, 40) || "expediente";
		let agregados = 0;

		for (const f of conArchivo) {
			const { data: blob, error: errD } = await supabase.storage
				.from(bucket)
				.download(f.ruta_storage);
			if (errD || !blob) {
				continue;
			}
			const ext = extensionDesdeRuta(f.ruta_storage);
			let nombreEnZip: string;
			if (esTipoDocumentoValido(f.tipo_documento)) {
				const tipo = f.tipo_documento as TipoDocumentoClave;
				try {
					nombreEnZip = nombreArchivoDescargaAlumno(nombreCompleto, tipo, ext);
				} catch {
					nombreEnZip = `${ETIQUETAS[tipo]}.${ext}`;
				}
			} else {
				const base =
					f.etiqueta_personalizada != null && f.etiqueta_personalizada.trim() !== ""
						? slugificar(f.etiqueta_personalizada)
						: "documento_adicional";
				nombreEnZip = `${slugificar(nombreCompleto)}_${base}.${ext}`;
			}
			const buf = await blob.arrayBuffer();
			zip.file(`${slugBase}/${nombreEnZip}`, new Uint8Array(buf));
			agregados += 1;
		}

		if (agregados === 0) {
			return NextResponse.json({ error: "No se pudieron leer los archivos del storage" }, { status: 500 });
		}

		const bytes = await zip.generateAsync({ type: "uint8array", compression: "DEFLATE" });
		const nombreZip = `${slugBase}_expediente_completo.zip`;
		const encoded = encodeURIComponent(nombreZip);

		return new NextResponse(bytes, {
			status: 200,
			headers: {
				"Content-Type": "application/zip",
				"Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
			},
		});
	} catch (e) {
		console.error("orientador expediente-zip", e);
		return NextResponse.json({ error: "Error al generar el ZIP" }, { status: 500 });
	}
}
