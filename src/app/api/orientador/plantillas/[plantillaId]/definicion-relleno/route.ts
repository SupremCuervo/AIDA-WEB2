import { NextResponse } from "next/server";
import {
	normalizarDefinicionRelleno,
	type PlantillaDefinicionRelleno,
} from "@/lib/orientador/plantilla-definicion-relleno";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

export async function GET(
	_request: Request,
	ctx: { params: Promise<{ plantillaId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const { plantillaId } = await ctx.params;
	if (!plantillaId) {
		return NextResponse.json({ error: "ID no válido" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: fila, error: errF } = await supabase
			.from("orientador_plantillas")
			.select("id, definicion_relleno")
			.eq("id", plantillaId)
			.maybeSingle();

		if (errF || !fila) {
			return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
		}

		const def = normalizarDefinicionRelleno(fila.definicion_relleno);
		const cuerpo: PlantillaDefinicionRelleno = def ?? { version: 1, campos: [] };

		return NextResponse.json({ ok: true, definicion: cuerpo });
	} catch (e) {
		console.error("definicion-relleno GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function PUT(
	request: Request,
	ctx: { params: Promise<{ plantillaId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const { plantillaId } = await ctx.params;
	if (!plantillaId) {
		return NextResponse.json({ error: "ID no válido" }, { status: 400 });
	}

	let body: unknown;
	try {
		body = await request.json();
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	const raw = (body as { definicion?: unknown }).definicion;
	const def = normalizarDefinicionRelleno(raw);
	if (!def) {
		return NextResponse.json(
			{ error: "definicion inválida: se espera { version: 1, campos: [...] }" },
			{ status: 400 },
		);
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: existe, error: errE } = await supabase
			.from("orientador_plantillas")
			.select("id")
			.eq("id", plantillaId)
			.maybeSingle();

		if (errE || !existe) {
			return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
		}

		const { error: errU } = await supabase
			.from("orientador_plantillas")
			.update({ definicion_relleno: def as unknown as Record<string, unknown> })
			.eq("id", plantillaId);

		if (errU) {
			console.error("definicion-relleno PUT", errU);
			if (errU.message?.includes("definicion_relleno") || errU.code === "42703") {
				return NextResponse.json(
					{
						error:
							"Falta la columna definicion_relleno. Ejecuta supabase/plantillas_definicion_relleno.sql en Supabase.",
					},
					{ status: 500 },
				);
			}
			return NextResponse.json({ error: "No se pudo guardar" }, { status: 500 });
		}

		return NextResponse.json({ ok: true, definicion: def });
	} catch (e) {
		console.error("definicion-relleno PUT", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
