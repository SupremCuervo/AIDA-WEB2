import { randomUUID } from "crypto";
import { NextResponse } from "next/server";
import { obtenerBucketPlantillas } from "@/lib/orientador/plantillas-bucket";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

const MAX_BYTES = 25 * 1024 * 1024;
const REINTENTOS_STORAGE = 4;

function esErrorRedIntermitente(e: unknown): boolean {
	const msg = e instanceof Error ? e.message : String(e);
	let cause = "";
	if (e instanceof Error && e.cause) {
		cause = e.cause instanceof Error ? e.cause.message : String(e.cause);
	}
	const s = `${msg} ${cause}`.toLowerCase();
	return (
		s.includes("fetch failed") ||
		s.includes("socket") ||
		s.includes("econnreset") ||
		s.includes("other side closed") ||
		s.includes("und_err") ||
		s.includes("etimedout") ||
		s.includes("aborted")
	);
}

function mensajeErrorSubida(e: unknown): string {
	if (esErrorRedIntermitente(e)) {
		return "La conexión con el almacenamiento se cortó (red intermitente o Supabase ocupado). Vuelve a intentar en unos segundos.";
	}
	return e instanceof Error ? e.message : "Error del servidor";
}

type ClienteSupabase = ReturnType<typeof obtenerClienteSupabaseAdmin>;

async function subirPdfStorageConReintentos(
	supabase: ClienteSupabase,
	bucket: string,
	ruta: string,
	buf: Buffer,
): Promise<{ error: { message: string } | null }> {
	let ultimo: unknown;
	for (let intento = 0; intento < REINTENTOS_STORAGE; intento += 1) {
		try {
			const { error } = await supabase.storage.from(bucket).upload(ruta, buf, {
				contentType: "application/pdf",
				upsert: false,
			});
			if (!error) {
				return { error: null };
			}
			return { error };
		} catch (e) {
			ultimo = e;
			if (intento < REINTENTOS_STORAGE - 1 && esErrorRedIntermitente(e)) {
				await new Promise((r) => setTimeout(r, 500 * 2 ** intento));
				continue;
			}
			throw e;
		}
	}
	throw ultimo;
}

export async function GET() {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		const { data, error } = await supabase
			.from("orientador_plantillas")
			.select("id, titulo, nombre_archivo, creado_en")
			.order("creado_en", { ascending: false });

		if (error) {
			console.error("plantillas GET", error);
			return NextResponse.json({ error: "No se pudieron cargar las plantillas" }, { status: 500 });
		}

		return NextResponse.json({ plantillas: data ?? [] });
	} catch (e) {
		console.error("plantillas GET", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}

export async function POST(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	let form: FormData;
	try {
		form = await request.formData();
	} catch {
		return NextResponse.json({ error: "FormData inválido" }, { status: 400 });
	}

	const archivo = form.get("archivo");
	const tituloRaw = form.get("titulo");
	const titulo =
		typeof tituloRaw === "string" ? tituloRaw.trim().slice(0, 200) : "";

	if (!(archivo instanceof File) || archivo.size === 0) {
		return NextResponse.json({ error: "Archivo PDF obligatorio" }, { status: 400 });
	}

	if (archivo.size > MAX_BYTES) {
		return NextResponse.json({ error: "El PDF supera el tamaño máximo permitido" }, { status: 400 });
	}

	const tipo = (archivo.type || "").toLowerCase();
	if (tipo !== "application/pdf" && !archivo.name.toLowerCase().endsWith(".pdf")) {
		return NextResponse.json({ error: "Solo se permiten archivos PDF" }, { status: 400 });
	}

	const id = randomUUID();
	const ruta = `muro_plantillas/${id}.pdf`;
	const nombreArchivo = archivo.name.replace(/\s+/g, "_").slice(0, 180) || "plantilla.pdf";
	const tituloFinal = titulo || nombreArchivo.replace(/\.pdf$/i, "");

	let filaInsertada = false;
	try {
		const bucket = obtenerBucketPlantillas();
		const supabase = obtenerClienteSupabaseAdmin();
		const buf = Buffer.from(await archivo.arrayBuffer());

		const { error: errI } = await supabase.from("orientador_plantillas").insert({
			id,
			titulo: tituloFinal,
			nombre_archivo: nombreArchivo,
			ruta_storage: ruta,
		});

		if (errI) {
			console.error("plantillas insert", errI);
			return NextResponse.json({ error: "No se pudo registrar la plantilla" }, { status: 500 });
		}
		filaInsertada = true;

		const { error: errU } = await subirPdfStorageConReintentos(supabase, bucket, ruta, buf);

		if (errU) {
			await supabase.from("orientador_plantillas").delete().eq("id", id);
			console.error("plantillas storage", errU);
			return NextResponse.json(
				{ error: "No se pudo subir el PDF al almacenamiento" },
				{ status: 500 },
			);
		}

		return NextResponse.json({
			ok: true,
			id,
			titulo: tituloFinal,
			nombreArchivo,
		});
	} catch (e) {
		console.error("plantillas POST", e);
		try {
			if (filaInsertada) {
				const supabase = obtenerClienteSupabaseAdmin();
				await supabase.from("orientador_plantillas").delete().eq("id", id);
			}
		} catch (rollbackErr) {
			console.error("plantillas POST rollback", rollbackErr);
		}
		return NextResponse.json(
			{ error: mensajeErrorSubida(e) },
			{ status: esErrorRedIntermitente(e) ? 503 : 500 },
		);
	}
}
