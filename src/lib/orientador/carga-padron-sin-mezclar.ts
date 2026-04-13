import type { SupabaseClient } from "@supabase/supabase-js";

const RX_UUID =
	/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** UUID en forma canónica (minúsculas) para comparar líneas de carga y padrón. */
export function normalizarUuidPadron(v: unknown): string | null {
	if (v == null || typeof v !== "string") {
		return null;
	}
	const t = v.trim().toLowerCase();
	return RX_UUID.test(t) ? t : null;
}

export type FilaVistaCargaLinea = {
	id: string;
	nombreCompleto: string;
	padronId: string;
	cuentaId: string | null;
	grupoLetra: string;
	esSoloPadron?: boolean;
};

/**
 * Un mismo `padron_id` no debe aparecer dos veces (p. ej. fila de línea + fila sintética `padron:`).
 * Se conserva la fila de `carga_alumnos_linea` frente a `esSoloPadron`.
 */
export function dedupeLineasPorGrupoPreferirLinea(
	mapa: Record<string, FilaVistaCargaLinea[]>,
): Record<string, FilaVistaCargaLinea[]> {
	const out: Record<string, FilaVistaCargaLinea[]> = {};
	for (const [letra, filas] of Object.entries(mapa)) {
		const porPid = new Map<string, FilaVistaCargaLinea>();
		const sinUuid: FilaVistaCargaLinea[] = [];
		for (const f of filas) {
			const id = normalizarUuidPadron(f.padronId);
			if (!id) {
				sinUuid.push(f);
				continue;
			}
			const prev = porPid.get(id);
			if (!prev) {
				porPid.set(id, f);
				continue;
			}
			if (!f.esSoloPadron && prev.esSoloPadron) {
				porPid.set(id, f);
			}
		}
		out[letra] = [...porPid.values(), ...sinUuid];
	}
	return out;
}

export function padronIdsDesdeLineasCarga(
	lineas: { padron_id?: unknown }[] | null | undefined,
): Set<string> {
	const s = new Set<string>();
	for (const ln of lineas ?? []) {
		const id = normalizarUuidPadron(ln.padron_id);
		if (id) {
			s.add(id);
		}
	}
	return s;
}

/**
 * Padron_ids que ya están vinculados a otra carga (no a `cargaIdExcluir`).
 * Evita mostrar en una carga alumnos que pertenecen solo al padrón compartido pero a otra `carga_alumnos_linea`.
 */
export async function padronIdsConLineaEnOtraCarga(
	supabase: SupabaseClient,
	padronIds: string[],
	cargaIdExcluir: string,
): Promise<Set<string>> {
	const out = new Set<string>();
	if (padronIds.length === 0 || !cargaIdExcluir.trim()) {
		return out;
	}
	const { data } = await supabase
		.from("carga_alumnos_linea")
		.select("padron_id")
		.in("padron_id", padronIds)
		.neq("carga_id", cargaIdExcluir);
	for (const r of data ?? []) {
		const id = normalizarUuidPadron((r as { padron_id?: string }).padron_id);
		if (id) {
			out.add(id);
		}
	}
	return out;
}
