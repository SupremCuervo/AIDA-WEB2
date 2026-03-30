import type { SupabaseClient } from "@supabase/supabase-js";
import { GRADO_ESCOLAR_MAX } from "@/lib/padron/grado-alumno";
import {
	aplicarGradoMasivoInterno,
	copiarPeriodosHaciaNuevaSeccion,
	obtenerOCrearInstitucionGrupoId,
} from "@/lib/orientador/aplicar-grado-masivo-interno";

export type ResultadoPromocionSemestre =
	| { ejecutado: false; motivo: string }
	| { ejecutado: true; tipo: "primer" | "segundo" };

function fechaLocalIsoEnZona(ahora: Date, timeZone: string): string {
	const fmt = new Intl.DateTimeFormat("en-CA", {
		timeZone,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	});
	const parts = fmt.formatToParts(ahora);
	const y = parts.find((p) => p.type === "year")?.value;
	const m = parts.find((p) => p.type === "month")?.value;
	const d = parts.find((p) => p.type === "day")?.value;
	if (!y || !m || !d) {
		return ahora.toISOString().slice(0, 10);
	}
	return `${y}-${m}-${d}`;
}

function fechaIsoDesdeDb(v: unknown): string | null {
	if (v == null) {
		return null;
	}
	const s = typeof v === "string" ? v.slice(0, 10) : "";
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return null;
	}
	return s;
}

/**
 * Sube un grado a alumnos activos anclados solo a `institucion_grupo_id` (sin token).
 */
async function promocionarSeccionSinToken(
	supabase: SupabaseClient,
	igId: string,
	gradoActual: number,
	letra: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	if (gradoActual < 1 || gradoActual >= GRADO_ESCOLAR_MAX) {
		return { ok: true };
	}
	const nuevoGrado = gradoActual + 1;
	const igDestino = await obtenerOCrearInstitucionGrupoId(supabase, nuevoGrado, letra);
	if (!igDestino) {
		return { ok: false, error: `No se pudo resolver sección ${nuevoGrado}° ${letra}` };
	}
	await copiarPeriodosHaciaNuevaSeccion(supabase, igId, igDestino);
	const gradoStr = String(nuevoGrado);
	const { error: errU } = await supabase
		.from("padron_alumnos")
		.update({
			grado_alumno: gradoStr,
			institucion_grupo_id: igDestino,
			grupo_token_id: null,
		})
		.eq("institucion_grupo_id", igId)
		.is("grupo_token_id", null)
		.is("archivo_muerto_en", null);
	if (errU) {
		console.error("promocion semestre padron solo ig", errU);
		return { ok: false, error: errU.message };
	}
	return { ok: true };
}

/**
 * Una promoción (+1 grado) para todas las secciones asignadas al ciclo (`periodo_institucion_grupos`).
 * Orden: primero padrón sin token (de grado alto a bajo), luego tokens — evita doble ascenso en la misma corrida.
 */
export async function ejecutarPromocionParaPeriodoSemestre(
	supabase: SupabaseClient,
	periodoSemestreId: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
	const { data: enlaces, error: errE } = await supabase
		.from("periodo_institucion_grupos")
		.select("institucion_grupo_id")
		.eq("periodo_id", periodoSemestreId);
	if (errE) {
		return { ok: false, error: errE.message };
	}
	const igIds = [...new Set((enlaces ?? []).map((r) => r.institucion_grupo_id as string))];
	if (igIds.length === 0) {
		return { ok: true };
	}

	const { data: secciones, error: errS } = await supabase
		.from("institucion_grupos")
		.select("id, grado, grupo")
		.in("id", igIds);
	if (errS) {
		return { ok: false, error: errS.message };
	}

	const ordenadas = [...(secciones ?? [])].sort((a, b) => Number(b.grado) - Number(a.grado));
	for (const ig of ordenadas) {
		const id = ig.id as string;
		const g = Number(ig.grado);
		const letra = String(ig.grupo ?? "").trim().toUpperCase();
		if (!/^[A-Z]$/u.test(letra)) {
			continue;
		}
		const res = await promocionarSeccionSinToken(supabase, id, g, letra);
		if (!res.ok) {
			return { ok: false, error: res.error };
		}
	}

	const { data: tokens, error: errT } = await supabase
		.from("grupo_tokens")
		.select("id, grado")
		.in("institucion_grupo_id", igIds);
	if (errT) {
		return { ok: false, error: errT.message };
	}

	for (const t of tokens ?? []) {
		const raw = String(t.grado ?? "").trim();
		let g = Number.parseInt(raw, 10);
		if (!Number.isFinite(g) || g < 1) {
			g = 1;
		}
		if (g >= GRADO_ESCOLAR_MAX) {
			continue;
		}
		const r = await aplicarGradoMasivoInterno(supabase, t.id as string, g + 1, {
			incluirPadronSoloPrimeroSinToken: false,
		});
		if (!r.ok) {
			return { ok: false, error: r.error };
		}
	}

	return { ok: true };
}

type FilaSemestre = {
	id: string;
	primer_periodo_fecha: string | null;
	segundo_periodo_fecha: string | null;
	promocion_primer_ejecutada_en: string | null;
	promocion_segundo_ejecutada_en: string | null;
};

/**
 * Como máximo una promoción por llamada (primer periodo pendiente antes que segundo).
 */
export async function ejecutarPromocionSemestreSiCorresponde(
	supabase: SupabaseClient,
	opciones?: { timeZone?: string },
): Promise<ResultadoPromocionSemestre> {
	const tz = opciones?.timeZone ?? process.env.CRON_TZ ?? "America/Mexico_City";
	const hoy = fechaLocalIsoEnZona(new Date(), tz);

	const { data: sem, error: errSem } = await supabase
		.from("orientador_semestre_fechas")
		.select(
			"id, primer_periodo_fecha, segundo_periodo_fecha, promocion_primer_ejecutada_en, promocion_segundo_ejecutada_en",
		)
		.order("actualizado_en", { ascending: false })
		.limit(1)
		.maybeSingle();

	if (errSem) {
		const msg = String(errSem.message ?? "");
		if (msg.includes("promocion_primer_ejecutada_en") || msg.includes("column")) {
			return {
				ejecutado: false,
				motivo:
					"Faltan columnas de control en orientador_semestre_fechas; ejecuta supabase/promocion_semestre_automatica.sql",
			};
		}
		return { ejecutado: false, motivo: msg || "No se pudo leer orientador_semestre_fechas" };
	}
	if (!sem) {
		return { ejecutado: false, motivo: "No hay fechas de semestre configuradas" };
	}

	const fila = sem as unknown as FilaSemestre;
	const p = fechaIsoDesdeDb(fila.primer_periodo_fecha);
	const s = fechaIsoDesdeDb(fila.segundo_periodo_fecha);

	const pendientePrimero =
		p != null &&
		hoy >= p &&
		(fila.promocion_primer_ejecutada_en == null || fila.promocion_primer_ejecutada_en === "");
	const pendienteSegundo =
		s != null &&
		hoy >= s &&
		(fila.promocion_segundo_ejecutada_en == null || fila.promocion_segundo_ejecutada_en === "");

	const tipo: "primer" | "segundo" | null = pendientePrimero ? "primer" : pendienteSegundo ? "segundo" : null;
	if (tipo === null) {
		return { ejecutado: false, motivo: "Nada que promocionar hoy (ya aplicado o fechas futuras)" };
	}

	const res = await ejecutarPromocionParaPeriodoSemestre(supabase, fila.id);
	if (!res.ok) {
		return { ejecutado: false, motivo: res.error };
	}

	const marca = new Date().toISOString();
	const patch =
		tipo === "primer"
			? { promocion_primer_ejecutada_en: marca }
			: { promocion_segundo_ejecutada_en: marca };
	const { error: errUp } = await supabase.from("orientador_semestre_fechas").update(patch).eq("id", fila.id);
	if (errUp) {
		return {
			ejecutado: false,
			motivo: `Promoción aplicada pero no se pudo marcar como ejecutada: ${errUp.message}`,
		};
	}

	return { ejecutado: true, tipo };
}
