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
const CORREO_ORIENTADOR_REGEX = /^[a-z]+(?:\.[a-z]+)@cecyteh\.edu\.mx$/;

function esCorreoOrientadorValido(email: string): boolean {
	if (!CORREO_ORIENTADOR_REGEX.test(email)) {
		return false;
	}
	const local = email.split("@")[0] ?? "";
	return !/\d/.test(local);
}

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
	if (!esCorreoOrientadorValido(email)) {
		return NextResponse.json({ error: "Error de acceso" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: fila, error } = await supabase
			.from("orientadores")
			.select("id, email, password_hash, nombre, estado_acceso, rol_panel")
			.eq("email", email)
			.maybeSingle();

		if (error) {
			console.error("orientador acceso", error);
			return NextResponse.json({ error: "Error al verificar credenciales" }, { status: 500 });
		}

		if (!fila?.id) {
			const hash = await bcrypt.hash(password, 10);
			const { data: pendiente, error: errPend } = await supabase
				.from("orientador_solicitudes_acceso")
				.insert({
					email,
					password_hash: hash,
					estado: "pendiente",
				})
				.select("id")
				.maybeSingle();
			if (errPend) {
				if (String(errPend.code) === "23505") {
					return NextResponse.json(
						{ error: "Tu solicitud ya existe y está pendiente de revisión." },
						{ status: 409 },
					);
				}
				console.error("orientador acceso solicitud", errPend);
				return NextResponse.json({ error: "No se pudo enviar la solicitud de acceso" }, { status: 500 });
			}
			return NextResponse.json(
				{
					ok: true,
					solicitudEnviada: true,
					solicitudId: pendiente?.id ?? null,
					mensaje: "Solicitud enviada. Espera aprobación del orientador.",
				},
				{ status: 202 },
			);
		}

		const estadoAcceso = String(fila.estado_acceso ?? "activo").trim().toLowerCase();
		if (estadoAcceso !== "activo") {
			return NextResponse.json(
				{
					error:
						"Tu cuenta orientador no está activa. Solicita activación o espera aprobación del orientador administrador.",
				},
				{ status: 403 },
			);
		}

		if (!fila.password_hash) {
			return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
		}

		const ok = await bcrypt.compare(password, fila.password_hash);
		if (!ok) {
			return NextResponse.json({ error: "Credenciales incorrectas" }, { status: 401 });
		}

		const rolPanel =
			fila.rol_panel === "normal" || fila.rol_panel === "jefe" ? fila.rol_panel : "jefe";
		const token = await firmarTokenOrientador({
			orientadorId: fila.id,
			email: fila.email,
			nombre: typeof fila.nombre === "string" ? fila.nombre : "",
			rolPanel,
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
