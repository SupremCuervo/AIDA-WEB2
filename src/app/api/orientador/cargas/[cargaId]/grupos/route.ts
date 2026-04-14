import { NextResponse } from "next/server";
import { normalizarUuidPadron } from "@/lib/orientador/carga-padron-sin-mezclar";
import { normalizarLetraGrupo } from "@/lib/orientador/cargas-helpers";
import { normalizarCarreraIdPayload } from "@/lib/padron/carrera-padron";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

/**
 * Secciones visibles para una carga: según dónde están hoy los alumnos activos de esa carga (líneas).
 * Si una letra no tiene líneas aún, se usa el catálogo con el grado declarado en la carga.
 */
export async function GET(
	request: Request,
	ctx: { params: Promise<{ cargaId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	const { cargaId } = await ctx.params;
	if (!cargaId?.trim()) {
		return NextResponse.json({ error: "Carga no válida" }, { status: 400 });
	}
	const url = new URL(request.url);
	const carreraParam = url.searchParams.get("carreraId")?.trim() ?? "";
	const normCarrera = normalizarCarreraIdPayload(carreraParam);
	const carreraFiltro =
		normCarrera.ok && normCarrera.valor ? normCarrera.valor : null;
	if (carreraParam !== "" && (!normCarrera.ok || !normCarrera.valor)) {
		return NextResponse.json({ error: "carreraId no válido" }, { status: 400 });
	}
	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: carga, error: errC } = await supabase
			.from("cargas_alumnos")
			.select("id, fecha_cierre, grado_carga, grupos_letras")
			.eq("id", cargaId.trim())
			.maybeSingle();
		if (errC || !carga) {
			return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
		}

		const gradoNum = Number(carga.grado_carga) || 1;
		const letras = [
			...new Set(
				((carga.grupos_letras as string[]) ?? [])
					.map((x) => normalizarLetraGrupo(String(x)))
					.filter(Boolean),
			),
		].sort((a, b) => a.localeCompare(b, "es"));

		if (letras.length === 0) {
			return NextResponse.json({ grupos: [] });
		}

		const { data: todasLineas, error: errLineas } = await supabase
			.from("carga_alumnos_linea")
			.select("padron_id, grupo_letra")
			.eq("carga_id", cargaId.trim());

		if (errLineas) {
			console.error("carga grupos GET lineas", errLineas);
			return NextResponse.json({ error: "No se pudieron leer las líneas de la carga" }, { status: 500 });
		}

		const porLetra = new Map<string, Set<string>>();
		for (const L of letras) {
			porLetra.set(L, new Set());
		}
		for (const ln of todasLineas ?? []) {
			const L = normalizarLetraGrupo(String((ln as { grupo_letra?: string }).grupo_letra ?? ""));
			if (!porLetra.has(L)) {
				continue;
			}
			const pid = normalizarUuidPadron((ln as { padron_id?: unknown }).padron_id);
			if (pid) {
				porLetra.get(L)!.add(pid);
			}
		}

		const allPids = [...new Set([...porLetra.values()].flatMap((s) => [...s]))];
		const padronIgPorPid = new Map<string, string>();
		const pidCarrera = new Map<string, string>();
		if (allPids.length > 0) {
			const { data: pa, error: errP } = await supabase
				.from("padron_alumnos")
				.select("id, institucion_grupo_id, carrera_id")
				.in("id", allPids)
				.is("archivo_muerto_en", null);
			if (errP) {
				console.error("carga grupos GET padron", errP);
				return NextResponse.json({ error: "No se pudo leer el padrón" }, { status: 500 });
			}
			for (const row of pa ?? []) {
				const id = String(row.id ?? "");
				const ig = row.institucion_grupo_id ? String(row.institucion_grupo_id) : "";
				const cr = row.carrera_id ? String(row.carrera_id) : "";
				if (id) {
					pidCarrera.set(id, cr);
				}
				if (id && ig) {
					padronIgPorPid.set(id, ig);
				}
			}
		}

		const pidsPorIg = new Map<string, Set<string>>();
		for (const L of letras) {
			for (const pid of porLetra.get(L) ?? []) {
				const ig = padronIgPorPid.get(pid);
				if (!ig) {
					continue;
				}
				if (!pidsPorIg.has(ig)) {
					pidsPorIg.set(ig, new Set());
				}
				pidsPorIg.get(ig)!.add(pid);
			}
		}

		const igIdsDesdePadron = new Set<string>();
		const letrasSinPadronActivo: string[] = [];

		for (const L of letras) {
			const pids = porLetra.get(L) ?? new Set();
			const igs = new Set<string>();
			for (const pid of pids) {
				const ig = padronIgPorPid.get(pid);
				if (ig) {
					igs.add(ig);
				}
			}
			if (igs.size === 0) {
				letrasSinPadronActivo.push(L);
			} else {
				for (const ig of igs) {
					igIdsDesdePadron.add(ig);
				}
			}
		}

		type FilaIg = { id: string; grado: string | number; grupo: string };
		const filasPorIgId = new Map<string, FilaIg>();

		if (igIdsDesdePadron.size > 0) {
			const { data: secciones, error: errS } = await supabase
				.from("institucion_grupos")
				.select("id, grado, grupo")
				.in("id", [...igIdsDesdePadron]);
			if (errS) {
				console.error("carga grupos GET secciones padron", errS);
				return NextResponse.json({ error: "No se pudieron leer las secciones" }, { status: 500 });
			}
			for (const s of secciones ?? []) {
				filasPorIgId.set(String(s.id), s as FilaIg);
			}
		}

		if (letrasSinPadronActivo.length > 0) {
			const { data: catRows, error: errCat } = await supabase
				.from("institucion_grupos")
				.select("id, grado, grupo")
				.eq("grado", String(gradoNum))
				.in("grupo", letrasSinPadronActivo);
			if (errCat) {
				console.error("carga grupos GET catalogo", errCat);
				return NextResponse.json({ error: "No se pudieron leer el catálogo" }, { status: 500 });
			}
			for (const s of catRows ?? []) {
				filasPorIgId.set(String(s.id), s as FilaIg);
			}
		}

		let ordenados = [...filasPorIgId.values()].sort((a, b) => {
			const ga = Number.parseInt(String(a.grado), 10) || 0;
			const gb = Number.parseInt(String(b.grado), 10) || 0;
			if (ga !== gb) {
				return ga - gb;
			}
			return String(a.grupo).localeCompare(String(b.grupo), "es");
		});

		if (carreraFiltro) {
			ordenados = ordenados.filter((s) => {
				const ig = String(s.id);
				const pids = pidsPorIg.get(ig);
				if (!pids || pids.size === 0) {
					return false;
				}
				for (const pid of pids) {
					if (pidCarrera.get(pid) === carreraFiltro) {
						return true;
					}
				}
				return false;
			});
		}

		const igIds = ordenados.map((s) => String(s.id));
		const tokenPorIg = new Map<string, { id: string; clave_acceso: string }>();
		if (igIds.length > 0) {
			const { data: tokens, error: errT } = await supabase
				.from("grupo_tokens")
				.select("id, clave_acceso, institucion_grupo_id")
				.in("institucion_grupo_id", igIds);
			if (!errT && tokens) {
				for (const t of tokens) {
					if (t.institucion_grupo_id) {
						tokenPorIg.set(String(t.institucion_grupo_id), {
							id: String(t.id),
							clave_acceso: String(t.clave_acceso ?? ""),
						});
					}
				}
			}
		}

		return NextResponse.json({
			grupos: ordenados.map((s) => {
				const ig = String(s.id);
				const tok = tokenPorIg.get(ig);
				return {
					institucionGrupoId: ig,
					grupoTokenId: tok?.id ?? null,
					grado: String(s.grado),
					grupo: s.grupo,
					claveAcceso: tok?.clave_acceso ?? "",
				};
			}),
		});
	} catch (e) {
		console.error("carga grupos GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
