import { NextResponse } from "next/server";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

type Cuerpo = {
	grupoTokenId?: string;
	fechaLimiteEntrega?: string | null;
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

	const grupoTokenId =
		typeof cuerpo.grupoTokenId === "string" ? cuerpo.grupoTokenId.trim() : "";
	if (!grupoTokenId) {
		return NextResponse.json({ error: "grupoTokenId obligatorio" }, { status: 400 });
	}

	let fecha: string | null = null;
	if (cuerpo.fechaLimiteEntrega === null || cuerpo.fechaLimiteEntrega === "") {
		fecha = null;
	} else if (typeof cuerpo.fechaLimiteEntrega === "string") {
		const s = cuerpo.fechaLimiteEntrega.trim();
		if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
			return NextResponse.json(
				{ error: "fechaLimiteEntrega debe ser YYYY-MM-DD o null" },
				{ status: 400 },
			);
		}
		fecha = s;
	} else {
		return NextResponse.json({ error: "fechaLimiteEntrega no válida" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { error } = await supabase
			.from("grupo_tokens")
			.update({ fecha_limite_entrega: fecha })
			.eq("id", grupoTokenId);

		if (error) {
			console.error("grupo-fecha-limite", error);
			return NextResponse.json({ error: "No se pudo actualizar" }, { status: 500 });
		}

		return NextResponse.json({ ok: true, fechaLimiteEntrega: fecha });
	} catch (e) {
		console.error("grupo-fecha-limite", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
