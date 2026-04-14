import { SignJWT } from "jose";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import {
	firmarTokenAlumno,
	firmarTokenOrientador,
	verificarTokenAlumno,
	verificarTokenOrientador,
} from "@/lib/alumno/jwt-cookies";

const SECRET_TEST = "a".repeat(32);

describe("jwt-cookies (sesión — base para L-01, L-13)", () => {
	const prev = process.env.AIDA_JWT_SECRET;

	beforeAll(() => {
		process.env.AIDA_JWT_SECRET = SECRET_TEST;
	});

	afterAll(() => {
		process.env.AIDA_JWT_SECRET = prev;
	});

	it("round-trip token alumno", async () => {
		const t = await firmarTokenAlumno({
			cuentaId: "c1",
			padronId: "p1",
			nombreCompleto: "Luis Gómez",
			grupo: "1A",
			grado: "1",
		});
		const p = await verificarTokenAlumno(t);
		expect(p.cuentaId).toBe("c1");
		expect(p.padronId).toBe("p1");
		expect(p.nombreCompleto).toBe("Luis Gómez");
	});

	it("round-trip token orientador", async () => {
		const t = await firmarTokenOrientador({
			orientadorId: "o1",
			email: "o@test.local",
			nombre: "Orientador",
			rolPanel: "jefe",
		});
		const p = await verificarTokenOrientador(t);
		expect(p.orientadorId).toBe("o1");
		expect(p.email).toBe("o@test.local");
	});

	it("token alumno expirado: verificación falla (L-13)", async () => {
		const secretBytes = new TextEncoder().encode(SECRET_TEST);
		const token = await new SignJWT({
			cuentaId: "c1",
			padronId: "p1",
			nombreCompleto: "X",
			grupo: "g",
			grado: "1",
		})
			.setProtectedHeader({ alg: "HS256" })
			.setIssuedAt()
			.setExpirationTime(new Date(Date.now() - 60_000))
			.sign(secretBytes);
		await expect(verificarTokenAlumno(token)).rejects.toThrow();
	});

	it("token mal firmado: verificación falla", async () => {
		const bad = await firmarTokenAlumno({
			cuentaId: "c",
			padronId: "p",
			nombreCompleto: "X",
			grupo: "g",
			grado: "1",
		});
		const altered = bad.slice(0, -4) + "xxxx";
		await expect(verificarTokenAlumno(altered)).rejects.toThrow();
	});
});
