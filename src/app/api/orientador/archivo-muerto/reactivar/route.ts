import { NextResponse } from "next/server";
import { argsRpcActorOrientador } from "@/lib/orientador/audit-registrar";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

type RpcReactivarResult = { ok?: boolean; padronId?: string; error?: string };

export async function POST(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	let cuerpo: { padronId?: string };
	try {
		cuerpo = (await request.json()) as { padronId?: string };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const padronId = typeof cuerpo.padronId === "string" ? cuerpo.padronId.trim() : "";
	if (!padronId) {
		return NextResponse.json({ error: "padronId obligatorio" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data, error } = await supabase.rpc("aud_reactivar_padron", {
			p_padron_id: padronId,
			...argsRpcActorOrientador(orientador),
		});

		if (error) {
			console.error("reactivar RPC", error);
			return NextResponse.json({ error: "No se pudo reactivar" }, { status: 500 });
		}

		const res = data as RpcReactivarResult | null;
		if (!res?.ok) {
			return NextResponse.json(
				{ error: "Registro no encontrado o ya estaba activo" },
				{ status: 404 },
			);
		}
		return NextResponse.json({ ok: true, padronId: res.padronId ?? padronId });
	} catch (e) {
		console.error("reactivar", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
