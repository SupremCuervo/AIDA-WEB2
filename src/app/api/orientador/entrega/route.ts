import { NextResponse } from "next/server";
import { ESTADOS_ENTREGA_DOCUMENTO } from "@/lib/alumno/estado-documento";
import { orientadorActualizarEstadoEntrega } from "@/lib/alumno/entregas-documento";
import { esTipoDocumentoValido, type TipoDocumentoClave } from "@/lib/nombre-archivo";
import { mensajeCausaParaUsuario } from "@/lib/mensaje-red-amigable";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

type Cuerpo = {
	cuentaId?: string;
	tipoDocumento?: string;
	accion?: "rechazar" | "validar_manual";
	motivoRechazo?: string;
};

export async function PATCH(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	let cuerpo: Cuerpo;
	try {
		cuerpo = (await request.json()) as Cuerpo;
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const cuentaId = typeof cuerpo.cuentaId === "string" ? cuerpo.cuentaId.trim() : "";
	const tipoRaw = typeof cuerpo.tipoDocumento === "string" ? cuerpo.tipoDocumento : "";
	const accion = cuerpo.accion;

	if (!cuentaId || !esTipoDocumentoValido(tipoRaw) || (accion !== "rechazar" && accion !== "validar_manual")) {
		return NextResponse.json({ error: "Datos no válidos" }, { status: 400 });
	}

	const tipo = tipoRaw as TipoDocumentoClave;

	if (accion === "rechazar") {
		const motivo =
			typeof cuerpo.motivoRechazo === "string" ? cuerpo.motivoRechazo.trim() : "";
		if (!motivo) {
			return NextResponse.json({ error: "motivoRechazo es obligatorio al rechazar" }, { status: 400 });
		}
		const supabase = obtenerClienteSupabaseAdmin();
		const { error, filas } = await orientadorActualizarEstadoEntrega(supabase, {
			cuentaId,
			tipoDocumento: tipo,
			estado: ESTADOS_ENTREGA_DOCUMENTO.RECHAZADO,
			motivoRechazo: motivo,
			validacionAutomatica: false,
		});
		if (error) {
			return NextResponse.json({ error: mensajeCausaParaUsuario(error) }, { status: 500 });
		}
		if (filas === 0) {
			return NextResponse.json({ error: "No hay entrega registrada para ese documento" }, { status: 404 });
		}
		return NextResponse.json({ ok: true, estado: ESTADOS_ENTREGA_DOCUMENTO.RECHAZADO });
	}

	const supabase = obtenerClienteSupabaseAdmin();
	const { error, filas } = await orientadorActualizarEstadoEntrega(supabase, {
		cuentaId,
		tipoDocumento: tipo,
		estado: ESTADOS_ENTREGA_DOCUMENTO.VALIDADO,
		motivoRechazo: null,
		validacionAutomatica: false,
	});
	if (error) {
		return NextResponse.json({ error: mensajeCausaParaUsuario(error) }, { status: 500 });
	}
	if (filas === 0) {
		return NextResponse.json({ error: "No hay entrega registrada para ese documento" }, { status: 404 });
	}
	return NextResponse.json({ ok: true, estado: ESTADOS_ENTREGA_DOCUMENTO.VALIDADO });
}
