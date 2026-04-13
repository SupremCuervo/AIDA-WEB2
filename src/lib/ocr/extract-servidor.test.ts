import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { tramiteOcrDesdeTipoDocumento } from "./extract-servidor";

const envTest = process.env as Record<string, string | undefined>;

describe("extract-servidor (contrato OCR — base para OCR-01 a OCR-07)", () => {
	const fetchMock = vi.fn();
	const inicial = {
		BASE: process.env.AIDA_OCR_API_BASE_URL,
		DEMO: process.env.AIDA_OCR_USE_RENDER_DEMO,
		NODE: process.env.NODE_ENV,
	};

	beforeEach(() => {
		if (inicial.BASE !== undefined) process.env.AIDA_OCR_API_BASE_URL = inicial.BASE;
		else delete process.env.AIDA_OCR_API_BASE_URL;
		if (inicial.DEMO !== undefined) process.env.AIDA_OCR_USE_RENDER_DEMO = inicial.DEMO;
		else delete process.env.AIDA_OCR_USE_RENDER_DEMO;
		if (inicial.NODE !== undefined) {
			envTest.NODE_ENV = inicial.NODE;
		} else {
			delete envTest.NODE_ENV;
		}
		vi.stubGlobal("fetch", fetchMock);
		fetchMock.mockReset();
	});

	afterEach(() => {
		vi.unstubAllGlobals();
	});

	it("tramiteOcrDesdeTipoDocumento mapea tipos de trámite", () => {
		expect(tramiteOcrDesdeTipoDocumento("curp")).toBe("curp");
		expect(tramiteOcrDesdeTipoDocumento("ine_tutor")).toBe("ine");
		expect(tramiteOcrDesdeTipoDocumento("comprobante_domicilio")).toBe("comprobante");
	});

	it("sin URL configurada ni demo: ocr_no_configurado", async () => {
		delete process.env.AIDA_OCR_API_BASE_URL;
		delete process.env.AIDA_OCR_USE_RENDER_DEMO;
		envTest.NODE_ENV = "production";
		const { extraerCamposOcrServidor: extraer } = await import("./extract-servidor");
		const buf = Buffer.from("fake-image");
		const r = await extraer(buf, "x.jpg", "image/jpeg", "curp");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error).toBe("ocr_no_configurado");
		}
		expect(fetchMock).not.toHaveBeenCalled();
	});

	it("imagen: extract devuelve campos → ok true", async () => {
		process.env.AIDA_OCR_API_BASE_URL = "https://ocr-unit.test";
		vi.resetModules();
		const { extraerCamposOcrServidor: extraer } = await import("./extract-servidor");
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			const u = String(input);
			expect(u).toContain("/ocr/extract");
			return new Response(
				JSON.stringify({
					success: true,
					fields: {
						curp: { value: "CURP123", confidence: 0.95 },
					},
				}),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			);
		});
		const r = await extraer(Buffer.from("bytes"), "doc.jpg", "image/jpeg", "curp");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.fields.curp?.value).toBe("CURP123");
			expect(r.fields.curp?.confidence).toBe(0.95);
		}
		expect(fetchMock).toHaveBeenCalledTimes(1);
	});

	it("extract success false → ok false (sin rollback de subida en API real)", async () => {
		process.env.AIDA_OCR_API_BASE_URL = "https://ocr-unit.test";
		vi.resetModules();
		const { extraerCamposOcrServidor: extraer } = await import("./extract-servidor");
		fetchMock.mockResolvedValue(
			new Response(JSON.stringify({ success: false, fields: {} }), {
				status: 200,
				headers: { "Content-Type": "application/json" },
			}),
		);
		const r = await extraer(Buffer.from("x"), "a.jpg", "image/jpeg", "curp");
		expect(r.ok).toBe(false);
		if (!r.ok) {
			expect(r.error.length).toBeGreaterThan(0);
		}
	});

	it("PDF: prepare + extract", async () => {
		process.env.AIDA_OCR_API_BASE_URL = "https://ocr-unit.test";
		vi.resetModules();
		const { extraerCamposOcrServidor: extraer } = await import("./extract-servidor");
		let calls = 0;
		fetchMock.mockImplementation(async (input: RequestInfo | URL) => {
			calls += 1;
			const u = String(input);
			if (u.includes("/ocr/prepare")) {
				return new Response(Buffer.from([0xff, 0xd8, 0xff]), { status: 200 });
			}
			if (u.includes("/ocr/extract")) {
				return new Response(
					JSON.stringify({ success: true, fields: { nombre: { value: "Ana" } } }),
					{ status: 200, headers: { "Content-Type": "application/json" } },
				);
			}
			return new Response("no", { status: 404 });
		});
		const r = await extraer(Buffer.from("%PDF-1.4"), "doc.pdf", "application/pdf", "acta_nacimiento");
		expect(r.ok).toBe(true);
		if (r.ok) {
			expect(r.fields.nombre?.value).toBe("Ana");
		}
		expect(calls).toBe(2);
	});
});
