import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as jose from "https://deno.land/x/jose@v4.15.5/index.ts";
import bcrypt from "npm:bcryptjs@2.4.3";
import { corsHeaders, jsonRes } from "../_shared/cors.ts";

function normalizarNombreParaComparar(texto: string): string {
	const sinAcentos = texto.normalize("NFD").replace(/\p{M}/gu, "");
	return sinAcentos.trim().toLowerCase().replace(/\s+/g, " ");
}

function gradoMostradoParaAlumno(gradoAlumno: string | null | undefined, gradoToken: string): string {
	const o =
		gradoAlumno != null && String(gradoAlumno).trim() !== ""
			? String(gradoAlumno).trim()
			: "";
	return o || gradoToken;
}

function internalAlumnoEmail(cuentaId: string): string {
	const clean = cuentaId.replace(/-/g, "").toLowerCase();
	return `a_${clean}@aida-mobile.internal`;
}

type TicketPayload = {
	modo?: string;
	grupoTokenId?: string;
	grupo?: string;
	grado?: string;
	claveAcceso?: string;
};

async function grupoTokenEstaVencido(
	admin: ReturnType<typeof createClient>,
	grupoTokenId: string,
): Promise<boolean> {
	const { data: gt, error } = await admin
		.from("grupo_tokens")
		.select("fecha_limite_entrega")
		.eq("id", grupoTokenId)
		.maybeSingle();
	if (error || !gt) {
		return true;
	}
	const fecha = gt.fecha_limite_entrega;
	if (fecha == null || String(fecha).trim() === "") {
		return false;
	}
	const limite = String(fecha).trim().slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(limite)) {
		return false;
	}
	const zona = (Deno.env.get("AIDA_FECHA_LIMITE_ZONA") ?? "America/Mexico_City").trim();
	const hoy = new Intl.DateTimeFormat("en-CA", {
		timeZone: zona,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
	return hoy > limite;
}

Deno.serve(async (req) => {
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: corsHeaders });
	}
	if (req.method !== "POST") {
		return jsonRes({ error: "Método no permitido" }, 405);
	}
	const secretRaw =
		Deno.env.get("AIDA_JWT_SECRET")?.trim() || Deno.env.get("SUPABASE_JWT_SECRET")?.trim();
	if (!secretRaw) {
		return jsonRes(
			{
				code: "CONFIG_ERROR",
				error:
					"AIDA_JWT_SECRET no configurado en Edge Functions → Secrets (Legacy JWT Secret; el panel no permite prefijo SUPABASE_)",
			},
			500,
		);
	}
	try {
		const url = Deno.env.get("SUPABASE_URL") ?? "";
		const service = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
		if (!url || !service) {
			return jsonRes({ code: "CONFIG_ERROR", error: "Supabase no configurado" }, 500);
		}
		const { ticket, nombreCompleto, password } = (await req.json()) as {
			ticket?: string;
			nombreCompleto?: string;
			password?: string;
		};
		const t = typeof ticket === "string" ? ticket.trim() : "";
		const nom = typeof nombreCompleto === "string" ? nombreCompleto.trim() : "";
		const pw = typeof password === "string" ? password : "";
		if (!t || !nom || !pw) {
			return jsonRes({ error: "Ticket, nombre completo y contraseña son obligatorios" }, 400);
		}
		let payload: TicketPayload;
		try {
			const { payload: p } = await jose.jwtVerify(
				t,
				new TextEncoder().encode(secretRaw),
				{ algorithms: ["HS256"] },
			);
			payload = p as unknown as TicketPayload;
		} catch {
			return jsonRes(
				{ code: "CLAVE_EXPIRADA", error: "La validación de clave expiró. Vuelve a ingresarla." },
				401,
			);
		}
		if (payload.modo !== "grupo" || !payload.grupoTokenId || !payload.grupo || !payload.grado) {
			return jsonRes({ error: "Ticket inválido" }, 401);
		}
		const admin = createClient(url, service, {
			auth: { persistSession: false, autoRefreshToken: false },
		});
		if (await grupoTokenEstaVencido(admin, String(payload.grupoTokenId))) {
			return jsonRes(
				{
					code: "GRUPO_VENCIDO",
					error:
						"El acceso con esta clave ya no está disponible: finalizó la fecha límite del grupo.",
				},
				403,
			);
		}
		const { data: filaGrupoToken, error: errGrupoTok } = await admin
			.from("grupo_tokens")
			.select("grado")
			.eq("id", payload.grupoTokenId)
			.maybeSingle();
		if (errGrupoTok || !filaGrupoToken) {
			return jsonRes({ code: "GRUPO_NO_ENCONTRADO", error: "No se encontró el grupo de la clave." }, 403);
		}
		if (Number.parseInt(String(filaGrupoToken.grado ?? "").trim(), 10) !== 1) {
			return jsonRes(
				{
					code: "ACCESO_SOLO_PRIMERO",
					error: "El acceso por clave solo aplica a 1.° grado. Contacta al orientador.",
				},
				403,
			);
		}
		const { data: filasPadron, error: errPadron } = await admin
			.from("padron_alumnos")
			.select("id, nombre_completo, grado_alumno, archivo_muerto_en")
			.eq("grupo_token_id", payload.grupoTokenId);
		if (errPadron) {
			console.error(errPadron);
			return jsonRes({ error: "Error al consultar el padrón" }, 500);
		}
		const claveNombre = normalizarNombreParaComparar(nom);
		const filaPadron = filasPadron?.find(
			(f) => normalizarNombreParaComparar(String(f.nombre_completo)) === claveNombre,
		);
		if (!filaPadron) {
			return jsonRes(
				{
					code: "NOT_IN_PADRON",
					error: "Tu nombre no coincide que estes en un grupo.",
				},
				403,
			);
		}
		if (filaPadron.archivo_muerto_en != null) {
			return jsonRes(
				{
					code: "ARCHIVO_MUERTO",
					error:
						"Tu expediente está en archivo muerto (inactivo). Contacta al orientador si necesitas acceso.",
				},
				403,
			);
		}
		const gradoSesion = gradoMostradoParaAlumno(
			filaPadron.grado_alumno as string | null,
			String(payload.grado),
		);
		const grupoLetra = String(payload.grupo);
		const { data: cuenta, error: errCuenta } = await admin
			.from("cuentas_alumno")
			.select("id, password_hash")
			.eq("padron_id", filaPadron.id)
			.maybeSingle();
		if (errCuenta) {
			console.error(errCuenta);
			return jsonRes({ error: "Error al consultar la cuenta" }, 500);
		}
		let cuentaIdFinal: string;
		if (cuenta?.id && cuenta.password_hash) {
			const pwdOk = bcrypt.compareSync(pw, String(cuenta.password_hash));
			if (!pwdOk) {
				return jsonRes({ code: "PASSWORD_INVALID", error: "Contraseña incorrecta" }, 401);
			}
			cuentaIdFinal = String(cuenta.id);
		} else {
			const hash = bcrypt.hashSync(pw, 10);
			const { data: nueva, error: errInsert } = await admin
				.from("cuentas_alumno")
				.insert({ padron_id: filaPadron.id, password_hash: hash })
				.select("id")
				.single();
			if (errInsert || !nueva?.id) {
				console.error(errInsert);
				return jsonRes({ error: "No se pudo crear la cuenta" }, 500);
			}
			cuentaIdFinal = String(nueva.id);
		}
		const authEmail = internalAlumnoEmail(cuentaIdFinal);
		const meta = {
			rol: "alumno",
			cuenta_id: cuentaIdFinal,
			padron_id: String(filaPadron.id),
			nombre_completo: String(filaPadron.nombre_completo),
			grupo: grupoLetra,
			grado: gradoSesion,
		};
		const { data: lu } = await admin.auth.admin.listUsers({ perPage: 200, page: 1 });
		const found = lu?.users?.find((u) => u.email === authEmail);
		if (found?.id) {
			const { error: errU } = await admin.auth.admin.updateUserById(found.id, {
				password: pw,
				user_metadata: meta,
			});
			if (errU) {
				console.error(errU);
				return jsonRes({ error: "No se pudo actualizar la sesión" }, 500);
			}
		} else {
			const { error: errC } = await admin.auth.admin.createUser({
				email: authEmail,
				password: pw,
				email_confirm: true,
				user_metadata: meta,
			});
			if (errC) {
				console.error(errC);
				return jsonRes({ error: "No se pudo crear la sesión de aplicación" }, 500);
			}
		}
		return jsonRes({
			ok: true,
			authEmail,
			nombreCompleto: filaPadron.nombre_completo,
			grupo: grupoLetra,
			grado: gradoSesion,
			creada: !cuenta?.id,
		});
	} catch (e) {
		console.error(e);
		return jsonRes({ code: "CONFIG_ERROR", error: "Error del servidor" }, 500);
	}
});
