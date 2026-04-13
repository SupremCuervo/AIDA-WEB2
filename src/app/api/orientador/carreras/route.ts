import { NextResponse } from "next/server";
import { normalizarCarreraIdPayload } from "@/lib/padron/carrera-padron";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function normalizarNombreCarrera(v: unknown): string {
	return typeof v === "string" ? v.trim().replace(/\s+/g, " ") : "";
}

function normalizarCodigoBaseDesdeNombre(nombre: string): string {
	const sinAcentos = nombre.normalize("NFD").replace(/\p{M}/gu, "");
	const base = sinAcentos
		.toUpperCase()
		.replace(/[^A-Z0-9]+/g, "_")
		.replace(/^_+|_+$/g, "")
		.slice(0, 40);
	return base || "CARRERA";
}

async function generarCodigoCarreraUnico(
	supabase: ReturnType<typeof obtenerClienteSupabaseAdmin>,
	baseCodigo: string,
): Promise<string | null> {
	const base = baseCodigo.trim() || "CARRERA";
	for (let i = 0; i < 1000; i += 1) {
		const intento = i === 0 ? base : `${base}_${i + 1}`;
		const { data, error } = await supabase
			.from("carreras")
			.select("id")
			.eq("codigo", intento)
			.maybeSingle();
		if (error) {
			return null;
		}
		if (!data?.id) {
			return intento;
		}
	}
	return null;
}

export async function GET() {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data, error } = await supabase
			.from("carreras")
			.select("id, codigo, nombre")
			.order("nombre", { ascending: true });

		if (error) {
			console.error("orientador carreras", error);
			return NextResponse.json({ error: "No se pudo cargar el catálogo" }, { status: 500 });
		}

		return NextResponse.json({ carreras: data ?? [] });
	} catch (e) {
		console.error("orientador carreras", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function POST(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	let body: { nombre?: string };
	try {
		body = (await request.json()) as { nombre?: string };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const nombre = normalizarNombreCarrera(body.nombre);
	if (!nombre) {
		return NextResponse.json({ error: "Nombre de carrera obligatorio" }, { status: 400 });
	}
	if (nombre.length > 120) {
		return NextResponse.json({ error: "Nombre de carrera demasiado largo" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: yaExiste, error: errExiste } = await supabase
			.from("carreras")
			.select("id")
			.ilike("nombre", nombre)
			.maybeSingle();
		if (errExiste) {
			console.error("orientador carreras POST existe", errExiste);
			return NextResponse.json({ error: "No se pudo validar el nombre de carrera" }, { status: 500 });
		}
		if (yaExiste?.id) {
			return NextResponse.json({ error: "Ya existe una carrera con ese nombre" }, { status: 409 });
		}

		const codigoBase = normalizarCodigoBaseDesdeNombre(nombre);
		const codigo = await generarCodigoCarreraUnico(supabase, codigoBase);
		if (!codigo) {
			return NextResponse.json({ error: "No se pudo generar un código único para la carrera" }, { status: 500 });
		}

		const { data: creada, error: errIns } = await supabase
			.from("carreras")
			.insert({ nombre, codigo })
			.select("id, codigo, nombre")
			.maybeSingle();
		if (errIns || !creada) {
			console.error("orientador carreras POST insert", errIns);
			return NextResponse.json({ error: "No se pudo crear la carrera" }, { status: 500 });
		}
		return NextResponse.json({ ok: true, carrera: creada });
	} catch (e) {
		console.error("orientador carreras POST", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function PATCH(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	let body: { carreraId?: string | null; nombre?: string };
	try {
		body = (await request.json()) as { carreraId?: string | null; nombre?: string };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const carrera = normalizarCarreraIdPayload(body.carreraId);
	if (!carrera.ok || carrera.valor == null) {
		return NextResponse.json({ error: carrera.ok ? "carreraId obligatorio" : carrera.error }, { status: 400 });
	}

	const nombre = normalizarNombreCarrera(body.nombre);
	if (!nombre) {
		return NextResponse.json({ error: "Nombre de carrera obligatorio" }, { status: 400 });
	}
	if (nombre.length > 120) {
		return NextResponse.json({ error: "Nombre de carrera demasiado largo" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: actual, error: errActual } = await supabase
			.from("carreras")
			.select("id, nombre")
			.eq("id", carrera.valor)
			.maybeSingle();
		if (errActual) {
			console.error("orientador carreras PATCH actual", errActual);
			return NextResponse.json({ error: "No se pudo validar la carrera" }, { status: 500 });
		}
		if (!actual?.id) {
			return NextResponse.json({ error: "Carrera no encontrada" }, { status: 404 });
		}

		const { data: repetida, error: errRep } = await supabase
			.from("carreras")
			.select("id")
			.ilike("nombre", nombre)
			.neq("id", carrera.valor)
			.maybeSingle();
		if (errRep) {
			console.error("orientador carreras PATCH repetida", errRep);
			return NextResponse.json({ error: "No se pudo validar el nombre de carrera" }, { status: 500 });
		}
		if (repetida?.id) {
			return NextResponse.json({ error: "Ya existe una carrera con ese nombre" }, { status: 409 });
		}

		const { data: editada, error: errUpd } = await supabase
			.from("carreras")
			.update({ nombre })
			.eq("id", carrera.valor)
			.select("id, codigo, nombre")
			.maybeSingle();
		if (errUpd || !editada) {
			console.error("orientador carreras PATCH update", errUpd);
			return NextResponse.json({ error: "No se pudo actualizar la carrera" }, { status: 500 });
		}

		return NextResponse.json({ ok: true, carrera: editada });
	} catch (e) {
		console.error("orientador carreras PATCH", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
