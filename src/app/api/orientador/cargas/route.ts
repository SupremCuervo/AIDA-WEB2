import { NextResponse } from "next/server";
import { mapClavesPorLetraCarga } from "@/lib/orientador/carga-claves-vista";
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

export async function GET() {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
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

		const ultima = lista[0] ?? null;
		let lineasPorGrupo: Record<
			string,
			{ id: string; nombreCompleto: string; padronId: string; cuentaId: string | null; grupoLetra: string }[]
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
				const padronIds = lineas.map((l) => l.padron_id as string);
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

				lineasPorGrupo = {};
				for (const ln of lineas) {
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
			}
		}

		return NextResponse.json({
			historial: lista,
			cargaActual: ultima
				? {
						carga: ultima,
						lineasPorGrupo,
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
	};
	try {
		body = (await request.json()) as typeof body;
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const fechaCierre = parseFechaCierre(body.fechaCierre);
	const gruposLetras = [...new Set(parseGruposLetras(body.gruposLetras))];
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

	if (!fechaCierre) {
		return NextResponse.json({ error: "fechaCierre obligatoria (YYYY-MM-DD)" }, { status: 400 });
	}
	if (gruposLetras.length === 0) {
		return NextResponse.json({ error: "Indica al menos un grupo (letras)" }, { status: 400 });
	}
	if (alumnos.length === 0) {
		return NextResponse.json({ error: "Agrega al menos un alumno" }, { status: 400 });
	}

	const supabase = obtenerClienteSupabaseAdmin();

	const tokenPorLetra = new Map<string, { tokenId: string; claveAcceso: string }>();

	for (const g of gruposLetras) {
		const ig = await institucionGrupoIdPorGradoLetra(supabase, gradoCarga, g);
		if (!ig) {
			return NextResponse.json(
				{ error: `No existe la sección ${gradoCarga}° grupo ${g} en el catálogo.` },
				{ status: 400 },
			);
		}
		const tok = await asegurarTokenParaSeccionCarga(supabase, {
			institucionGrupoId: ig,
			gradoCarga,
			letraGrupo: g,
			fechaLimiteIso: fechaCierre,
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
		const { data: creada, error: errCarga } = await supabase
			.from("cargas_alumnos")
			.insert({
				orientador_id: orientador.orientadorId,
				fecha_cierre: fechaCierre,
				grado_carga: gradoCarga,
				grupos_letras: gruposLetras,
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

		const cargaId = creada.id as string;
		const gradoStr = String(gradoCarga);
		let insertados = 0;

		const tokensPorGrupo = gruposLetras.map((letter) => {
			const t = tokenPorLetra.get(letter);
			return {
				grupoLetra: letter,
				claveAcceso: t?.claveAcceso ?? "",
			};
		});

		for (const a of alumnos) {
			const igId = await institucionGrupoIdPorGradoLetra(supabase, gradoCarga, a.grupoLetra);
			const tok = tokenPorLetra.get(a.grupoLetra);
			if (!igId || !tok) {
				continue;
			}
			const { data: pad, error: errP } = await supabase
				.from("padron_alumnos")
				.insert({
					institucion_grupo_id: igId,
					grupo_token_id: tok.tokenId,
					nombre_completo: a.nombreCompleto,
					grado_alumno: gradoStr,
				})
				.select("id")
				.single();

			if (errP || !pad?.id) {
				if (errP?.code === "23505") {
					continue;
				}
				console.error("orientador cargas POST padron", errP);
				await supabase.from("cargas_alumnos").delete().eq("id", cargaId);
				return NextResponse.json(
					{ error: "Error al registrar alumnos en el padrón (¿nombre duplicado en la misma sección?)" },
					{ status: 500 },
				);
			}

			const { error: errL } = await supabase.from("carga_alumnos_linea").insert({
				carga_id: cargaId,
				grupo_letra: a.grupoLetra,
				nombre_completo: a.nombreCompleto,
				padron_id: pad.id as string,
			});

			if (errL) {
				await supabase.from("padron_alumnos").delete().eq("id", pad.id);
				if (errL.code === "23505") {
					continue;
				}
				console.error("orientador cargas POST linea", errL);
				await supabase.from("cargas_alumnos").delete().eq("id", cargaId);
				return NextResponse.json({ error: "No se pudo vincular la línea de carga" }, { status: 500 });
			}
			insertados += 1;
		}

		if (insertados === 0) {
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
			alumnosRegistrados: insertados,
			tokensPorGrupo,
			fechaCierre,
			gradoCarga,
		});
	} catch (e) {
		console.error("orientador cargas POST", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
