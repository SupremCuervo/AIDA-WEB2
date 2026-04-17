type JsonRecord = Record<string, unknown>;

function filaDetalleReciente(detalle: unknown): JsonRecord | null {
	if (detalle == null || typeof detalle !== "object" || Array.isArray(detalle)) {
		return null;
	}
	const d = detalle as JsonRecord;
	const despues = d.despues;
	const antes = d.antes;
	if (despues != null && typeof despues === "object" && !Array.isArray(despues)) {
		return despues as JsonRecord;
	}
	if (antes != null && typeof antes === "object" && !Array.isArray(antes)) {
		return antes as JsonRecord;
	}
	return null;
}

function soloDigitosGrado(s: string): string {
	return String(s).replace(/\D/g, "");
}

function textoPlanoDetalle(v: unknown): string | null {
	if (v == null) {
		return null;
	}
	const t = String(v).trim();
	return t !== "" ? t : null;
}

/**
 * Contexto escolar que la API guarda en `detalle` (sin `antes`/`despues` de triggers).
 */
function gradoGrupoDesdeDetallePlano(
	entidad: string,
	detalle: unknown,
): { grado: string | null; grupo: string | null } | null {
	if (detalle == null || typeof detalle !== "object" || Array.isArray(detalle)) {
		return null;
	}
	const e = entidad.trim().toLowerCase();
	const d = detalle as JsonRecord;

	if (e === "padron_alumnos" || e === "entregas_documento_alumno") {
		const sg = textoPlanoDetalle(d.seccion_grado ?? d.grado_contexto);
		const sgrRaw = textoPlanoDetalle(d.seccion_grupo ?? d.grupo_contexto);
		const sgr = sgrRaw != null ? sgrRaw.toUpperCase() : null;
		if (sg != null || sgr != null) {
			return { grado: sg, grupo: sgr };
		}
	}
	if (e === "grupo_tokens" || e === "institucion_grupos") {
		const g = textoPlanoDetalle(d.seccion_grado ?? d.grado);
		const grRaw = textoPlanoDetalle(d.seccion_grupo ?? d.grupo);
		const gr = grRaw != null ? grRaw.toUpperCase() : null;
		if (g != null || gr != null) {
			return { grado: g, grupo: gr };
		}
	}
	return null;
}

/**
 * Grado / grupo legibles para filtros y columnas del historial.
 * - API: `detalle.seccion_grado` / `detalle.seccion_grupo` (y equivalentes por entidad).
 * - Triggers: `detalle.antes` / `detalle.despues` según `entidad`.
 */
export function gradoGrupoContextoDesdeLog(
	entidad: string,
	detalle: unknown,
): { grado: string | null; grupo: string | null } {
	const e = entidad.trim().toLowerCase();
	const plano = gradoGrupoDesdeDetallePlano(entidad, detalle);
	if (plano) {
		return plano;
	}

	const row = filaDetalleReciente(detalle);
	if (!row) {
		return { grado: null, grupo: null };
	}
	if (e === "grupo_tokens" || e === "institucion_grupos") {
		const g = row.grado;
		const gr = row.grupo;
		return {
			grado: g != null && String(g).trim() !== "" ? String(g).trim() : null,
			grupo:
				gr != null && String(gr).trim() !== ""
					? String(gr).trim().toUpperCase()
					: null,
		};
	}
	if (e === "padron_alumnos") {
		const ga = row.grado_alumno;
		return {
			grado: ga != null && String(ga).trim() !== "" ? String(ga).trim() : null,
			grupo: null,
		};
	}
	return { grado: null, grupo: null };
}

export function coincideFiltroGrado(filtro: string, ctxGrado: string | null): boolean {
	const f = filtro.trim();
	if (f === "") {
		return true;
	}
	if (!ctxGrado) {
		return false;
	}
	const a = f.toLowerCase();
	const b = ctxGrado.toLowerCase();
	if (b.includes(a) || a.includes(b)) {
		return true;
	}
	const df = soloDigitosGrado(f);
	const dc = soloDigitosGrado(ctxGrado);
	return df !== "" && dc !== "" && df === dc;
}

export function coincideFiltroGrupo(filtro: string, ctxGrupo: string | null): boolean {
	const f = filtro.trim().toUpperCase();
	if (f === "") {
		return true;
	}
	if (!ctxGrupo) {
		return false;
	}
	return ctxGrupo.toUpperCase().includes(f) || f.includes(ctxGrupo.toUpperCase());
}
