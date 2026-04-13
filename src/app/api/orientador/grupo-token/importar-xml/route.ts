import { NextResponse } from "next/server";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import { leerFilasXlsx } from "@/lib/orientador/xlsx-lectura";

export const runtime = "nodejs";

function descomponerGrupo(valor: string): { grado: string; grupo: string } | null {
	const limpio = valor.trim().replace(/\s+/g, "");
	const soloLetra = /^[a-zA-Z]$/u.exec(limpio);
	if (soloLetra) {
		return { grado: "1", grupo: soloLetra[0].toUpperCase() };
	}
	return null;
}

function normalizarEncabezado(texto: string): string {
	return texto
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "")
		.trim();
}

export async function POST(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}
	try {
		const form = await request.formData();
		const archivo = form.get("archivo");
		if (!(archivo instanceof File)) {
			return NextResponse.json({ error: "Debes adjuntar un XLSX" }, { status: 400 });
		}
		if (!archivo.name.toLowerCase().endsWith(".xlsx")) {
			return NextResponse.json({ error: "El archivo debe ser .xlsx" }, { status: 400 });
		}

		const filasXlsx = await leerFilasXlsx(archivo);
		if (filasXlsx.length < 2) {
			return NextResponse.json({ error: "El XLSX no trae filas válidas" }, { status: 400 });
		}

		const filas: { grado: string; grupo: string; clave_acceso: string }[] = [];
		const headers = (filasXlsx[0] ?? []).map(normalizarEncabezado);
		const idxGrupo = headers.findIndex((h) => h === "grupo");
		const idxToken = headers.findIndex((h) => h === "token" || h === "clave" || h === "claveacceso");
		const colGrupo = idxGrupo >= 0 ? idxGrupo : 0;
		const colToken = idxToken >= 0 ? idxToken : 1;

		for (const row of filasXlsx.slice(1)) {
			const grupoTexto = (row[colGrupo] ?? "").trim();
			const clave = (row[colToken] ?? "").trim().toUpperCase();
			if (!grupoTexto || !clave) {
				continue;
			}
			const gg = descomponerGrupo(grupoTexto);
			if (!gg || Number.parseInt(gg.grado, 10) !== 1) {
				continue;
			}
			filas.push({ grado: gg.grado, grupo: gg.grupo, clave_acceso: clave });
		}

		if (filas.length === 0) {
			return NextResponse.json(
				{
					error:
						"No se detectaron filas válidas. Grupo = solo letra de 1.° (A, B…); columnas grupo y token (o clave).",
				},
				{ status: 400 },
			);
		}

		const supabase = obtenerClienteSupabaseAdmin();
		const { data: existentes, error: errExistentes } = await supabase
			.from("grupo_tokens")
			.select("id, grado, grupo");
		if (errExistentes) {
			console.error("importar tokens xlsx leer existentes", errExistentes);
			return NextResponse.json({ error: "No se pudieron cargar los grupos existentes" }, { status: 500 });
		}
		const porGrupo = new Map<string, string>();
		for (const g of existentes ?? []) {
			porGrupo.set(`${String(g.grado)}|${String(g.grupo).toUpperCase()}`, String(g.id));
		}
		const filasUpsert = filas.map((f) => {
			const key = `${f.grado}|${f.grupo.toUpperCase()}`;
			const idExistente = porGrupo.get(key);
			if (idExistente) {
				return { id: idExistente, ...f };
			}
			return f;
		});

		const { error } = await supabase.from("grupo_tokens").upsert(filasUpsert, {
			onConflict: "id",
		});
		if (error) {
			console.error("importar tokens xlsx", error);
			return NextResponse.json({ error: "No se pudieron importar los tokens" }, { status: 500 });
		}
		return NextResponse.json({ ok: true, filas: filas.length });
	} catch (e) {
		console.error("importar tokens xlsx", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
