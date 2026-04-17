import type { PayloadOrientador } from "@/lib/alumno/jwt-cookies";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";

/** Preferir correo en auditoría para poder filtrar y reconocer al orientador en el historial. */
export function etiquetaAuditoriaOrientador(o: PayloadOrientador): string {
	const e = o.email.trim();
	if (e !== "") {
		return e;
	}
	const n = o.nombre.trim();
	return n !== "" ? n : o.orientadorId;
}

/** Inserta en public.logs vía RPC (service_role). No lanza: errores solo a consola. */
export async function registrarLogApi(params: {
	orientador: PayloadOrientador | null;
	accion: string;
	entidad: string;
	entidadId?: string | null;
	detalle?: Record<string, unknown> | null;
}): Promise<void> {
	if (!params.orientador) {
		// Esta capa registra solo acciones de orientador autenticado.
		return;
	}
	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const o = params.orientador;
		const { error } = await supabase.rpc("registrar_log", {
			p_actor_tipo: "orientador",
			p_actor_id: o.orientadorId,
			p_actor_etiqueta: etiquetaAuditoriaOrientador(o),
			p_accion: params.accion,
			p_entidad: params.entidad,
			p_entidad_id: params.entidadId ?? null,
			p_detalle: params.detalle ?? null,
			p_origen: "api",
		});
		if (error) {
			console.error("registrarLogApi", error);
		}
	} catch (e) {
		console.error("registrarLogApi", e);
	}
}

export function argsRpcActorOrientador(orientador: PayloadOrientador | null): {
	p_actor_tipo: string;
	p_actor_id: string | null;
	p_actor_etiqueta: string;
} {
	if (!orientador) {
		return {
			p_actor_tipo: "orientador",
			p_actor_id: null,
			p_actor_etiqueta: "",
		};
	}
	return {
		p_actor_tipo: "orientador",
		p_actor_id: orientador.orientadorId,
		p_actor_etiqueta: etiquetaAuditoriaOrientador(orientador),
	};
}
