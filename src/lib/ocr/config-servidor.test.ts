import { beforeEach, describe, expect, it, vi } from "vitest";

function setOrDelete(key: string, val: string | undefined) {
	if (val === undefined) {
		delete process.env[key];
	} else {
		process.env[key] = val;
	}
}

describe("config-servidor OCR (base para OCR sin servicio)", () => {
	const inicial = {
		TIMEOUT: process.env.AIDA_OCR_TIMEOUT_MS,
		BASE: process.env.AIDA_OCR_API_BASE_URL,
		DEMO: process.env.AIDA_OCR_USE_RENDER_DEMO,
		NODE: process.env.NODE_ENV,
	};

	beforeEach(() => {
		setOrDelete("AIDA_OCR_TIMEOUT_MS", inicial.TIMEOUT);
		setOrDelete("AIDA_OCR_API_BASE_URL", inicial.BASE);
		setOrDelete("AIDA_OCR_USE_RENDER_DEMO", inicial.DEMO);
		setOrDelete("NODE_ENV", inicial.NODE);
		vi.resetModules();
	});

	it("timeoutMsOcrServidor usa 90000 si variable inválida", async () => {
		process.env.AIDA_OCR_TIMEOUT_MS = "no_es_numero";
		vi.resetModules();
		const { timeoutMsOcrServidor } = await import("./config-servidor");
		expect(timeoutMsOcrServidor()).toBe(90_000);
	});

	it("timeoutMsOcrServidor respeta milisegundos válidos (> 5000)", async () => {
		process.env.AIDA_OCR_TIMEOUT_MS = "120000";
		vi.resetModules();
		const { timeoutMsOcrServidor } = await import("./config-servidor");
		expect(timeoutMsOcrServidor()).toBe(120_000);
	});

	it("resolverBaseUrlOcrServidor prioriza AIDA_OCR_API_BASE_URL", async () => {
		process.env.AIDA_OCR_API_BASE_URL = "https://mi-ocr.example/path/";
		vi.resetModules();
		const { resolverBaseUrlOcrServidor } = await import("./config-servidor");
		expect(resolverBaseUrlOcrServidor()).toBe("https://mi-ocr.example/path");
	});

	it("sin URL ni demo: resolver devuelve null (producción sin OCR)", async () => {
		delete process.env.AIDA_OCR_API_BASE_URL;
		delete process.env.AIDA_OCR_USE_RENDER_DEMO;
		process.env.NODE_ENV = "production";
		vi.resetModules();
		const { resolverBaseUrlOcrServidor } = await import("./config-servidor");
		expect(resolverBaseUrlOcrServidor()).toBeNull();
	});
});
