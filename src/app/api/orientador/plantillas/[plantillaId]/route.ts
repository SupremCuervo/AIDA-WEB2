import { NextResponse } from "next/server";
import { registrarLogApi } from "@/lib/orientador/audit-registrar";
import { obtenerBucketPlantillas } from "@/lib/orientador/plantillas-bucket";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

export async function DELETE(
	_request: Request,
	ctx: { params: Promise<{ plantillaId: string }> },
) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const { plantillaId } = await ctx.params;
	if (!plantillaId) {
		return NextResponse.json({ error: "ID no válido" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: fila, error: errF } = await supabase
			.from("orientador_plantillas")
			.select("id, titulo, nombre_archivo, ruta_storage")
			.eq("id", plantillaId)
			.maybeSingle();

		if (errF || !fila) {
			return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
		}

		const bucket = obtenerBucketPlantillas();
		await supabase.storage.from(bucket).remove([fila.ruta_storage]);

		const { error: errD } = await supabase.from("orientador_plantillas").delete().eq("id", plantillaId);
		if (errD) {
			console.error("plantilla DELETE", errD);
			return NextResponse.json({ error: "No se pudo eliminar el registro" }, { status: 500 });
		}

		await registrarLogApi({
			orientador,
			accion: `Plantilla eliminada: ${fila.titulo || fila.nombre_archivo || plantillaId}`,
			entidad: "orientador_plantillas",
			entidadId: plantillaId,
			detalle: {
				titulo: fila.titulo,
				nombre_archivo: fila.nombre_archivo,
				ruta_storage: fila.ruta_storage,
			},
		});

		return NextResponse.json({ ok: true });
	} catch (e) {
		console.error("plantilla DELETE", e);
		const msg = e instanceof Error ? e.message : "Error del servidor";
		return NextResponse.json({ error: msg }, { status: 500 });
	}
}
