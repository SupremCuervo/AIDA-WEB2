import { NextResponse } from "next/server";
import { listarEntregasPorCuenta } from "@/lib/alumno/entregas-documento";
import { TIPOS_DOCUMENTO, type TipoDocumentoClave } from "@/lib/nombre-archivo";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const ETIQUETAS: Record<TipoDocumentoClave, string> = {
	acta_nacimiento: "Acta de Nacimiento",
	curp: "CURP",
	ine_tutor: "INE del tutor",
	comprobante_domicilio: "Comprobante domicilio",
	certificado_medico: "Ficha / certificado médico",
};

export async function GET(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	const url = new URL(request.url);
	const padronId = url.searchParams.get("padronId")?.trim() ?? "";
	if (!padronId) {
		return NextResponse.json({ error: "padronId obligatorio" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: cuenta, error } = await supabase
			.from("cuentas_alumno")
			.select("id")
			.eq("padron_id", padronId)
			.maybeSingle();

		if (error) {
			console.error("documentos-estatus cuenta", error);
			return NextResponse.json({ error: "Error al consultar" }, { status: 500 });
		}

		const tipos = Object.keys(TIPOS_DOCUMENTO) as TipoDocumentoClave[];
		if (!cuenta?.id) {
			return NextResponse.json({
				cuentaId: null as string | null,
				documentos: tipos.map((t) => ({
					tipo: t,
					etiqueta: ETIQUETAS[t],
					estado: null as string | null,
					tieneArchivo: false,
				})),
			});
		}

		const entregas = await listarEntregasPorCuenta(supabase, cuenta.id as string);
		const porTipo = new Map(entregas.map((e) => [e.tipo_documento, e]));

		return NextResponse.json({
			cuentaId: cuenta.id as string,
			documentos: tipos.map((t) => {
				const e = porTipo.get(t);
				return {
					tipo: t,
					etiqueta: ETIQUETAS[t],
					estado: e?.estado ?? null,
					tieneArchivo: Boolean(e?.ruta_storage),
				};
			}),
		});
	} catch (e) {
		console.error("documentos-estatus", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
