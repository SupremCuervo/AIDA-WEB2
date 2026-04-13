import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import bcrypt from "npm:bcryptjs@2.4.3";
import { corsHeaders, jsonRes } from "../_shared/cors.ts";

const CORREO_ORIENTADOR_REGEX = /^[a-z]+(?:\.[a-z]+)@cecyteh\.edu\.mx$/;

function esCorreoOrientadorValido(email: string): boolean {
	if (!CORREO_ORIENTADOR_REGEX.test(email)) {
		return false;
	}
	const local = email.split("@")[0] ?? "";
	return !/\d/.test(local);
}

function internalOrientadorEmail(orientadorId: string): string {
	const clean = orientadorId.replace(/-/g, "").toLowerCase();
	return `o_${clean}@aida-mobile.internal`;
}

Deno.serve(async (req) => {
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: corsHeaders });
	}
	if (req.method !== "POST") {
		return jsonRes({ error: "Método no permitido" }, 405);
	}
	try {
		const url = Deno.env.get("SUPABASE_URL") ?? "";
		const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
		if (!url || !service) {
			return jsonRes({ error: "Variables SUPABASE faltantes en el servidor" }, 500);
		}
		const { email, password } = (await req.json()) as {
			email?: string;
			password?: string;
		};
		const em = typeof email === "string" ? email.trim().toLowerCase() : "";
		const pw = typeof password === "string" ? password : "";
		if (!em || !pw) {
			return jsonRes({ error: "Correo y contraseña son obligatorios" }, 400);
		}
		if (!esCorreoOrientadorValido(em)) {
			return jsonRes({ error: "Error de acceso" }, 400);
		}
		const admin = createClient(url, service, {
			auth: { persistSession: false, autoRefreshToken: false },
		});
		const { data: fila, error: errQ } = await admin
			.from("orientadores")
			.select("id, email, password_hash, nombre, estado_acceso")
			.eq("email", em)
			.maybeSingle();
		if (errQ) {
			console.error("orientador-sync-auth select orientadores", errQ);
			return jsonRes({ error: "Error al verificar credenciales" }, 500);
		}

		if (!fila?.id) {
			const hash = bcrypt.hashSync(pw, 10);
			const { data: pendiente, error: errPend } = await admin
				.from("orientador_solicitudes_acceso")
				.insert({
					email: em,
					password_hash: hash,
					estado: "pendiente",
				})
				.select("id")
				.maybeSingle();
			if (errPend) {
				if (String(errPend.code) === "23505") {
					return jsonRes(
						{ error: "Tu solicitud ya existe y está pendiente de revisión." },
						409,
					);
				}
				console.error("orientador-sync-auth solicitud", errPend);
				return jsonRes({ error: "No se pudo enviar la solicitud de acceso" }, 500);
			}
			return jsonRes(
				{
					ok: true,
					solicitudEnviada: true,
					solicitudId: pendiente?.id ?? null,
					mensaje: "Solicitud enviada. Espera aprobación del orientador.",
				},
				202,
			);
		}

		const estadoAcceso = String(fila.estado_acceso ?? "activo").trim().toLowerCase();
		if (estadoAcceso !== "activo") {
			return jsonRes(
				{
					error:
						"Tu cuenta orientador no está activa. Solicita activación o espera aprobación del orientador administrador.",
				},
				403,
			);
		}

		if (!fila.password_hash) {
			return jsonRes({ error: "Credenciales incorrectas" }, 401);
		}
		const ok = bcrypt.compareSync(pw, String(fila.password_hash));
		if (!ok) {
			return jsonRes({ error: "Credenciales incorrectas" }, 401);
		}
		const authEmail = internalOrientadorEmail(String(fila.id));
		const meta = {
			rol: "orientador",
			orientador_id: String(fila.id),
			nombre: typeof fila.nombre === "string" ? fila.nombre : "",
			publicEmail: em,
		};
		const { data: lu } = await admin.auth.admin.listUsers({ perPage: 200, page: 1 });
		const found = lu?.users?.find((u) => u.email === authEmail);
		if (found?.id) {
			const { error: errU } = await admin.auth.admin.updateUserById(found.id, {
				password: pw,
				user_metadata: meta,
			});
			if (errU) {
				console.error("updateUser orientador", errU);
				return jsonRes({ error: "No se pudo actualizar la sesión de aplicación" }, 500);
			}
		} else {
			const { error: errC } = await admin.auth.admin.createUser({
				email: authEmail,
				password: pw,
				email_confirm: true,
				user_metadata: meta,
			});
			if (errC) {
				console.error("createUser orientador", errC);
				return jsonRes({ error: "No se pudo preparar la sesión de aplicación" }, 500);
			}
		}
		return jsonRes({
			ok: true,
			authEmail,
			publicEmail: em,
			nombre: meta.nombre,
		});
	} catch (e) {
		console.error(e);
		return jsonRes({ error: "Error al iniciar sesión" }, 500);
	}
});
