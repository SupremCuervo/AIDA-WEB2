import { NextResponse } from "next/server";
import {
	construirValoresDesdePadron,
	normalizarDefinicionRelleno,
} from "@/lib/orientador/plantilla-definicion-relleno";
import { gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";
import { obtenerBucketPlantillas } from "@/lib/orientador/plantillas-bucket";
import { rellenarPdfConValores } from "@/lib/orientador/plantillas-rellenar-datos";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { mensajeCausaParaUsuario } from "@/lib/mensaje-red-amigable";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

export async function GET(
	request: Request,
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

	const url = new URL(request.url);
	const padronId = url.searchParams.get("padronId")?.trim() ?? "";
	if (!padronId) {
		return NextResponse.json({ error: "Parámetro padronId obligatorio" }, { status: 400 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data: fila, error: errF } = await supabase
			.from("orientador_plantillas")
			.select("id, nombre_archivo, ruta_storage, definicion_relleno")
			.eq("id", plantillaId)
			.maybeSingle();

		if (errF || !fila?.ruta_storage) {
			return NextResponse.json({ error: "Plantilla no encontrada" }, { status: 404 });
		}

		const def = normalizarDefinicionRelleno(fila.definicion_relleno);
		if (!def || def.campos.length === 0) {
			return NextResponse.json(
				{ error: "La plantilla no tiene campos de relleno guardados. Configúralos en el editor." },
				{ status: 400 },
			);
		}

		const { data: p, error: errP } = await supabase
			.from("padron_alumnos")
			.select(
				`
				id,
				nombre_completo,
				grado_alumno,
				matricula,
				carrera_id,
				grupo_tokens ( grado, grupo, clave_acceso )
			`,
			)
			.eq("id", padronId)
			.maybeSingle();

		if (errP || !p) {
			return NextResponse.json({ error: "Alumno no encontrado en padrón" }, { status: 404 });
		}

		const gt = p.grupo_tokens as unknown as { grado: string; grupo: string; clave_acceso: string } | null;
		const gradoTok = String(gt?.grado ?? "1").trim();
		const grupoLetra = String(gt?.grupo ?? "").trim();
		const claveGrupo = String(gt?.clave_acceso ?? "").trim();
		const gradoMostrado = gradoMostradoParaAlumno(
			p.grado_alumno != null ? String(p.grado_alumno) : null,
			gradoTok,
		);

		let carreraNombre = "";
		if (p.carrera_id) {
			const { data: car } = await supabase
				.from("carreras")
				.select("nombre")
				.eq("id", p.carrera_id)
				.maybeSingle();
			if (car?.nombre) {
				carreraNombre = String(car.nombre);
			}
		}

		const matricula =
			p.matricula != null && String(p.matricula).trim() !== "" ? String(p.matricula).trim() : "";

		const valores = construirValoresDesdePadron({
			nombreCompleto: String(p.nombre_completo ?? ""),
			gradoTexto: gradoMostrado,
			grupoLetra,
			claveGrupo,
			matricula,
			carreraNombre,
		});

		const bucket = obtenerBucketPlantillas();
		const { data: blob, error: errD } = await supabase.storage.from(bucket).download(fila.ruta_storage);
		if (errD || !blob) {
			console.error("rellenar download base", errD);
			return NextResponse.json({ error: "No se pudo leer el PDF base" }, { status: 500 });
		}

		const bytesIn = await blob.arrayBuffer();
		const out = await rellenarPdfConValores(bytesIn, def.campos, valores);
		const nombreBase = (fila.nombre_archivo || "plantilla").replace(/\.pdf$/i, "");
		const nombreSalida = `${nombreBase}_relleno.pdf`;
		const encoded = encodeURIComponent(nombreSalida);

		return new NextResponse(out, {
			status: 200,
			headers: {
				"Content-Type": "application/pdf",
				"Content-Disposition": `attachment; filename*=UTF-8''${encoded}`,
				"Cache-Control": "private, no-store",
			},
		});
	} catch (e) {
		console.error("plantilla rellenar", e);
		return NextResponse.json({ error: mensajeCausaParaUsuario(e) }, { status: 500 });
	}
}
