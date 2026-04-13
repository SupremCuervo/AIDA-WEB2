import { NextResponse } from "next/server";
import { obtenerBucketPlantillas } from "@/lib/orientador/plantillas-bucket";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { mensajeCausaParaUsuario } from "@/lib/mensaje-red-amigable";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

export async function GET(
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
			.select("ruta_storage, nombre_archivo")
			.eq("id", plantillaId)
			.maybeSingle();

		if (errF || !fila?.ruta_storage) {
			return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
		}

		const bucket = obtenerBucketPlantillas();
		const { data: blob, error: errD } = await supabase.storage
			.from(bucket)
			.download(fila.ruta_storage);

		if (errD || !blob) {
			console.error("plantilla pdf download", errD);
			return NextResponse.json({ error: "No se pudo leer el archivo" }, { status: 500 });
		}

		const bytes = await blob.arrayBuffer();
		const nombre = fila.nombre_archivo || "plantilla.pdf";
		const encoded = encodeURIComponent(nombre);

		return new NextResponse(bytes, {
			status: 200,
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `inline; filename*=UTF-8''${encoded}`,
				"Cache-Control": "private, max-age=60",
			},
		});
	} catch (e) {
		console.error("plantilla pdf", e);
		return NextResponse.json({ error: mensajeCausaParaUsuario(e) }, { status: 500 });
	}
}
