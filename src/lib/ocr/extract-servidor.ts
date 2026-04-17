import { mensajeCausaParaUsuario } from "@/lib/mensaje-red-amigable";
import type { TipoDocumentoClave } from "@/lib/nombre-archivo";
import type { CampoOcrCelda } from "@/lib/ocr/campos-ocr-vista";
import { resolverBaseUrlOcrServidor, timeoutMsOcrServidor } from "@/lib/ocr/config-servidor";

const MAPA_TIPO_TRAMITE: Record<TipoDocumentoClave, string> = {
	acta_nacimiento: "acta_nacimiento",
	curp: "curp",
	ine_tutor: "ine",
	comprobante_domicilio: "comprobante",
	certificado_medico: "certificado_medico",
};

export function tramiteOcrDesdeTipoDocumento(tipo: TipoDocumentoClave): string {
	return MAPA_TIPO_TRAMITE[tipo];
}

function normalizarCampos(
	raw: Record<string, unknown>,
): Record<string, CampoOcrCelda> {
	const out: Record<string, CampoOcrCelda> = {};
	for (const [k, v] of Object.entries(raw)) {
		if (v != null && typeof v === "object" && !Array.isArray(v)) {
			const o = v as Record<string, unknown>;
			const val = o.value;
			const conf = o.confidence;
			let valueStr: string | undefined;
			if (typeof val === "string") {
				valueStr = val;
			} else if (val == null) {
				valueStr = "";
			} else if (typeof val === "number" && Number.isFinite(val)) {
				valueStr = String(val);
			} else if (typeof val === "boolean") {
				valueStr = val ? "true" : "false";
			}
			out[k] = {
				value: valueStr,
				confidence: typeof conf === "number" && Number.isFinite(conf) ? conf : undefined,
			};
		}
	}
	return out;
}

function mensajeErrorJsonOcr(data: Record<string, unknown>, status: number): string {
	const detail = data.detail;
	if (typeof detail === "string" && detail.trim()) {
		return detail.trim().slice(0, 800);
	}
	if (Array.isArray(detail)) {
		const t = detail
			.map((x) => (typeof x === "object" && x && "msg" in x ? String((x as { msg?: string }).msg) : String(x)))
			.join("; ");
		if (t.trim()) {
			return t.trim().slice(0, 800);
		}
	}
	const err = data.error;
	if (typeof err === "string" && err.trim()) {
		return err.trim().slice(0, 800);
	}
	return `http_${status}`;
}

async function ocrPreparar(
	base: string,
	bytes: Buffer,
	nombreArchivo: string,
	contentType: string,
): Promise<Buffer> {
	const fd = new FormData();
	fd.append("file", new Blob([bytes], { type: contentType }), nombreArchivo);
	fd.append("binarizar", "false");
	fd.append("aplicar_saturacion_hsv", "true");
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), timeoutMsOcrServidor());
	try {
		const res = await fetch(`${base}/ocr/prepare`, {
			method: "POST",
			body: fd,
			signal: controller.signal,
		});
		if (!res.ok) {
			const text = await res.text().catch(() => "");
			throw new Error(text || `prepare ${res.status}`);
		}
		return Buffer.from(await res.arrayBuffer());
	} finally {
		clearTimeout(t);
	}
}

async function ocrExtract(
	base: string,
	bytes: Buffer,
	nombreArchivo: string,
	contentType: string,
	tramite: string,
): Promise<{ ok: true; fields: Record<string, CampoOcrCelda> } | { ok: false; error: string }> {
	const fd = new FormData();
	fd.append("file", new Blob([bytes], { type: contentType }), nombreArchivo);
	fd.append("tramite", tramite);
	fd.append("lang", "spa");
	fd.append("use_ocr_space_fallback", "true");
	fd.append("aplicar_preproceso_ocr", "false");
	fd.append("aplicar_saturacion_hsv", "true");
	const controller = new AbortController();
	const t = setTimeout(() => controller.abort(), timeoutMsOcrServidor());
	try {
		const res = await fetch(`${base}/ocr/extract`, {
			method: "POST",
			body: fd,
			signal: controller.signal,
		});
		let data: Record<string, unknown>;
		try {
			data = (await res.json()) as Record<string, unknown>;
		} catch {
			return { ok: false, error: "respuesta_ocr_no_json" };
		}
		if (!res.ok) {
			return { ok: false, error: mensajeErrorJsonOcr(data, res.status) };
		}
		const success = data.success === true;
		const fields = data.fields;
		if (!success || fields == null || typeof fields !== "object" || Array.isArray(fields)) {
			return { ok: false, error: mensajeErrorJsonOcr(data, res.status) || "sin_campos" };
		}
		return { ok: true, fields: normalizarCampos(fields as Record<string, unknown>) };
	} catch (e) {
		const abortado = e instanceof Error && e.name === "AbortError";
		return { ok: false, error: abortado ? "timeout_ocr" : "red_ocr" };
	} finally {
		clearTimeout(t);
	}
}

export type ResultadoExtraccionServidor =
	| { ok: true; fields: Record<string, CampoOcrCelda>; tramite: string }
	| { ok: false; error: string; tramite: string };

/**
 * Llama al servicio OCR (mismo contrato que el proxy orientador).
 * PDF: primero /ocr/prepare para obtener imagen; imágenes: extract directo.
 */
export async function extraerCamposOcrServidor(
	bytes: Buffer,
	nombreOriginal: string,
	contentType: string,
	tipoDocumento: TipoDocumentoClave,
): Promise<ResultadoExtraccionServidor> {
	const tramite = tramiteOcrDesdeTipoDocumento(tipoDocumento);
	const base = resolverBaseUrlOcrServidor();
	if (!base) {
		return { ok: false, error: "ocr_no_configurado", tramite };
	}

	const mime = (contentType || "").toLowerCase().trim();
	const nombre = nombreOriginal || "archivo";
	const esPdf = mime === "application/pdf" || nombre.toLowerCase().endsWith(".pdf");

	let buf = bytes;
	let nombreEnvio = nombre;
	let mimeEnvio = mime || "application/octet-stream";

	if (esPdf) {
		try {
			buf = await ocrPreparar(base, bytes, nombre, "application/pdf");
			nombreEnvio = "pagina1.jpg";
			mimeEnvio = "image/jpeg";
		} catch (e) {
			const msg = mensajeCausaParaUsuario(e);
			return { ok: false, error: msg.slice(0, 500), tramite };
		}
	}

	const r = await ocrExtract(base, buf, nombreEnvio, mimeEnvio, tramite);
	if (!r.ok) {
		return { ok: false, error: r.error, tramite };
	}
	return { ok: true, fields: r.fields, tramite };
}
