import { describe, expect, it } from "vitest";
import {
	crearTipoAdjuntoOrientador,
	esTipoAdjuntoOrientador,
	esTipoDocumentoValido,
	nombreArchivoDescargaAlumno,
	nombreArchivoEstandar,
	slugificar,
	TIPOS_DOCUMENTO,
} from "@/lib/nombre-archivo";

describe("nombre-archivo (subida / tipos — base para CAM-01 a CAM-04)", () => {
	it("acepta los cinco tipos de trámite", () => {
		for (const k of Object.keys(TIPOS_DOCUMENTO)) {
			expect(esTipoDocumentoValido(k)).toBe(true);
		}
	});

	it("rechaza tipo inválido", () => {
		expect(esTipoDocumentoValido("otro")).toBe(false);
		expect(esTipoDocumentoValido("")).toBe(false);
	});

	it("nombreArchivoEstandar permite pdf, png, jpg, jpeg, webp", () => {
		for (const ext of ["pdf", "png", "jpg", "jpeg", "webp"]) {
			const r = nombreArchivoEstandar("José Pérez", "curp", ext);
			expect(r.nombreCompleto).toMatch(/_curp\./);
			expect(r.extension).toBe(ext);
		}
	});

	it("rechaza extensión no permitida (p. ej. exe, zip)", () => {
		expect(() => nombreArchivoEstandar("Ana", "curp", "exe")).toThrow(/Extensión no permitida/);
		expect(() => nombreArchivoDescargaAlumno("Ana", "curp", "zip")).toThrow(/Extensión no permitida/);
	});

	it("slugificar normaliza acentos y espacios", () => {
		expect(slugificar("  María José  ")).toBe("maria_jose");
	});

	it("crearTipoAdjuntoOrientador y esTipoAdjuntoOrientador", () => {
		const t = crearTipoAdjuntoOrientador();
		expect(esTipoAdjuntoOrientador(t)).toBe(true);
		expect(esTipoAdjuntoOrientador("orientador_adjunto_")).toBe(false);
	});
});
