import { cookies } from "next/headers";
import {
	COOKIE_ORIENTADOR,
	verificarTokenOrientador,
	type PayloadOrientador,
} from "@/lib/alumno/jwt-cookies";

export async function obtenerPayloadOrientador(): Promise<PayloadOrientador | null> {
	const jar = await cookies();
	const token = jar.get(COOKIE_ORIENTADOR)?.value;
	if (!token) {
		return null;
	}
	try {
		return await verificarTokenOrientador(token);
	} catch {
		return null;
	}
}
