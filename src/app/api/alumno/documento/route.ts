import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import { eliminarEntregaPorCuentaYTipo } from "@/lib/alumno/entregas-documento";
import { COOKIE_ALUMNO, verificarTokenAlumno } from "@/lib/alumno/jwt-cookies";
import {
	jsonAlumnoGrupoVencidoCierraSesion,
	padronPerteneceAGrupoVencido,
} from "@/lib/alumno/requiere-grupo-vigente";
import { jsonAlumnoArchivoMuertoCierraSesion, padronEstaArchivado } from "@/lib/padron/archivo-muerto";
import { esTipoDocumentoValido, type TipoDocumentoClave } from "@/lib/nombre-archivo";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function DELETE(request: Request) {
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

		const { error } = await eliminarEntregaPorCuentaYTipo(supabase, bucket, p.cuentaId, tipo);
		if (error) {
			const msg = error.message;
			if (msg.includes("No hay entrega")) {
				return NextResponse.json({ error: "No hay archivo para eliminar" }, { status: 404 });
			}
			return NextResponse.json({ error: msg }, { status: 500 });
		}

		return NextResponse.json({ ok: true });
	} catch (e) {
		console.error("documento DELETE", e);
		return NextResponse.json({ error: "No se pudo eliminar el documento" }, { status: 500 });
	}
}
