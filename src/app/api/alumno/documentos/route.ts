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
	esEstadoEntregaPersistido,
	type EstadoEntregaDocumentoUi,
} from "@/lib/alumno/estado-documento";
import { TIPOS_DOCUMENTO, type TipoDocumentoClave } from "@/lib/nombre-archivo";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

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
			};
		});

		return NextResponse.json({ documentos });
	} catch (e) {
		console.error("documentos GET", e);
		return NextResponse.json({ error: "No se pudieron cargar los documentos" }, { status: 500 });
	}
}
