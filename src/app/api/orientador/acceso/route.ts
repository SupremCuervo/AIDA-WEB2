import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import {
	COOKIE_ORIENTADOR,
	firmarTokenOrientador,
} from "@/lib/alumno/jwt-cookies";
import { opcionesCookieHttp } from "@/lib/alumno/cookie-opts";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const MAX_AGE_SEG = 12 * 60 * 60;

export async function POST(request: Request) {
	let email = "";
	let password = "";
	try {
		const body = (await request.json()) as { email?: string; password?: string };
		email = typeof body.email === "string" ? body.email.trim().toLowerCase() : "";
		password = typeof body.password === "string" ? body.password : "";
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	if (!email || !password) {
		return NextResponse.json({ error: "Correo y contraseña son obligatorios" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: fila, error } = await supabase
			.from("orientadores")
			.select("id, email, password_hash, nombre")
			.eq("email", email)
			.maybeSingle();

		if (error) {
			console.error("orientador acceso", error);
			return NextResponse.json({ error: "Error al verificar credenciales" }, { status: 500 });
		}

		if (!fila?.password_hash) {
			return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
		}

		const ok = await bcrypt.compare(password, fila.password_hash);
		if (!ok) {
			return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
		}

		const token = await firmarTokenOrientador({
			orientadorId: fila.id,
			email: fila.email,
			nombre: typeof fila.nombre === "string" ? fila.nombre : "",
		});

		const res = NextResponse.json({
			ok: true,
			email: fila.email,
			nombre: fila.nombre ?? "",
		});
		res.cookies.set(COOKIE_ORIENTADOR, token, opcionesCookieHttp(MAX_AGE_SEG));
		return res;
	} catch (e) {
		console.error("orientador acceso", e);
		return NextResponse.json({ error: "Error al iniciar sesión" }, { status: 500 });
	}
}
