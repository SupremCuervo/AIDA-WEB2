import { NextResponse } from "next/server";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function etiquetaNombrePeriodo(row: {
	nombre_anios: string | null;
	primer_periodo_fecha: string | null;
	segundo_periodo_fecha: string | null;
}): string {
	const n = row.nombre_anios?.trim();
	if (n) {
		return n;
	}
	const p = row.primer_periodo_fecha;
	const s = row.segundo_periodo_fecha;
	if (typeof p === "string" && typeof s === "string" && p.length >= 4 && s.length >= 4) {
		return `${p.slice(0, 4)}-${s.slice(0, 4)}`;
	}
	return "Periodo (guarda fechas de semestre arriba)";
}

/**
 * Lista los ciclos de semestre (orientador_semestre_fechas): id = periodo para asignar grupos.
 * Ya no se crean periodos con rangos de fecha manuales.
 */
export async function GET() {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: semestres, error } = await supabase
			.from("orientador_semestre_fechas")
			.select("id, nombre_anios, primer_periodo_fecha, segundo_periodo_fecha, actualizado_en")
			.order("actualizado_en", { ascending: false });
		if (error) {
			console.error("periodos GET semestres", error);
			return NextResponse.json({ error: "No se pudieron listar los periodos" }, { status: 500 });
		}
		const filas = semestres ?? [];
		const ids = filas.map((r) => r.id as string);
		let conteos = new Map<string, number>();
		if (ids.length > 0) {
			const { data: rels, error: errR } = await supabase
				.from("periodo_institucion_grupos")
				.select("periodo_id")
				.in("periodo_id", ids);
			if (!errR && rels) {
				for (const r of rels) {
					const pid = String(r.periodo_id);
					conteos.set(pid, (conteos.get(pid) ?? 0) + 1);
				}
			}
		}
		const lista = filas.map((p) => ({
			id: p.id as string,
			nombrePeriodo: etiquetaNombrePeriodo({
				nombre_anios: (p.nombre_anios as string | null) ?? null,
				primer_periodo_fecha: (p.primer_periodo_fecha as string | null) ?? null,
				segundo_periodo_fecha: (p.segundo_periodo_fecha as string | null) ?? null,
			}),
			primerPeriodoFecha: p.primer_periodo_fecha ?? null,
			segundoPeriodoFecha: p.segundo_periodo_fecha ?? null,
			actualizadoEn: p.actualizado_en ?? null,
			gruposAsignados: conteos.get(String(p.id)) ?? 0,
		}));
		return NextResponse.json({ periodos: lista });
	} catch (e) {
		console.error("periodos GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
