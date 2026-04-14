import { NextResponse } from "next/server";
import { mapClavesPorLetraCarga } from "@/lib/orientador/carga-claves-vista";
import {
	dedupeLineasPorGrupoPreferirLinea,
	normalizarUuidPadron,
	padronIdsConLineaEnOtraCarga,
	padronIdsDesdeLineasCarga,
} from "@/lib/orientador/carga-padron-sin-mezclar";
import { asegurarTokenParaSeccionCarga } from "@/lib/orientador/carga-grupo-tokens";
import { institucionGrupoIdPorGradoLetra, normalizarLetraGrupo } from "@/lib/orientador/cargas-helpers";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function parseFechaCierreCarga(v: unknown): string | null {
	if (v === null || v === undefined || v === "") {
		return null;
	}
	if (typeof v !== "string") {
		return null;
	}
	const s = v.trim().slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return null;
	}
	return s;
}

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

		const { data: cargaMasReciente } = await supabase
			.from("cargas_alumnos")
			.select("id")
			.eq("orientador_id", String(carga.orientador_id ?? ""))
			.order("creado_en", { ascending: false })
			.limit(1)
			.maybeSingle();
		const idUltimaCarga = String(cargaMasReciente?.id ?? "");
		const permitirSuplementoPadronSinLinea =
			idUltimaCarga !== "" && idUltimaCarga === String(carga.id ?? "");

		const { data: lineas } = await supabase
			.from("carga_alumnos_linea")
			.select("id, grupo_letra, nombre_completo, padron_id")
			.eq("carga_id", cargaId);

		const existentesLinea = padronIdsDesdeLineasCarga(lineas ?? []);
		const padronIds = [...existentesLinea];
		const cuentaPorPadron = new Map<string, string>();
		if (padronIds.length > 0) {
			const { data: cuentas } = await supabase
				.from("cuentas_alumno")
				.select("id, padron_id")
				.in("padron_id", padronIds);
			for (const cu of cuentas ?? []) {
				const pidC = normalizarUuidPadron(cu.padron_id);
				if (pidC) {
					cuentaPorPadron.set(pidC, cu.id as string);
				}
			}
		}

		const lineasPorGrupo: Record<
			string,
			{
				id: string;
				nombreCompleto: string;
				padronId: string;
				cuentaId: string | null;
				grupoLetra: string;
				esSoloPadron?: boolean;
			}[]
		> = {};
		for (const ln of lineas ?? []) {
			const g = String(ln.grupo_letra).toUpperCase();
			const pidNormLinea = normalizarUuidPadron(ln.padron_id);
			const pidL = pidNormLinea ?? String(ln.padron_id ?? "");
			if (!lineasPorGrupo[g]) {
				lineasPorGrupo[g] = [];
			}
			lineasPorGrupo[g].push({
				id: ln.id as string,
				nombreCompleto: ln.nombre_completo as string,
				padronId: pidL,
				cuentaId: pidNormLinea ? (cuentaPorPadron.get(pidNormLinea) ?? null) : null,
				grupoLetra: g,
			});
		}

		const letrasCarga = ((carga.grupos_letras as string[]) ?? []).map((x) => String(x).toUpperCase());
		if (letrasCarga.length > 0 && permitirSuplementoPadronSinLinea) {
			const { data: secciones } = await supabase
				.from("institucion_grupos")
				.select("id, grupo")
				.eq("grado", String(carga.grado_carga))
				.in("grupo", letrasCarga);
			const seccionIdALetra = new Map<string, string>();
			for (const s of secciones ?? []) {
				const sid = String(s.id ?? "");
				const letra = String(s.grupo ?? "").toUpperCase();
				if (sid && letra) {
					seccionIdALetra.set(sid, letra);
				}
			}
			const seccionIds = [...seccionIdALetra.keys()];
			if (seccionIds.length > 0) {
				const { data: padron } = await supabase
					.from("padron_alumnos")
					.select("id, nombre_completo, institucion_grupo_id")
					.in("institucion_grupo_id", seccionIds);
				const existentes = existentesLinea;
				const faltanCuenta: string[] = [];
				for (const p of padron ?? []) {
					const pid = normalizarUuidPadron(p.id) ?? String(p.id ?? "").trim();
					if (pid && !existentes.has(pid)) {
						faltanCuenta.push(pid);
					}
				}
				const padronSoloOtraCarga =
					faltanCuenta.length > 0
						? await padronIdsConLineaEnOtraCarga(supabase, faltanCuenta, cargaId)
						: new Set<string>();
				const faltanSoloEstaVista = faltanCuenta.filter((id) => !padronSoloOtraCarga.has(id));
				const cuentaPorPadronExtra = new Map<string, string>();
				if (faltanSoloEstaVista.length > 0) {
					const { data: cuentasExtra } = await supabase
						.from("cuentas_alumno")
						.select("id, padron_id")
						.in("padron_id", faltanSoloEstaVista);
					for (const cu of cuentasExtra ?? []) {
						const pc = normalizarUuidPadron(cu.padron_id);
						if (pc) {
							cuentaPorPadronExtra.set(pc, String(cu.id ?? ""));
						}
					}
				}
				for (const p of padron ?? []) {
					const pid = normalizarUuidPadron(p.id) ?? String(p.id ?? "").trim();
					if (!pid || existentes.has(pid) || padronSoloOtraCarga.has(pid)) {
						continue;
					}
					const ig = String(p.institucion_grupo_id ?? "");
					const letra = seccionIdALetra.get(ig);
					if (!letra) {
						continue;
					}
					if (!lineasPorGrupo[letra]) {
						lineasPorGrupo[letra] = [];
					}
					lineasPorGrupo[letra].push({
						id: `padron:${pid}`,
						nombreCompleto: String(p.nombre_completo ?? ""),
						padronId: pid,
						cuentaId: cuentaPorPadronExtra.get(pid) ?? null,
						grupoLetra: letra,
						esSoloPadron: true,
					});
				}
			}
		}

		const gradoC = Number(carga.grado_carga);
		const letras = (carga.grupos_letras as string[]) ?? [];
		const clavesPorGrupo = await mapClavesPorLetraCarga(supabase, gradoC, letras);

		const lineasPorGrupoDedup = dedupeLineasPorGrupoPreferirLinea(lineasPorGrupo);

		return NextResponse.json({
			carga: {
				id: carga.id as string,
				fechaCierre: carga.fecha_cierre as string,
				gradoCarga: gradoC,
				gruposLetras: letras,
				creadoEn: carga.creado_en as string,
			},
			clavesPorGrupo,
			lineasPorGrupo: lineasPorGrupoDedup,
		});
	} catch (e) {
		console.error("cargas [cargaId] GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

/**
 * Actualiza la fecha de cierre de la carga y sincroniza `fecha_limite_entrega` en los `grupo_tokens` de cada letra.
 */
export async function PATCH(
	request: Request,
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
	let body: { fechaCierre?: unknown };
	try {
		body = (await request.json()) as { fechaCierre?: unknown };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}
	const fechaCierre = parseFechaCierreCarga(body.fechaCierre);
	if (!fechaCierre) {
		return NextResponse.json({ error: "fechaCierre inválida (usa YYYY-MM-DD)" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: carga, error: errC } = await supabase
			.from("cargas_alumnos")
			.select("id, fecha_cierre, grado_carga, grupos_letras, creado_en, orientador_id")
			.eq("id", cargaId)
			.maybeSingle();

		if (errC || !carga) {
			return NextResponse.json({ error: "Carga no encontrada" }, { status: 404 });
		}
		if ((carga.orientador_id as string) !== orientador.orientadorId) {
			return NextResponse.json({ error: "No autorizado" }, { status: 403 });
		}

		const gradoC = Number(carga.grado_carga);
		const letras = ((carga.grupos_letras as string[]) ?? []).map((x) => normalizarLetraGrupo(String(x))).filter(Boolean);

		const { error: errU } = await supabase
			.from("cargas_alumnos")
			.update({ fecha_cierre: fechaCierre })
			.eq("id", cargaId);
		if (errU) {
			console.error("cargas [cargaId] PATCH fecha", errU);
			return NextResponse.json({ error: "No se pudo actualizar la fecha" }, { status: 500 });
		}

		for (const L of letras) {
			const igId = await institucionGrupoIdPorGradoLetra(supabase, gradoC, L);
			if (!igId) {
				continue;
			}
			const tok = await asegurarTokenParaSeccionCarga(supabase, {
				institucionGrupoId: igId,
				gradoCarga: gradoC,
				letraGrupo: L,
				fechaLimiteIso: fechaCierre,
			});
			if ("error" in tok) {
				console.error("cargas [cargaId] PATCH token", L, tok.error);
				return NextResponse.json({ error: tok.error }, { status: 500 });
			}
		}

		const clavesPorGrupo = await mapClavesPorLetraCarga(supabase, gradoC, letras);

		return NextResponse.json({
			ok: true,
			carga: {
				id: carga.id as string,
				fechaCierre,
				gradoCarga: gradoC,
				gruposLetras: letras,
				creadoEn: carga.creado_en as string,
			},
			clavesPorGrupo,
		});
	} catch (e) {
		console.error("cargas [cargaId] PATCH", e);
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
