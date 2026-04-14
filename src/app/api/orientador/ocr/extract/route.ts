import { NextResponse } from "next/server";
import { resolverBaseUrlOcrServidor, timeoutMsOcrServidor } from "@/lib/ocr/config-servidor";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";
/** Debe ser ≥ timeoutMsOcrServidor() o el proxy cortará antes que el fetch al OCR. */
export const maxDuration = 300;

export async function POST(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const base = resolverBaseUrlOcrServidor();
	if (!base) {
		return NextResponse.json(
			{
				error:
					"OCR no configurado: define AIDA_OCR_API_BASE_URL o AIDA_OCR_USE_RENDER_DEMO=1 (instancia demo).",
			},
			{ status: 503 },
		);
	}

	let incoming: FormData;
	try {
		incoming = await request.formData();
	} catch {
		return NextResponse.json({ error: "Formulario inválido" }, { status: 400 });
	}

	const outbound = new FormData();
	for (const [k, v] of incoming.entries()) {
		outbound.append(k, v);
	}

	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), timeoutMsOcrServidor());
	try {
		const res = await fetch(`${base}/ocr/extract`, {
			method: "POST",
			body: outbound,
			signal: controller.signal,
		});
		const text = await res.text();
		const ct = res.headers.get("Content-Type") ?? "application/json; charset=utf-8";
		return new NextResponse(text, { status: res.status, headers: { "Content-Type": ct } });
	} catch (e) {
		const abortado = e instanceof Error && e.name === "AbortError";
		console.error("ocr extract proxy", e);
		return NextResponse.json(
			{ error: abortado ? "Tiempo de espera del OCR agotado" : "Error al contactar el servicio OCR" },
			{ status: abortado ? 504 : 502 },
		);
	} finally {
		clearTimeout(t);
	}
}
