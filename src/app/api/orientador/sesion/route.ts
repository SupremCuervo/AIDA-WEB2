import { NextResponse } from "next/server";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

export async function GET() {
	const p = await obtenerPayloadOrientador();
	if (!p) {
		return NextResponse.json({ autenticado: false }, { status: 401 });
	}
	return NextResponse.json({
		autenticado: true,
		email: p.email,
		nombre: p.nombre,
	});
}
