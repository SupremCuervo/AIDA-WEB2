import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { listarEntregasPorCuenta } from "@/lib/alumno/entregas-documento";
import { COOKIE_ALUMNO, verificarTokenAlumno } from "@/lib/alumno/jwt-cookies";
import {
	jsonAlumnoGrupoVencidoCierraSesion,
	padronPerteneceAGrupoVencido,
} from "@/lib/alumno/requiere-grupo-vigente";
import { jsonAlumnoArchivoMuertoCierraSesion, padronEstaArchivado } from "@/lib/padron/archivo-muerto";
import {
	esTipoDocumentoValido,
	nombreArchivoDescargaAlumno,
	type TipoDocumentoClave,
} from "@/lib/nombre-archivo";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function extensionDesdeRuta(ruta: string): string {
	const i = ruta.lastIndexOf(".");
	return i >= 0 ? ruta.slice(i + 1) : "pdf";
}

export async function GET(request: Request) {
	const jar = await cookies();
	const token = jar.get(COOKIE_ALUMNO)?.value;
	if (!token) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const url = new URL(request.url);
	const tipoRaw = url.searchParams.get("tipo");
	if (!tipoRaw || !esTipoDocumentoValido(tipoRaw)) {
		return NextResponse.json({ error: "tipo no válido" }, { status: 400 });
	}
	const tipo = tipoRaw as TipoDocumentoClave;

	const bucket = process.env.AIDA_DOCUMENTOS_BUCKET?.trim();
	if (!bucket) {
		return NextResponse.json({ error: "Almacenamiento no configurado" }, { status: 503 });
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
		const fila = filas.find((f) => f.tipo_documento === tipo);
		if (!fila?.ruta_storage) {
			return NextResponse.json({ error: "No hay archivo para este documento" }, { status: 404 });
		}

		const { data: blob, error } = await supabase.storage.from(bucket).download(fila.ruta_storage);
		if (error || !blob) {
			console.error("descargar storage", error);
			return NextResponse.json({ error: "No se pudo obtener el archivo" }, { status: 500 });
		}

		const ext = extensionDesdeRuta(fila.ruta_storage);
		let nombreLegible: string;
		try {
			nombreLegible = nombreArchivoDescargaAlumno(p.nombreCompleto, tipo, ext);
		} catch {
			nombreLegible = fila.ruta_storage;
		}

		const bytes = await blob.arrayBuffer();
		const tipoMime = blob.type || "application/octet-stream";
		const encoded = encodeURIComponent(nombreLegible);

		return new NextResponse(bytes, {
			status: 200,
			headers: {
				"Content-Type": tipoMime,
				"Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
			},
		});
	} catch (e) {
		console.error("descargar", e);
		return NextResponse.json({ error: "Error al descargar" }, { status: 500 });
	}
}
