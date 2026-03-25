import { NextResponse } from "next/server";
import { argsRpcActorOrientador } from "@/lib/orientador/audit-registrar";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

type RpcArchivarResult = {
	ok?: boolean;
	archivados?: number;
	padron_ids?: string[];
};

export async function POST(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	let cuerpo: { grupoTokenId?: string; padronIds?: string[] };
	try {
		cuerpo = (await request.json()) as { grupoTokenId?: string; padronIds?: string[] };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const grupoTokenId =
		typeof cuerpo.grupoTokenId === "string" ? cuerpo.grupoTokenId.trim() : "";
	const padronIds = Array.isArray(cuerpo.padronIds)
		? cuerpo.padronIds.map((x) => String(x).trim()).filter(Boolean)
		: [];

	if (!grupoTokenId && padronIds.length === 0) {
		return NextResponse.json(
			{ error: "Indica grupoTokenId y/o padronIds" },
			{ status: 400 },
		);
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const actor = argsRpcActorOrientador(orientador);

		if (padronIds.length > 0) {
			const { data, error } = await supabase.rpc("aud_archivar_padrones", {
				p_padron_ids: padronIds,
				p_grupo_token_id: grupoTokenId || null,
				...actor,
			});
			if (error) {
				console.error("archivar padronIds RPC", error);
				return NextResponse.json({ error: "No se pudo archivar" }, { status: 500 });
			}
			const res = data as RpcArchivarResult | null;
			return NextResponse.json({ ok: true, archivados: res?.archivados ?? 0 });
		}

		if (grupoTokenId) {
			const { data: gt, error: errG } = await supabase
				.from("grupo_tokens")
				.select("id")
				.eq("id", grupoTokenId)
				.maybeSingle();
			if (errG || !gt) {
				return NextResponse.json({ error: "Grupo no encontrado" }, { status: 404 });
			}
			const { data, error } = await supabase.rpc("aud_archivar_padrones", {
				p_padron_ids: null,
				p_grupo_token_id: grupoTokenId,
				...actor,
			});
			if (error) {
				console.error("archivar grupo RPC", error);
				return NextResponse.json({ error: "No se pudo archivar el grupo" }, { status: 500 });
			}
			const res = data as RpcArchivarResult | null;
			return NextResponse.json({ ok: true, archivados: res?.archivados ?? 0 });
		}

		return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
	} catch (e) {
		console.error("archivar", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
