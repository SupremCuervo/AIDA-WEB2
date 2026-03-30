import { createClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import * as jose from "https://deno.land/x/jose@v4.15.5/index.ts";
import { corsHeaders, jsonRes } from "../_shared/cors.ts";

function ymdHoyEnZona(zona: string): string {
	return new Intl.DateTimeFormat("en-CA", {
		timeZone: zona,
		year: "numeric",
		month: "2-digit",
		day: "2-digit",
	}).format(new Date());
}

function esGrupoAccesoCerradoPorFecha(fechaLimiteEntrega: string | null | undefined): boolean {
	if (fechaLimiteEntrega == null || String(fechaLimiteEntrega).trim() === "") {
		return false;
	}
	const limite = String(fechaLimiteEntrega).trim().slice(0, 10);
	if (!/^\d{4}-\d{2}-\d{2}$/.test(limite)) {
		return false;
	}
	const zona = (Deno.env.get("AIDA_FECHA_LIMITE_ZONA") ?? "America/Mexico_City").trim();
	const hoy = ymdHoyEnZona(zona);
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
					"AIDA_JWT_SECRET no configurado en Edge Functions → Secrets (mismo valor que Legacy JWT Secret; el panel no permite prefijo SUPABASE_)",
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
		const { clave } = (await req.json()) as { clave?: string };
		const c = typeof clave === "string" ? clave.trim() : "";
		if (!c) {
			return jsonRes({ error: "La clave es obligatoria" }, 400);
		}
		const admin = createClient(url, service, {
			auth: { persistSession: false, autoRefreshToken: false },
		});
		const { data, error } = await admin
			.from("grupo_tokens")
			.select("id, grupo, grado, fecha_limite_entrega")
			.ilike("clave_acceso", c)
			.maybeSingle();
		if (error) {
			console.error(error);
			return jsonRes({ error: "Error al validar la clave" }, 500);
		}
		if (!data) {
			return jsonRes({ code: "CLAVE_INVALIDA", error: "Clave no válida o inexistente" }, 401);
		}
		if (esGrupoAccesoCerradoPorFecha(data.fecha_limite_entrega)) {
			return jsonRes(
				{
					code: "GRUPO_VENCIDO",
					error:
						"Esta clave ya no permite acceso: finalizó la fecha límite configurada para el grupo.",
				},
				403,
			);
		}
		if (Number.parseInt(String(data.grado ?? "").trim(), 10) !== 1) {
			return jsonRes(
				{
					code: "CLAVE_NO_PRIMERO",
					error:
						"El acceso con clave solo aplica a 1.° grado. Desde 2.° el alumno no usa token de grupo.",
				},
				403,
			);
		}
		const secret = new TextEncoder().encode(secretRaw);
		const ticket = await new jose.SignJWT({
			modo: "grupo",
			grupoTokenId: data.id,
			grupo: data.grupo,
			grado: data.grado,
			claveAcceso: c,
		})
			.setProtectedHeader({ alg: "HS256" })
			.setIssuedAt()
			.setExpirationTime("30m")
			.sign(secret);
		return jsonRes({
			ok: true,
			modo: "grupo",
			grupo: data.grupo,
			grado: data.grado,
			ticket,
		});
	} catch (e) {
		console.error(e);
		return jsonRes({ code: "CONFIG_ERROR", error: "Error del servidor" }, 500);
	}
});
