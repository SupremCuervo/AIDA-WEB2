import { SignJWT, jwtVerify, type JWTPayload } from "jose";

export const COOKIE_CLAVE_OK = "aida_clave_ok";
export const COOKIE_ALUMNO = "aida_alumno";
export const COOKIE_ORIENTADOR = "aida_orientador";

const ALG = "HS256";

function obtenerSecret(): Uint8Array {
	const s = process.env.AIDA_JWT_SECRET;
	if (!s || s.length < 32) {
		throw new Error("AIDA_JWT_SECRET debe existir y tener al menos 32 caracteres.");
	}
	return new TextEncoder().encode(s);
}

export type PayloadClaveOk = {
	modo: "grupo";
	grupoTokenId: string;
	grupo: string;
	grado: string;
	claveAcceso?: string;
};

export async function firmarTokenClaveOk(payload: PayloadClaveOk): Promise<string> {
	const cuerpo: Record<string, unknown> = {
		modo: "grupo",
		grupoTokenId: payload.grupoTokenId,
		grupo: payload.grupo,
		grado: payload.grado,
	};
	if (payload.claveAcceso != null && payload.claveAcceso !== "") {
		cuerpo.claveAcceso = payload.claveAcceso;
	}
	return new SignJWT(cuerpo)
		.setProtectedHeader({ alg: ALG })
		.setIssuedAt()
		.setExpirationTime("30m")
		.sign(obtenerSecret());
}

export async function verificarTokenClaveOk(token: string): Promise<PayloadClaveOk> {
	const { payload } = await jwtVerify(token, obtenerSecret(), { algorithms: [ALG] });
	const p = payload as JWTPayload & Record<string, unknown>;
	const claveAcceso =
		typeof p.claveAcceso === "string" && p.claveAcceso !== "" ? p.claveAcceso : undefined;
	if (p.modo === "carga") {
		throw new Error("Token de clave obsoleto (modo carga); vuelve a validar tu clave de grupo.");
	}
	const grupoTokenId = p.grupoTokenId;
	const grupo = p.grupo;
	const grado = p.grado;
	if (
		typeof grupoTokenId !== "string" ||
		typeof grupo !== "string" ||
		typeof grado !== "string"
	) {
		throw new Error("Token de clave inválido");
	}
	return { modo: "grupo", grupoTokenId, grupo, grado, claveAcceso };
}

export type PayloadAlumno = {
	cuentaId: string;
	padronId: string;
	nombreCompleto: string;
	grupo: string;
	grado: string;
};

export async function firmarTokenAlumno(payload: PayloadAlumno): Promise<string> {
	return new SignJWT({
		cuentaId: payload.cuentaId,
		padronId: payload.padronId,
		nombreCompleto: payload.nombreCompleto,
		grupo: payload.grupo,
		grado: payload.grado,
	})
		.setProtectedHeader({ alg: ALG })
		.setIssuedAt()
		.setExpirationTime("7d")
		.sign(obtenerSecret());
}

export async function verificarTokenAlumno(token: string): Promise<PayloadAlumno> {
	const { payload } = await jwtVerify(token, obtenerSecret(), { algorithms: [ALG] });
	const p = payload as JWTPayload & Record<string, unknown>;
	const cuentaId = p.cuentaId;
	const padronId = p.padronId;
	const nombreCompleto = p.nombreCompleto;
	const grupo = p.grupo;
	const grado = p.grado;
	if (
		typeof cuentaId !== "string" ||
		typeof padronId !== "string" ||
		typeof nombreCompleto !== "string" ||
		typeof grupo !== "string" ||
		typeof grado !== "string"
	) {
		throw new Error("Token de alumno inválido");
	}
	return { cuentaId, padronId, nombreCompleto, grupo, grado };
}

export type RolPanelOrientador = "normal" | "jefe";

export type PayloadOrientador = {
	orientadorId: string;
	email: string;
	nombre: string;
	rolPanel: RolPanelOrientador;
};

export function orientadorEsJefe(p: PayloadOrientador): boolean {
	return p.rolPanel === "jefe";
}

export async function firmarTokenOrientador(payload: PayloadOrientador): Promise<string> {
	return new SignJWT({
		orientadorId: payload.orientadorId,
		email: payload.email,
		nombre: payload.nombre,
		rolPanel: payload.rolPanel,
	})
		.setProtectedHeader({ alg: ALG })
		.setIssuedAt()
		.setExpirationTime("12h")
		.sign(obtenerSecret());
}

export async function verificarTokenOrientador(token: string): Promise<PayloadOrientador> {
	const { payload } = await jwtVerify(token, obtenerSecret(), { algorithms: [ALG] });
	const p = payload as JWTPayload & Record<string, unknown>;
	const orientadorId = p.orientadorId;
	const email = p.email;
	const nombre = p.nombre;
	const rolRaw = p.rolPanel;
	const rolPanel: RolPanelOrientador =
		rolRaw === "normal" || rolRaw === "jefe" ? rolRaw : "jefe";
	if (
		typeof orientadorId !== "string" ||
		typeof email !== "string" ||
		typeof nombre !== "string"
	) {
		throw new Error("Token de orientador inválido");
	}
	return { orientadorId, email, nombre, rolPanel };
}
