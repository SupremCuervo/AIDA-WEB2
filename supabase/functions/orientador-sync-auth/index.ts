import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import bcrypt from "npm:bcryptjs@2.4.3";
import { corsHeaders, jsonRes } from "../_shared/cors.ts";

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
		const admin = createClient(url, service, {
			auth: { persistSession: false, autoRefreshToken: false },
		});
		const { data: fila, error: errQ } = await admin
			.from("orientadores")
			.select("id, email, password_hash, nombre")
			.eq("email", em)
			.maybeSingle();
		if (errQ || !fila?.password_hash) {
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
