import { cookies } from "next/headers";
import { NextResponse } from "next/server";
import bcrypt from "bcryptjs";
import { normalizarNombreParaComparar } from "@/lib/alumno/normalizar-nombre";
import {
	COOKIE_ALUMNO,
	COOKIE_CLAVE_OK,
	firmarTokenAlumno,
	verificarTokenClaveOk,
	type PayloadClaveOk,
} from "@/lib/alumno/jwt-cookies";
import { opcionesCookieHttp } from "@/lib/alumno/cookie-opts";
import {
	claveAccesoContextoVencido,
	jsonClaveGrupoVencidaCierraCookie,
} from "@/lib/alumno/requiere-grupo-vigente";
import { gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

const SALT_ROUNDS = 10;

/** Solo al crear cuenta nueva; los accesos con cuenta existente conservan su longitud previa. */
const LONGITUD_MINIMA_CONTRASENA_ALUMNO_NUEVA = 9;

async function completarAccesoConPadron(
	supabase: ReturnType<typeof obtenerClienteSupabaseAdmin>,
	filaPadron: { id: string; nombre_completo: string; grado_alumno: string | null; archivo_muerto_en: string | null },
	grupoLetra: string,
	gradoToken: string,
	password: string,
): Promise<NextResponse> {
	if (filaPadron.archivo_muerto_en != null) {
		return NextResponse.json(
			{
				code: "ARCHIVO_MUERTO",
				error:
					"Tu expediente está en archivo muerto (inactivo). Contacta al orientador si necesitas acceso.",
			},
			{ status: 403 },
		);
	}

	const gradoSesion = gradoMostradoParaAlumno(filaPadron.grado_alumno, gradoToken);

	const { data: cuenta, error: errCuenta } = await supabase
		.from("cuentas_alumno")
		.select("id, password_hash")
		.eq("padron_id", filaPadron.id)
		.maybeSingle();

	if (errCuenta) {
		console.error("acceso cuenta", errCuenta);
		return NextResponse.json({ error: "Error al consultar la cuenta" }, { status: 500 });
	}

	if (cuenta) {
		const ok = await bcrypt.compare(password, cuenta.password_hash);
		if (!ok) {
			return NextResponse.json(
				{
					code: "PASSWORD_INVALID",
					error: "Contraseña incorrecta",
				},
				{ status: 401 },
			);
		}

		const jwt = await firmarTokenAlumno({
			cuentaId: cuenta.id,
			padronId: filaPadron.id,
			nombreCompleto: filaPadron.nombre_completo,
			grupo: grupoLetra,
			grado: gradoSesion,
		});

		const res = NextResponse.json({
			ok: true,
			nombreCompleto: filaPadron.nombre_completo,
			grupo: grupoLetra,
			grado: gradoSesion,
		});
		res.cookies.set(COOKIE_ALUMNO, jwt, opcionesCookieHttp(7 * 24 * 60 * 60));
		res.cookies.delete(COOKIE_CLAVE_OK);
		return res;
	}

	if (password.length < LONGITUD_MINIMA_CONTRASENA_ALUMNO_NUEVA) {
		return NextResponse.json(
			{
				code: "PASSWORD_CORTA",
				error: `La contraseña debe tener al menos ${LONGITUD_MINIMA_CONTRASENA_ALUMNO_NUEVA} caracteres.`,
			},
			{ status: 400 },
		);
	}

	const password_hash = await bcrypt.hash(password, SALT_ROUNDS);
	const { data: nueva, error: errInsert } = await supabase
		.from("cuentas_alumno")
		.insert({ padron_id: filaPadron.id, password_hash })
		.select("id")
		.single();

	if (errInsert || !nueva) {
		console.error("acceso insert cuenta", errInsert);
		return NextResponse.json({ error: "No se pudo crear la cuenta" }, { status: 500 });
	}

	const jwt = await firmarTokenAlumno({
		cuentaId: nueva.id,
		padronId: filaPadron.id,
		nombreCompleto: filaPadron.nombre_completo,
		grupo: grupoLetra,
		grado: gradoSesion,
	});

	const res = NextResponse.json({
		ok: true,
		creada: true,
		nombreCompleto: filaPadron.nombre_completo,
		grupo: grupoLetra,
		grado: gradoSesion,
	});
	res.cookies.set(COOKIE_ALUMNO, jwt, opcionesCookieHttp(7 * 24 * 60 * 60));
	res.cookies.delete(COOKIE_CLAVE_OK);
	return res;
}

async function accesoModoGrupo(
	supabase: ReturnType<typeof obtenerClienteSupabaseAdmin>,
	payloadClave: PayloadClaveOk,
	nombreCompleto: string,
	password: string,
): Promise<NextResponse> {
	if (await claveAccesoContextoVencido(supabase, payloadClave)) {
		return jsonClaveGrupoVencidaCierraCookie();
	}

	const { data: filaGrupoToken, error: errGrupoTok } = await supabase
		.from("grupo_tokens")
		.select("grado")
		.eq("id", payloadClave.grupoTokenId)
		.maybeSingle();
	if (errGrupoTok || !filaGrupoToken) {
		return NextResponse.json(
			{ code: "GRUPO_NO_ENCONTRADO", error: "No se encontró el grupo de la clave." },
			{ status: 403 },
		);
	}
	if (Number.parseInt(String(filaGrupoToken.grado ?? "").trim(), 10) !== 1) {
		return NextResponse.json(
			{
				code: "ACCESO_SOLO_PRIMERO",
				error: "El acceso por clave solo aplica a 1.° grado. Contacta al orientador.",
			},
			{ status: 403 },
		);
	}

	const { data: filasPadron, error: errPadron } = await supabase
		.from("padron_alumnos")
		.select("id, nombre_completo, grado_alumno, archivo_muerto_en")
		.eq("grupo_token_id", payloadClave.grupoTokenId);

	if (errPadron) {
		console.error("acceso padron", errPadron);
		return NextResponse.json({ error: "Error al consultar el padrón" }, { status: 500 });
	}

	const claveNombre = normalizarNombreParaComparar(nombreCompleto);
	const filaPadron = filasPadron?.find(
		(f) => normalizarNombreParaComparar(f.nombre_completo) === claveNombre,
	);

	if (!filaPadron) {
		return NextResponse.json(
			{
				code: "NOT_IN_PADRON",
				error: "Tu nombre no coincide que estes en un grupo.",
			},
			{ status: 403 },
		);
	}

	return completarAccesoConPadron(
		supabase,
		filaPadron,
		payloadClave.grupo,
		payloadClave.grado,
		password,
	);
}

export async function POST(request: Request) {
	const jar = await cookies();
	const tokenClave = jar.get(COOKIE_CLAVE_OK)?.value;
	if (!tokenClave) {
		return NextResponse.json(
			{ code: "SIN_CLAVE", error: "Primero debes validar la clave de acceso" },
			{ status: 401 },
		);
	}

	let payloadClave: PayloadClaveOk;
	try {
		payloadClave = await verificarTokenClaveOk(tokenClave);
	} catch {
		return NextResponse.json(
			{ code: "CLAVE_EXPIRADA", error: "La validación de clave expiró. Vuelve a ingresarla." },
			{ status: 401 },
		);
	}

	let nombreCompleto = "";
	let password = "";
	try {
		const body = (await request.json()) as {
			nombreCompleto?: string;
			password?: string;
		};
		nombreCompleto =
			typeof body.nombreCompleto === "string" ? body.nombreCompleto.trim() : "";
		password = typeof body.password === "string" ? body.password : "";
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}

	if (!nombreCompleto || !password) {
		return NextResponse.json(
			{ error: "Nombre completo y contraseña son obligatorios" },
			{ status: 400 },
		);
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		return accesoModoGrupo(supabase, payloadClave, nombreCompleto, password);
	} catch (e) {
		console.error(e);
		return NextResponse.json(
			{ code: "CONFIG_ERROR", error: "Configuración del servidor incompleta" },
			{ status: 500 },
		);
	}
}
