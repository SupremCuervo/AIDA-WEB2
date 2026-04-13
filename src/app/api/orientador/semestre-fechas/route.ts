import { NextResponse } from "next/server";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function parseDate(v: unknown): string | null {
	if (v === null || v === undefined || v === "") {
		return null;
	}
	if (typeof v !== "string") {
		return null;
	}
	const s = v.trim();
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return null;
	}
	return s;
}

/** Año de fecha YYYY-MM-DD → nombre tipo 2030-2034 para identificar el ciclo de semestre. */
function nombreAniosDesdeFechasIso(primer: string | null, segundo: string | null): string | null {
	if (primer === null || segundo === null) {
		return null;
	}
	const y1 = Number.parseInt(primer.slice(0, 4), 10);
	const y2 = Number.parseInt(segundo.slice(0, 4), 10);
	if (!Number.isFinite(y1) || !Number.isFinite(y2)) {
		return null;
	}
	return `${y1}-${y2}`;
}

function fechaIsoDesdeDb(v: unknown): string | null {
	if (v === null || v === undefined) {
		return null;
	}
	const s = typeof v === "string" ? v.slice(0, 10) : "";
	if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) {
		return null;
	}
	return s;
}

function faltaColumnaNombreAnios(err: { code?: string; message?: string } | null): boolean {
	if (!err) {
		return false;
	}
	const msg = String(err.message ?? "");
	return err.code === "PGRST204" && msg.includes("nombre_anios");
}

export async function GET() {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	try {
		const supabase = obtenerClienteSupabaseAdmin();
		let data: {
			primer_periodo_fecha?: string | null;
			segundo_periodo_fecha?: string | null;
			nombre_anios?: string | null;
			actualizado_en?: string | null;
		} | null = null;
		const conNombre = await supabase
			.from("orientador_semestre_fechas")
			.select("primer_periodo_fecha, segundo_periodo_fecha, nombre_anios, actualizado_en")
			.order("actualizado_en", { ascending: false })
			.limit(1)
			.maybeSingle();
		if (conNombre.error && faltaColumnaNombreAnios(conNombre.error)) {
			const sinNombre = await supabase
				.from("orientador_semestre_fechas")
				.select("primer_periodo_fecha, segundo_periodo_fecha, actualizado_en")
				.order("actualizado_en", { ascending: false })
				.limit(1)
				.maybeSingle();
			if (sinNombre.error) {
				console.error("semestre fechas GET", sinNombre.error);
				return NextResponse.json({ error: "No se pudo leer la configuración" }, { status: 500 });
			}
			data = sinNombre.data;
		} else if (conNombre.error) {
			console.error("semestre fechas GET", conNombre.error);
			return NextResponse.json({ error: "No se pudo leer la configuración" }, { status: 500 });
		} else {
			data = conNombre.data;
		}
		const primer = (data?.primer_periodo_fecha as string | null) ?? null;
		const segundo = (data?.segundo_periodo_fecha as string | null) ?? null;
		const pIso = typeof primer === "string" ? primer.slice(0, 10) : null;
		const sIso = typeof segundo === "string" ? segundo.slice(0, 10) : null;
		const nombreGuardado = (data?.nombre_anios as string | null) ?? null;
		const nombrePeriodoAnios =
			(nombreGuardado?.trim() || null) ?? nombreAniosDesdeFechasIso(pIso, sIso);
		return NextResponse.json({
			primerPeriodoFecha: primer,
			segundoPeriodoFecha: segundo,
			nombrePeriodoAnios,
			actualizadoEn: data?.actualizado_en ?? null,
		});
	} catch (e) {
		console.error("semestre fechas GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function PATCH(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	let body: { primerPeriodoFecha?: unknown; segundoPeriodoFecha?: unknown };
	try {
		body = (await request.json()) as { primerPeriodoFecha?: unknown; segundoPeriodoFecha?: unknown };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}
	const primer = parseDate(body.primerPeriodoFecha);
	const segundo = parseDate(body.segundoPeriodoFecha);
	if (primer === null && body.primerPeriodoFecha != null && body.primerPeriodoFecha !== "") {
		return NextResponse.json({ error: "primerPeriodoFecha debe ser YYYY-MM-DD o vacío" }, { status: 400 });
	}
	if (segundo === null && body.segundoPeriodoFecha != null && body.segundoPeriodoFecha !== "") {
		return NextResponse.json({ error: "segundoPeriodoFecha debe ser YYYY-MM-DD o vacío" }, { status: 400 });
	}
	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: ultimo, error: errE } = await supabase
			.from("orientador_semestre_fechas")
			.select("id, nombre_anios, primer_periodo_fecha, segundo_periodo_fecha")
			.order("actualizado_en", { ascending: false })
			.limit(1)
			.maybeSingle();
		if (errE) {
			console.error("semestre fechas PATCH leer", errE);
			return NextResponse.json({ error: "No se pudo leer la configuración" }, { status: 500 });
		}
		const nombreNuevo = nombreAniosDesdeFechasIso(primer, segundo);
		const pAnt = fechaIsoDesdeDb(ultimo?.primer_periodo_fecha);
		const sAnt = fechaIsoDesdeDb(ultimo?.segundo_periodo_fecha);
		const nombreGuardadoAnt =
			typeof ultimo?.nombre_anios === "string" ? ultimo.nombre_anios.trim() : "";
		const nombreAnterior =
			nombreGuardadoAnt !== "" ? nombreGuardadoAnt : nombreAniosDesdeFechasIso(pAnt, sAnt);

		/** Si ya había un ciclo con nombre AAAA-AAAA y el nuevo es distinto → nueva fila (no pisar el histórico). */
		const crearNuevaFila =
			nombreNuevo !== null &&
			ultimo?.id &&
			nombreAnterior !== null &&
			nombreNuevo !== nombreAnterior;

		const actualizadoEn = new Date().toISOString();
		const filaCompleta = {
			primer_periodo_fecha: primer,
			segundo_periodo_fecha: segundo,
			nombre_anios: nombreNuevo,
			actualizado_en: actualizadoEn,
		};
		const filaBasica = {
			primer_periodo_fecha: primer,
			segundo_periodo_fecha: segundo,
			actualizado_en: actualizadoEn,
		};

		async function insertarFila(completa: boolean) {
			const fila = completa ? filaCompleta : filaBasica;
			let errI = (await supabase.from("orientador_semestre_fechas").insert(fila)).error;
			if (errI && faltaColumnaNombreAnios(errI)) {
				errI = (await supabase.from("orientador_semestre_fechas").insert(filaBasica)).error;
			}
			return errI;
		}

		async function actualizarUltimo(completa: boolean) {
			const id = ultimo?.id as string;
			const fila = completa ? filaCompleta : filaBasica;
			let errU = (await supabase.from("orientador_semestre_fechas").update(fila).eq("id", id)).error;
			if (errU && faltaColumnaNombreAnios(errU)) {
				errU = (await supabase.from("orientador_semestre_fechas").update(filaBasica).eq("id", id)).error;
			}
			return errU;
		}

		if (nombreNuevo === null) {
			if (ultimo?.id) {
				const errU = await actualizarUltimo(true);
				if (errU) {
					console.error("semestre fechas PATCH update parcial", errU);
					return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
				}
			} else {
				const errI = await insertarFila(true);
				if (errI) {
					console.error("semestre fechas PATCH insert parcial", errI);
					return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
				}
			}
			return NextResponse.json({
				ok: true,
				nombrePeriodoAnios: nombreNuevo,
				nuevoCicloSemestre: false,
			});
		}

		if (crearNuevaFila) {
			const errI = await insertarFila(true);
			if (errI) {
				console.error("semestre fechas PATCH insert nuevo ciclo", errI);
				return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
			}
			return NextResponse.json({
				ok: true,
				nombrePeriodoAnios: nombreNuevo,
				nuevoCicloSemestre: true,
			});
		}

		if (ultimo?.id) {
			const errU = await actualizarUltimo(true);
			if (errU) {
				console.error("semestre fechas PATCH update", errU);
				return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
			}
		} else {
			const errI = await insertarFila(true);
			if (errI) {
				console.error("semestre fechas PATCH insert", errI);
				return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
			}
		}
		return NextResponse.json({
			ok: true,
			nombrePeriodoAnios: nombreNuevo,
			nuevoCicloSemestre: false,
		});
	} catch (e) {
		console.error("semestre fechas PATCH", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
