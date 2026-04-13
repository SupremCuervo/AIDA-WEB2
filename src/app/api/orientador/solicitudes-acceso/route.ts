import { NextResponse } from "next/server";
import { orientadorEsJefe } from "@/lib/alumno/jwt-cookies";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

export const runtime = "nodejs";

type SolicitudEstado = "pendiente" | "aceptada" | "rechazada";

export async function GET() {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	if (!orientadorEsJefe(orientador)) {
		return NextResponse.json({ error: "No autorizado" }, { status: 403 });
	}
	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data, error } = await supabase
			.from("orientador_solicitudes_acceso")
			.select("id, email, estado, creado_en")
			.eq("estado", "pendiente")
			.order("creado_en", { ascending: true });
		if (error) {
			console.error("solicitudes acceso GET", error);
			return NextResponse.json({ error: "No se pudieron cargar las solicitudes" }, { status: 500 });
		}
		return NextResponse.json({ solicitudes: data ?? [] });
	} catch (e) {
		console.error("solicitudes acceso GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function PATCH(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	if (!orientadorEsJefe(orientador)) {
		return NextResponse.json({ error: "No autorizado" }, { status: 403 });
	}
	let body: { solicitudId?: string; accion?: "aceptar" | "rechazar" };
	try {
		body = (await request.json()) as { solicitudId?: string; accion?: "aceptar" | "rechazar" };
	} catch {
		return NextResponse.json({ error: "JSON inválido" }, { status: 400 });
	}
	const solicitudId = typeof body.solicitudId === "string" ? body.solicitudId.trim() : "";
	const accion = body.accion;
	if (!solicitudId || (accion !== "aceptar" && accion !== "rechazar")) {
		return NextResponse.json({ error: "Solicitud inválida" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: sol, error: errSol } = await supabase
			.from("orientador_solicitudes_acceso")
			.select("id, email, password_hash, estado")
			.eq("id", solicitudId)
			.maybeSingle();
		if (errSol) {
			console.error("solicitudes acceso PATCH leer", errSol);
			return NextResponse.json({ error: "No se pudo leer la solicitud" }, { status: 500 });
		}
		if (!sol?.id) {
			return NextResponse.json({ error: "Solicitud no encontrada" }, { status: 404 });
		}
		if (String(sol.estado) !== "pendiente") {
			return NextResponse.json({ error: "La solicitud ya fue atendida" }, { status: 409 });
		}

		const estadoFinal: SolicitudEstado = accion === "aceptar" ? "aceptada" : "rechazada";
		if (accion === "aceptar") {
			const email = String(sol.email ?? "").trim().toLowerCase();
			const hash = String(sol.password_hash ?? "").trim();
			if (!email || !hash) {
				return NextResponse.json({ error: "La solicitud no tiene datos válidos" }, { status: 400 });
			}
			const { data: oriExistente, error: errOri } = await supabase
				.from("orientadores")
				.select("id")
				.eq("email", email)
				.maybeSingle();
			if (errOri) {
				console.error("solicitudes acceso PATCH orientador", errOri);
				return NextResponse.json({ error: "No se pudo validar el orientador" }, { status: 500 });
			}
			if (oriExistente?.id) {
				const { error: errUp } = await supabase
					.from("orientadores")
					.update({ password_hash: hash, estado_acceso: "activo" })
					.eq("id", oriExistente.id);
				if (errUp) {
					console.error("solicitudes acceso PATCH update orientador", errUp);
					return NextResponse.json({ error: "No se pudo activar la cuenta orientador" }, { status: 500 });
				}
			} else {
				const nombreDesdeEmail = email.split("@")[0]?.replace(/\./g, " ") ?? "Orientador";
				const { error: errIns } = await supabase.from("orientadores").insert({
					email,
					password_hash: hash,
					nombre: nombreDesdeEmail,
					estado_acceso: "activo",
				});
				if (errIns) {
					console.error("solicitudes acceso PATCH insert orientador", errIns);
					return NextResponse.json({ error: "No se pudo crear la cuenta orientador" }, { status: 500 });
				}
			}
		}

		const { error: errFinal } = await supabase
			.from("orientador_solicitudes_acceso")
			.update({
				estado: estadoFinal,
				revisado_en: new Date().toISOString(),
				revisado_por_orientador_id: orientador.orientadorId,
			})
			.eq("id", solicitudId);
		if (errFinal) {
			console.error("solicitudes acceso PATCH update solicitud", errFinal);
			return NextResponse.json({ error: "No se pudo actualizar la solicitud" }, { status: 500 });
		}

		return NextResponse.json({ ok: true, estado: estadoFinal });
	} catch (e) {
		console.error("solicitudes acceso PATCH", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
