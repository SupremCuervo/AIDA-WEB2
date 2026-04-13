import { NextResponse } from "next/server";
import { argsRpcActorOrientador } from "@/lib/orientador/audit-registrar";
import {
	aplicarGradoSubconjuntoPadron,
	obtenerPadronIdsActivosCargaEnSeccion,
} from "@/lib/orientador/carga-acciones-masivas-padron";
import { normalizarLetraGrupo } from "@/lib/orientador/cargas-helpers";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import { carreraExisteEnCatalogo, normalizarCarreraIdPayload } from "@/lib/padron/carrera-padron";
import { GRADO_ESCOLAR_MAX } from "@/lib/padron/grado-alumno";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type Cuerpo = {
	cargaId?: string;
	institucionGrupoIds?: string[];
	alcanceListado?: "activo" | "inactivo";
	accion?: "subir_grado" | "bajar_grado" | "archivar_grupo";
	/** Obligatoria en el mismo POST si algún grupo sube de 1.° a 2.° */
	carreraIdSubida1a2?: string | null;
};

type RpcArchivarResult = {
	ok?: boolean;
	archivados?: number;
};

type ItemRes = {
	institucionGrupoId: string;
	ok: boolean;
	mensaje?: string;
	error?: string;
};

export async function POST(request: Request) {
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

	const cargaId = typeof cuerpo.cargaId === "string" ? cuerpo.cargaId.trim() : "";
	const ids = Array.isArray(cuerpo.institucionGrupoIds)
		? [...new Set(cuerpo.institucionGrupoIds.map((x) => String(x).trim()).filter(Boolean))]
		: [];
	const alcance = cuerpo.alcanceListado === "inactivo" ? "inactivo" : "activo";
	const accion = cuerpo.accion;

	if (!cargaId || ids.length === 0) {
		return NextResponse.json(
			{ error: "Indica la carga (encarga) y al menos un grupo (sección)" },
			{ status: 400 },
		);
	}

	if (accion !== "subir_grado" && accion !== "bajar_grado" && accion !== "archivar_grupo") {
		return NextResponse.json({ error: "Acción no válida" }, { status: 400 });
	}

	if (alcance !== "activo") {
		return NextResponse.json(
			{
				error:
					"Subir/bajar grado e inactivar grupo solo aplican a expedientes activos. Elige «Activo» en alcance.",
			},
			{ status: 400 },
		);
	}

	const supabase = obtenerClienteSupabaseAdmin();

	const { data: carga, error: errC } = await supabase
		.from("cargas_alumnos")
		.select("id, grado_carga, grupos_letras")
		.eq("id", cargaId)
		.maybeSingle();
	if (errC || !carga) {
		return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
	}

	const letrasPermitidas = new Set(
		((carga.grupos_letras as string[]) ?? [])
			.map((x) => normalizarLetraGrupo(String(x)))
			.filter(Boolean),
	);

	const actor = argsRpcActorOrientador(orientador);
	const items: ItemRes[] = [];

	const normCarrera12 = normalizarCarreraIdPayload(cuerpo.carreraIdSubida1a2);
	let carrera12Validada: string | null = null;
	if (normCarrera12.ok && normCarrera12.valor) {
		const existe = await carreraExisteEnCatalogo(supabase, normCarrera12.valor);
		if (!existe) {
			return NextResponse.json({ error: "La carrera indicada no existe en el catálogo." }, { status: 400 });
		}
		carrera12Validada = normCarrera12.valor;
	} else if (!normCarrera12.ok) {
		return NextResponse.json({ error: normCarrera12.error }, { status: 400 });
	}

	for (const igId of ids) {
		const { data: filaIg, error: errIg } = await supabase
			.from("institucion_grupos")
			.select("id, grado, grupo")
			.eq("id", igId)
			.maybeSingle();
		if (errIg || !filaIg) {
			items.push({ institucionGrupoId: igId, ok: false, error: "Sección no encontrada" });
			continue;
		}

		const gradoNum = Number.parseInt(String(filaIg.grado), 10) || 0;
		const letraIg = normalizarLetraGrupo(String(filaIg.grupo ?? ""));
		if (!letrasPermitidas.has(letraIg)) {
			items.push({
				institucionGrupoId: igId,
				ok: false,
				error: "La letra de grupo no está en esta carga.",
			});
			continue;
		}

		const padronIdsCarga = await obtenerPadronIdsActivosCargaEnSeccion(
			supabase,
			cargaId,
			letraIg,
			igId,
		);

		if (padronIdsCarga.length === 0) {
			items.push({
				institucionGrupoId: igId,
				ok: false,
				error:
					"No hay alumnos activos de esta carga en esta sección (revisa líneas de la carga o el listado).",
			});
			continue;
		}

		if (accion === "archivar_grupo") {
			const { data: rpcData, error: rpcErr } = await supabase.rpc("aud_archivar_padrones", {
				p_padron_ids: padronIdsCarga,
				p_grupo_token_id: null,
				...actor,
			});
			if (rpcErr) {
				console.error("archivar subconjunto carga RPC", rpcErr);
				items.push({ institucionGrupoId: igId, ok: false, error: "No se pudo inactivar" });
				continue;
			}
			const res = rpcData as RpcArchivarResult | null;
			const n = res?.archivados ?? 0;
			items.push({
				institucionGrupoId: igId,
				ok: true,
				mensaje: n > 0 ? `Inactivados: ${n}` : "Sin expedientes activos",
			});
			continue;
		}

		let target = gradoNum;
		if (accion === "subir_grado") {
			target = Math.min(GRADO_ESCOLAR_MAX, gradoNum + 1);
		} else {
			target = Math.max(1, gradoNum - 1);
		}

		if (target === gradoNum) {
			items.push({
				institucionGrupoId: igId,
				ok: true,
				mensaje: "Sin cambio (ya en el límite de grado)",
			});
			continue;
		}

		if (accion === "subir_grado" && gradoNum === 1 && target === 2) {
			if (!carrera12Validada) {
				items.push({
					institucionGrupoId: igId,
					ok: false,
					error: "Indica la carrera (carreraIdSubida1a2) para el pase de 1.° a 2.°.",
				});
				continue;
			}
		}

		const r = await aplicarGradoSubconjuntoPadron(
			supabase,
			padronIdsCarga,
			target,
			letraIg,
			accion === "subir_grado" && gradoNum === 1 && target === 2 && carrera12Validada
				? { carreraIdSiPasaAGrado2: carrera12Validada }
				: undefined,
		);
		if (!r.ok) {
			items.push({ institucionGrupoId: igId, ok: false, error: r.error });
		} else {
			items.push({
				institucionGrupoId: igId,
				ok: true,
				mensaje: `Grado → ${r.grado}° · Expedientes actualizados: ${r.actualizados}`,
			});
		}
	}

	const todosOk = items.every((i) => i.ok);
	return NextResponse.json({ ok: todosOk, items });
}
