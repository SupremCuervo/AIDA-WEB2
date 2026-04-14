import { NextResponse } from "next/server";
import { deduplicarFilasCarga, normalizarLetraGrupo } from "@/lib/orientador/cargas-helpers";
import { leerFilasXlsx } from "@/lib/orientador/xlsx-lectura";
import { mensajeCausaParaUsuario } from "@/lib/mensaje-red-amigable";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function indiceColumna(fila: string[], candidatos: string[]): number {
	const lower = fila.map((c) => c.trim().toLowerCase());
	for (let i = 0; i < lower.length; i++) {
		for (const cand of candidatos) {
			if (lower[i] === cand || lower[i].includes(cand)) {
				return i;
			}
		}
	}
	return -1;
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
	if (!archivo || !(archivo instanceof File)) {
		return NextResponse.json({ error: "Falta el archivo (campo archivo)" }, { status: 400 });
	}

	try {
		const filas = await leerFilasXlsx(archivo);
		if (filas.length === 0) {
			return NextResponse.json({ filas: [] as { nombreCompleto: string; grupoLetra: string }[] });
		}

		const primera = filas[0] ?? [];
		const iNombre = indiceColumna(primera, ["nombre", "alumno", "nombre completo"]);
		const iGrupo = indiceColumna(primera, ["grupo", "grupo_letra", "letra", "sección", "seccion"]);

		let dataRows = filas;
		let colNombre = 0;
		let colGrupo = 1;
		if (iNombre >= 0 && iGrupo >= 0) {
			dataRows = filas.slice(1);
			colNombre = iNombre;
			colGrupo = iGrupo;
		}

		const parseadas: { grupoLetra: string; nombreCompleto: string }[] = [];
		for (const r of dataRows) {
			const nombre = String(r[colNombre] ?? "").trim();
			const grupo = normalizarLetraGrupo(String(r[colGrupo] ?? ""));
			if (!nombre || !grupo) {
				continue;
			}
			parseadas.push({ nombreCompleto: nombre, grupoLetra: grupo });
		}

		return NextResponse.json({ filas: deduplicarFilasCarga(parseadas) });
	} catch (e) {
		console.error("cargas filas-xlsx", e);
		const msg = mensajeCausaParaUsuario(e);
		return NextResponse.json(
			{ error: msg === "Ocurrió un error inesperado." ? "No se pudo leer el Excel" : msg },
			{ status: 400 },
		);
	}
}
