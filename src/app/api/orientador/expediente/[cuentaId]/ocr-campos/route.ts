import { NextResponse } from "next/server";
import { actualizarOcrCamposEnEntrega } from "@/lib/alumno/entregas-documento";
import {
	esTipoAdjuntoOrientador,
	esTipoDocumentoValido,
} from "@/lib/nombre-archivo";
import {
	aplicarEdicionOcrCampos,
	parseCamposOcrDesdeJson,
} from "@/lib/ocr/campos-ocr-vista";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

const OCR_BODY_MAX_CHARS = 120_000;

function tipoDocumentoPermitido(v: string): boolean {
	return esTipoDocumentoValido(v) || esTipoAdjuntoOrientador(v);
}

export async function PATCH(
	request: Request,
	ctx: { params: Promise<{ cuentaId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const { cuentaId } = await ctx.params;
	if (!cuentaId?.trim()) {
		return NextResponse.json({ error: "Cuenta no válida" }, { status: 400 });
	}

	let texto: string;
	try {
		texto = await request.text();
	} catch {
		return NextResponse.json({ error: "Cuerpo inválido" }, { status: 400 });
	}
	if (texto.length > OCR_BODY_MAX_CHARS) {
		return NextResponse.json({ error: "Demasiados datos en la solicitud" }, { status: 400 });
	}

	let body: { tipoDocumento?: unknown; campos?: unknown };
	try {
		body = JSON.parse(texto) as typeof body;
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	if (typeof body.tipoDocumento !== "string" || !tipoDocumentoPermitido(body.tipoDocumento)) {
		return NextResponse.json({ error: "tipoDocumento no válido" }, { status: 400 });
	}
	const tipoDoc = body.tipoDocumento.trim();
	if (body.campos == null || typeof body.campos !== "object" || Array.isArray(body.campos)) {
		return NextResponse.json({ error: "campos debe ser un objeto" }, { status: 400 });
	}
	const camposIn = body.campos as Record<string, unknown>;
	if (Object.keys(camposIn).length > 80) {
		return NextResponse.json({ error: "Demasiados campos" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: cuenta, error: errC } = await supabase
			.from("cuentas_alumno")
			.select("id")
			.eq("id", cuentaId.trim())
			.maybeSingle();
		if (errC || !cuenta) {
			return NextResponse.json({ error: "Cuenta no encontrada" }, { status: 404 });
		}

		const { data: fila, error: errQ } = await supabase
			.from("entregas_documento_alumno")
			.select("ocr_campos")
			.eq("cuenta_id", cuentaId.trim())
			.eq("tipo_documento", tipoDoc)
			.maybeSingle();
		if (errQ) {
			console.error("orientador ocr-campos PATCH select", errQ);
			return NextResponse.json({ error: "No se pudo leer la entrega" }, { status: 500 });
		}
		const previo = parseCamposOcrDesdeJson(fila?.ocr_campos ?? null);
		const fusion = aplicarEdicionOcrCampos(previo, camposIn);
		if (Object.keys(fusion).length === 0) {
			return NextResponse.json({ error: "Indica al menos un campo" }, { status: 400 });
		}

		const jsonStr = JSON.stringify(fusion);
		if (jsonStr.length > OCR_BODY_MAX_CHARS) {
			return NextResponse.json({ error: "Los datos OCR superan el tamaño permitido" }, { status: 400 });
		}

		const { error: errU } = await actualizarOcrCamposEnEntrega(
			supabase,
			cuentaId.trim(),
			tipoDoc,
			fusion,
		);
		if (errU) {
			const msg = errU.message;
			if (msg.includes("No hay documento")) {
				return NextResponse.json({ error: msg }, { status: 404 });
			}
			console.error("orientador ocr-campos PATCH update", errU);
			return NextResponse.json({ error: "No se pudieron guardar los datos" }, { status: 500 });
		}

		return NextResponse.json({ ok: true, ocrCampos: fusion });
	} catch (e) {
		console.error("orientador ocr-campos PATCH", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
