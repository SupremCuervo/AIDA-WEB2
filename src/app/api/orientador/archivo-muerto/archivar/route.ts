import { NextResponse } from "next/server";
import { argsRpcActorOrientador } from "@/lib/orientador/audit-registrar";
import { registrarLogApi } from "@/lib/orientador/audit-registrar";
import {
	seccionGradoGrupoParaLogGrupoToken,
	seccionGradoGrupoParaLogPadron,
} from "@/lib/orientador/log-seccion-padron";
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
			let nombreUnico: string | null = null;
			if (padronIds.length === 1) {
				const { data: alumno } = await supabase
					.from("padron_alumnos")
					.select("nombre_completo")
					.eq("id", padronIds[0]!)
					.maybeSingle();
				nombreUnico = alumno?.nombre_completo ? String(alumno.nombre_completo).trim() : null;
			}
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
			let secExtra: Awaited<ReturnType<typeof seccionGradoGrupoParaLogPadron>> | Record<string, never> =
				{};
			if (padronIds.length === 1) {
				secExtra = await seccionGradoGrupoParaLogPadron(supabase, padronIds[0]!);
			}
			await registrarLogApi({
				orientador,
				accion:
					padronIds.length === 1
						? `Inactivacion expediente - ${nombreUnico ?? "Sin nombre"}`
						: `Inactivacion masiva de expedientes (${res?.archivados ?? 0})`,
				entidad: "padron_alumnos",
				detalle: {
					padron_ids: padronIds,
					grupo_token_id: grupoTokenId || null,
					nombre_completo: nombreUnico,
					...secExtra,
				},
			});
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
			const secGrupo = await seccionGradoGrupoParaLogGrupoToken(supabase, grupoTokenId);
			await registrarLogApi({
				orientador,
				accion: `Inactivacion de grupo completo (${res?.archivados ?? 0})`,
				entidad: "grupo_tokens",
				entidadId: grupoTokenId,
				detalle: {
					grupo_token_id: grupoTokenId,
					archivados: res?.archivados ?? 0,
					...secGrupo,
				},
			});
			return NextResponse.json({ ok: true, archivados: res?.archivados ?? 0 });
		}

		return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
	} catch (e) {
		console.error("archivar", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
