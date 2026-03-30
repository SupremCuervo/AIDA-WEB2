import { NextResponse } from "next/server";
import { mapClavesPorLetraCarga } from "@/lib/orientador/carga-claves-vista";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

export async function GET(
	_request: Request,
	ctx: { params: Promise<{ cargaId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	const { cargaId } = await ctx.params;
	if (!cargaId?.trim()) {
		return NextResponse.json({ error: "cargaId inválido" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: carga, error } = await supabase
			.from("cargas_alumnos")
			.select("id, fecha_cierre, grado_carga, grupos_letras, creado_en, orientador_id")
			.eq("id", cargaId)
			.maybeSingle();

		if (error || !carga) {
			return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
		}
		if ((carga.orientador_id as string) !== orientador.orientadorId) {
			return NextResponse.json({ error: "No autorizado" }, { status: 403 });
		}

		const { data: lineas } = await supabase
			.from("carga_alumnos_linea")
			.select("id, grupo_letra, nombre_completo, padron_id")
			.eq("carga_id", cargaId);

		const padronIds = (lineas ?? []).map((l) => l.padron_id as string);
		const cuentaPorPadron = new Map<string, string>();
		if (padronIds.length > 0) {
			const { data: cuentas } = await supabase
				.from("cuentas_alumno")
				.select("id, padron_id")
				.in("padron_id", padronIds);
			for (const cu of cuentas ?? []) {
				cuentaPorPadron.set(cu.padron_id as string, cu.id as string);
			}
		}

		const lineasPorGrupo: Record<
			string,
			{ id: string; nombreCompleto: string; padronId: string; cuentaId: string | null; grupoLetra: string }[]
		> = {};
		for (const ln of lineas ?? []) {
			const g = String(ln.grupo_letra).toUpperCase();
			if (!lineasPorGrupo[g]) {
				lineasPorGrupo[g] = [];
			}
			lineasPorGrupo[g].push({
				id: ln.id as string,
				nombreCompleto: ln.nombre_completo as string,
				padronId: ln.padron_id as string,
				cuentaId: cuentaPorPadron.get(ln.padron_id as string) ?? null,
				grupoLetra: g,
			});
		}

		const gradoC = Number(carga.grado_carga);
		const letras = (carga.grupos_letras as string[]) ?? [];
		const clavesPorGrupo = await mapClavesPorLetraCarga(supabase, gradoC, letras);

		return NextResponse.json({
			carga: {
				id: carga.id as string,
				fechaCierre: carga.fecha_cierre as string,
				gradoCarga: gradoC,
				gruposLetras: letras,
				creadoEn: carga.creado_en as string,
			},
			clavesPorGrupo,
			lineasPorGrupo,
		});
	} catch (e) {
		console.error("cargas [cargaId] GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

/**
 * Quita la carga del historial: borra líneas y, por cada padrón, solo elimina el padrón si el alumno no tiene cuenta
 * (misma regla que DELETE `/api/orientador/cargas/linea`).
 */
export async function DELETE(
	_request: Request,
	ctx: { params: Promise<{ cargaId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	const { cargaId } = await ctx.params;
	if (!cargaId?.trim()) {
		return NextResponse.json({ error: "cargaId inválido" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: carga, error: errC } = await supabase
			.from("cargas_alumnos")
			.select("id, orientador_id")
			.eq("id", cargaId)
			.maybeSingle();

		if (errC || !carga) {
			return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
		}
		if ((carga.orientador_id as string) !== orientador.orientadorId) {
			return NextResponse.json({ error: "No autorizado" }, { status: 403 });
		}

		const { data: lineas, error: errL } = await supabase
			.from("carga_alumnos_linea")
			.select("id, padron_id")
			.eq("carga_id", cargaId);

		if (errL) {
			console.error("cargas [cargaId] DELETE lineas", errL);
			return NextResponse.json({ error: "No se pudieron leer las líneas" }, { status: 500 });
		}

		for (const ln of lineas ?? []) {
			const lineaId = ln.id as string;
			const padronId = ln.padron_id as string;
			const { error: errD } = await supabase.from("carga_alumnos_linea").delete().eq("id", lineaId);
			if (errD) {
				console.error("cargas [cargaId] DELETE linea", errD);
				return NextResponse.json({ error: "No se pudo eliminar una línea de la carga" }, { status: 500 });
			}
			const { count } = await supabase
				.from("cuentas_alumno")
				.select("id", { count: "exact", head: true })
				.eq("padron_id", padronId);
			if (!count || count === 0) {
				await supabase.from("padron_alumnos").delete().eq("id", padronId);
			}
		}

		const { error: errF } = await supabase.from("cargas_alumnos").delete().eq("id", cargaId);
		if (errF) {
			console.error("cargas [cargaId] DELETE carga", errF);
			return NextResponse.json({ error: "No se pudo eliminar la carga" }, { status: 500 });
		}

		return NextResponse.json({ ok: true });
	} catch (e) {
		console.error("cargas [cargaId] DELETE", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
