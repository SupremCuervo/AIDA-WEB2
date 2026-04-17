import { NextResponse } from "next/server";
import { mapClavesPorLetraCarga } from "@/lib/orientador/carga-claves-vista";
import {
	dedupeLineasPorGrupoPreferirLinea,
	normalizarUuidPadron,
	padronIdsConLineaEnOtraCarga,
	padronIdsDesdeLineasCarga,
} from "@/lib/orientador/carga-padron-sin-mezclar";
import { asegurarTokenParaSeccionCarga } from "@/lib/orientador/carga-grupo-tokens";
import {
	deduplicarFilasCarga,
	institucionGrupoIdPorGradoLetra,
	normalizarLetraGrupo,
	type FilaAlumnoCargaInput,
} from "@/lib/orientador/cargas-helpers";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

function parseFechaCierre(v: unknown): string | null {
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

function fechaSoloDia(v: string): string {
	return v.trim().slice(0, 10);
}

function parseGruposLetras(raw: unknown): string[] {
	if (typeof raw === "string") {
		return raw
			.split(/[,;\s]+/)
			.map((x) => normalizarLetraGrupo(x))
			.filter(Boolean);
	}
	if (!Array.isArray(raw)) {
		return [];
	}
	return raw.map((x) => normalizarLetraGrupo(String(x))).filter(Boolean);
}

export async function GET(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	const urlReq = new URL(request.url);
	const soloHistorial =
		urlReq.searchParams.get("soloHistorial") === "1" ||
		urlReq.searchParams.get("soloHistorial") === "true";

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: cargas, error } = await supabase
			.from("cargas_alumnos")
			.select("id, fecha_cierre, grado_carga, grupos_letras, creado_en, orientador_id")
			.order("creado_en", { ascending: false });

		if (error) {
			if (error.code === "42P01" || error.message?.includes("does not exist")) {
				return NextResponse.json({
					historial: [],
					cargaActual: null,
					clavesPorGrupoUltima: {},
					tablasCargasPendientes: true,
				});
			}
			console.error("orientador cargas GET", error);
			return NextResponse.json({ error: "No se pudieron listar las cargas" }, { status: 500 });
		}

		const lista = (cargas ?? []).map((c) => ({
			id: c.id as string,
			fechaCierre: c.fecha_cierre as string,
			gradoCarga: c.grado_carga as number,
			gruposLetras: (c.grupos_letras as string[]) ?? [],
			creadoEn: c.creado_en as string,
		}));

		if (soloHistorial) {
			return NextResponse.json({
				historial: lista,
				cargaActual: null,
				clavesPorGrupoUltima: {},
			});
		}

		const ultima = lista[0] ?? null;
		let lineasPorGrupo: Record<
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

		let clavesPorGrupoUltima: Record<string, string> = {};

		if (ultima) {
			clavesPorGrupoUltima = await mapClavesPorLetraCarga(
				supabase,
				ultima.gradoCarga,
				ultima.gruposLetras,
			);

			const { data: lineas, error: errL } = await supabase
				.from("carga_alumnos_linea")
				.select("id, grupo_letra, nombre_completo, padron_id")
				.eq("carga_id", ultima.id);

			if (!errL && lineas) {
				const existentesLinea = padronIdsDesdeLineasCarga(lineas);
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

				lineasPorGrupo = {};
				for (const ln of lineas) {
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
			}

			const letrasCarga = (ultima.gruposLetras ?? []).map((x) => String(x).toUpperCase());
			if (letrasCarga.length > 0) {
				const { data: secciones } = await supabase
					.from("institucion_grupos")
					.select("id, grupo")
					.eq("grado", String(ultima.gradoCarga))
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
					const faltanCuenta: string[] = [];
					const existentes = new Set<string>();
					for (const filas of Object.values(lineasPorGrupo)) {
						for (const f of filas) {
							const pidF = normalizarUuidPadron(f.padronId) ?? f.padronId.trim();
							if (pidF) {
								existentes.add(pidF);
							}
						}
					}
					for (const p of padron ?? []) {
						const pid = normalizarUuidPadron(p.id) ?? String(p.id ?? "").trim();
						if (pid && !existentes.has(pid)) {
							faltanCuenta.push(pid);
						}
					}
					const padronSoloOtraCarga =
						faltanCuenta.length > 0
							? await padronIdsConLineaEnOtraCarga(supabase, faltanCuenta, ultima.id)
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
		}

		const lineasUltimaDedup = ultima
			? dedupeLineasPorGrupoPreferirLinea(lineasPorGrupo)
			: lineasPorGrupo;

		return NextResponse.json({
			historial: lista,
			cargaActual: ultima
				? {
						carga: ultima,
						lineasPorGrupo: lineasUltimaDedup,
					}
				: null,
			clavesPorGrupoUltima,
		});
	} catch (e) {
		console.error("orientador cargas GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function POST(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	let body: {
		gruposLetras?: unknown;
		fechaCierre?: unknown;
		gradoCarga?: unknown;
		alumnos?: unknown;
		cargaId?: unknown;
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const fechaCierre = parseFechaCierre(body.fechaCierre);
	const gruposLetras = [...new Set(parseGruposLetras(body.gruposLetras))];
	const cargaIdSolicitada =
		typeof body.cargaId === "string" && body.cargaId.trim() !== "" ? body.cargaId.trim() : null;
	const gradoCarga =
		typeof body.gradoCarga === "number" && Number.isFinite(body.gradoCarga)
			? Math.min(6, Math.max(1, Math.floor(body.gradoCarga)))
			: 1;

	const alumnosRaw = Array.isArray(body.alumnos) ? body.alumnos : [];
	const filasParse: FilaAlumnoCargaInput[] = [];
	for (const item of alumnosRaw) {
		if (!item || typeof item !== "object") {
			continue;
		}
		const o = item as { grupoLetra?: unknown; nombreCompleto?: unknown };
		const gl = typeof o.grupoLetra === "string" ? o.grupoLetra : "";
		const nc = typeof o.nombreCompleto === "string" ? o.nombreCompleto : "";
		filasParse.push({ grupoLetra: gl, nombreCompleto: nc });
	}
	const alumnos = deduplicarFilasCarga(filasParse);

	if (!fechaCierre && !cargaIdSolicitada) {
		return NextResponse.json({ error: "fechaCierre obligatoria (YYYY-MM-DD)" }, { status: 400 });
	}
	if (gruposLetras.length === 0) {
		return NextResponse.json({ error: "Indica al menos un grupo (letras)" }, { status: 400 });
	}

	const supabase = obtenerClienteSupabaseAdmin();

	function letrasUnicasOrdenadas(letras: string[]): string[] {
		const set = new Set<string>();
		for (const raw of letras) {
			const g = normalizarLetraGrupo(String(raw));
			if (g) {
				set.add(g);
			}
		}
		return [...set].sort((a, b) => a.localeCompare(b, "es"));
	}

	let cargaObjetivo: {
		id: string;
		fecha_cierre: string;
		grado_carga: number;
		grupos_letras: string[];
	} | null = null;

	if (cargaIdSolicitada) {
		const { data: cargaById, error: errCargaById } = await supabase
			.from("cargas_alumnos")
			.select("id, fecha_cierre, grado_carga, grupos_letras, orientador_id")
			.eq("id", cargaIdSolicitada)
			.eq("orientador_id", orientador.orientadorId)
			.maybeSingle();
		if (errCargaById) {
			console.error("orientador cargas POST cargaId", errCargaById);
			return NextResponse.json({ error: "No se pudo validar la carga seleccionada" }, { status: 500 });
		}
		if (!cargaById?.id) {
			return NextResponse.json(
				{ error: "La carga seleccionada no existe o no pertenece al orientador." },
				{ status: 404 },
			);
		}
		cargaObjetivo = {
			id: String(cargaById.id),
			fecha_cierre: String(cargaById.fecha_cierre),
			grado_carga: Number(cargaById.grado_carga),
			grupos_letras: ((cargaById.grupos_letras as string[] | null) ?? []).map((x) => String(x)),
		};
	} else {
		const { data: cargaMismaFecha } = await supabase
			.from("cargas_alumnos")
			.select("id, fecha_cierre, grado_carga, grupos_letras")
			.eq("orientador_id", orientador.orientadorId)
			.eq("fecha_cierre", fechaCierre)
			.eq("grado_carga", gradoCarga)
			.order("creado_en", { ascending: false })
			.limit(1)
			.maybeSingle();
		if (cargaMismaFecha?.id) {
			cargaObjetivo = {
				id: String(cargaMismaFecha.id),
				fecha_cierre: String(cargaMismaFecha.fecha_cierre),
				grado_carga: Number(cargaMismaFecha.grado_carga),
				grupos_letras: ((cargaMismaFecha.grupos_letras as string[] | null) ?? []).map((x) =>
					String(x),
				),
			};
		}
	}

	const fechaObjetivo = fechaSoloDia(cargaObjetivo?.fecha_cierre ?? fechaCierre ?? "");
	if (!fechaObjetivo) {
		return NextResponse.json({ error: "No se pudo determinar la fecha de cierre de la carga." }, { status: 400 });
	}
	const gradoObjetivo = cargaObjetivo?.grado_carga ?? gradoCarga;
	const letrasPrevias = cargaObjetivo?.grupos_letras ?? [];
	const letrasPrevNorm = letrasUnicasOrdenadas(letrasPrevias);
	const mergedLetras = letrasUnicasOrdenadas([...letrasPrevNorm, ...gruposLetras]);

	const tokenPorLetra = new Map<string, { tokenId: string; claveAcceso: string }>();

	for (const g of mergedLetras) {
		const ig = await institucionGrupoIdPorGradoLetra(supabase, gradoObjetivo, g);
		if (!ig) {
			return NextResponse.json(
				{ error: `No existe la sección ${gradoObjetivo}° grupo ${g} en el catálogo.` },
				{ status: 400 },
			);
		}
		const tok = await asegurarTokenParaSeccionCarga(supabase, {
			institucionGrupoId: ig,
			gradoCarga: gradoObjetivo,
			letraGrupo: g,
			fechaLimiteIso: fechaObjetivo,
		});
		if ("error" in tok) {
			return NextResponse.json({ error: tok.error }, { status: 500 });
		}
		tokenPorLetra.set(g, { tokenId: tok.tokenId, claveAcceso: tok.claveAcceso });
	}

	for (const a of alumnos) {
		if (!gruposLetras.includes(a.grupoLetra)) {
			return NextResponse.json(
				{ error: `El grupo ${a.grupoLetra} no está en la lista de grupos de la carga.` },
				{ status: 400 },
			);
		}
	}

	try {
		let cargaId: string;
		let cargaRecienCreada = false;

		if (cargaObjetivo?.id) {
			cargaId = cargaObjetivo.id;
			const { error: errUp } = await supabase
				.from("cargas_alumnos")
				.update({ grupos_letras: mergedLetras })
				.eq("id", cargaId);
			if (errUp) {
				console.error("orientador cargas POST fusionar grupos_letras", errUp);
				return NextResponse.json({ error: "No se pudo actualizar la carga del plazo" }, { status: 500 });
			}
		} else {
			const { data: creada, error: errCarga } = await supabase
				.from("cargas_alumnos")
				.insert({
					orientador_id: orientador.orientadorId,
					fecha_cierre: fechaObjetivo,
					grado_carga: gradoObjetivo,
					grupos_letras: mergedLetras,
				})
				.select("id")
				.single();

			if (errCarga || !creada?.id) {
				if (errCarga?.code === "42703" && errCarga.message?.includes("clave_acceso")) {
					return NextResponse.json(
						{
							error:
								"La base de datos aún tiene la columna antigua clave_acceso en cargas_alumnos. Ejecuta supabase/migracion_carga_quitar_clave_global.sql",
						},
						{ status: 503 },
					);
				}
				if (errCarga?.code === "42P01" || errCarga?.message?.includes("does not exist")) {
					return NextResponse.json(
						{
							error:
								"Faltan tablas de cargas en la base de datos. Ejecuta supabase/cargas_alumnos_extension.sql",
						},
						{ status: 503 },
					);
				}
				console.error("orientador cargas POST insert carga", errCarga);
				return NextResponse.json({ error: "No se pudo crear la carga" }, { status: 500 });
			}
			cargaId = creada.id as string;
			cargaRecienCreada = true;
		}

		const gradoStr = String(gradoObjetivo);
		let insertados = 0;

		const tokensPorGrupo = mergedLetras.map((letter) => {
			const t = tokenPorLetra.get(letter);
			return {
				grupoLetra: letter,
				claveAcceso: t?.claveAcceso ?? "",
			};
		});

		for (const a of alumnos) {
			const igId = await institucionGrupoIdPorGradoLetra(supabase, gradoObjetivo, a.grupoLetra);
			const tok = tokenPorLetra.get(a.grupoLetra);
			if (!igId || !tok) {
				continue;
			}
			const nombreNorm = a.nombreCompleto.trim().replace(/\s+/g, " ");
			const { data: pad, error: errP } = await supabase
				.from("padron_alumnos")
				.insert({
					institucion_grupo_id: igId,
					grupo_token_id: tok.tokenId,
					nombre_completo: nombreNorm,
					grado_alumno: gradoStr,
				})
				.select("id")
				.single();

			if (errP || !pad?.id) {
				if (errP?.code === "23505") {
					const { data: existente } = await supabase
						.from("padron_alumnos")
						.select("id, institucion_grupo_id")
						.eq("grupo_token_id", tok.tokenId)
						.eq("nombre_completo", nombreNorm)
						.maybeSingle();
					const pidEx = existente?.id as string | undefined;
					const igEx = existente?.institucion_grupo_id as string | undefined;
					if (!pidEx || String(igEx ?? "") !== String(igId)) {
						continue;
					}
					const { data: lineaYa } = await supabase
						.from("carga_alumnos_linea")
						.select("id")
						.eq("carga_id", cargaId)
						.eq("padron_id", pidEx)
						.maybeSingle();
					if (lineaYa) {
						continue;
					}
					const { error: errLEx } = await supabase.from("carga_alumnos_linea").insert({
						carga_id: cargaId,
						grupo_letra: a.grupoLetra,
						nombre_completo: nombreNorm,
						padron_id: pidEx,
					});
					if (errLEx) {
						if (errLEx.code === "23505") {
							continue;
						}
						console.error("orientador cargas POST linea padron existente", errLEx);
						if (cargaRecienCreada) {
							await supabase.from("cargas_alumnos").delete().eq("id", cargaId);
						}
						return NextResponse.json({ error: "No se pudo vincular la línea de carga" }, { status: 500 });
					}
					insertados += 1;
					continue;
				}
				console.error("orientador cargas POST padron", errP);
				if (cargaRecienCreada) {
					await supabase.from("cargas_alumnos").delete().eq("id", cargaId);
				}
				return NextResponse.json(
					{ error: "Error al registrar alumnos en el padrón (¿nombre duplicado en la misma sección?)" },
					{ status: 500 },
				);
			}

			const { error: errL } = await supabase.from("carga_alumnos_linea").insert({
				carga_id: cargaId,
				grupo_letra: a.grupoLetra,
				nombre_completo: nombreNorm,
				padron_id: pad.id as string,
			});

			if (errL) {
				await supabase.from("padron_alumnos").delete().eq("id", pad.id);
				if (errL.code === "23505") {
					continue;
				}
				console.error("orientador cargas POST linea", errL);
				if (cargaRecienCreada) {
					await supabase.from("cargas_alumnos").delete().eq("id", cargaId);
				}
				return NextResponse.json({ error: "No se pudo vincular la línea de carga" }, { status: 500 });
			}
			insertados += 1;
		}

		if (cargaRecienCreada && alumnos.length > 0 && insertados === 0) {
			await supabase.from("cargas_alumnos").delete().eq("id", cargaId);
			return NextResponse.json(
				{
					error:
						"No se registró ningún alumno (posible duplicado de nombre en la misma sección del padrón).",
				},
				{ status: 409 },
			);
		}

		return NextResponse.json({
			ok: true,
			cargaId,
			fusionada: !cargaRecienCreada,
			alumnosRegistrados: insertados,
			tokensPorGrupo,
			fechaCierre: fechaObjetivo,
			gradoCarga: gradoObjetivo,
		});
	} catch (e) {
		console.error("orientador cargas POST", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
