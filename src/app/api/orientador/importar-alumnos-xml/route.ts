import { NextResponse } from "next/server";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { insertarPadronAlumnosIgnorarDuplicados } from "@/lib/orientador/insertar-padron-lote";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";
import { leerFilasXlsx } from "@/lib/orientador/xlsx-lectura";

export const runtime = "nodejs";

type FilaAlumnoXlsx = {
	nombreCompleto: string;
	claveAcceso: string | null;
	grado: string | null;
	grupo: string | null;
};

function descomponerGradoGrupo(valor: string): { grado: string; grupo: string } | null {
	const limpio = valor.trim().replace(/\s+/g, "");
	if (!limpio) {
		return null;
	}
	const soloLetra = /^[a-zA-Z]$/u.exec(limpio);
	if (soloLetra) {
		return { grado: "1", grupo: soloLetra[0].toUpperCase() };
	}
	const m = /^(\d+)([a-zA-Z])$/u.exec(limpio);
	if (!m) {
		return null;
	}
	return {
		grado: m[1],
		grupo: m[2].toUpperCase(),
	};
}

function normalizarEncabezado(texto: string): string {
	return texto
		.normalize("NFD")
		.replace(/\p{M}/gu, "")
		.toLowerCase()
		.replace(/[^a-z0-9]+/g, "")
		.trim();
}

function textoLimpio(v: string | null | undefined): string | null {
	if (!v) {
		return null;
	}
	const t = v.trim().replace(/\s+/g, " ");
	return t ? t : null;
}

function recolectarFilasDesdeXlsx(filasXlsx: string[][]): FilaAlumnoXlsx[] {
	if (filasXlsx.length < 2) {
		return [];
	}

	const headers = (filasXlsx[0] ?? []).map(normalizarEncabezado);
	const idxNombre = headers.findIndex((h) =>
		["nombrecompleto", "nombre", "alumno", "estudiante", "name"].includes(h),
	);
	const idxClave = headers.findIndex((h) =>
		["claveacceso", "clave", "token", "clavegrupo"].includes(h),
	);
	const idxGrado = headers.findIndex((h) => ["grado", "semestre"].includes(h));
	const idxGrupo = headers.findIndex((h) => ["grupo", "letragrupo", "grupoletra"].includes(h));

	const colNombre = idxNombre >= 0 ? idxNombre : 0;
	const colGrupo = idxGrupo >= 0 ? idxGrupo : 1;

	const filas: FilaAlumnoXlsx[] = [];
	for (const row of filasXlsx.slice(1)) {
		const nombre = textoLimpio(row[colNombre]);
		if (!nombre) {
			continue;
		}
		const claveAcceso = textoLimpio(idxClave >= 0 ? row[idxClave] : null);
		let grado = textoLimpio(idxGrado >= 0 ? row[idxGrado] : null);
		let grupo = textoLimpio(row[colGrupo]);

		if (!grado && grupo) {
			const duo = descomponerGradoGrupo(grupo);
			if (duo) {
				grado = duo.grado;
				grupo = duo.grupo;
			}
		}

		if (!claveAcceso && !(grado && grupo)) {
			continue;
		}

		filas.push({
			nombreCompleto: nombre,
			claveAcceso,
			grado,
			grupo,
		});
	}
	return filas;
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
			return NextResponse.json({ error: "Debes adjuntar un archivo XLSX" }, { status: 400 });
		}

		const nombreArchivo = archivo.name.toLowerCase();
		if (!nombreArchivo.endsWith(".xlsx")) {
			return NextResponse.json({ error: "El archivo debe ser .xlsx" }, { status: 400 });
		}

		const filasXlsx = await leerFilasXlsx(archivo);
		const filas = recolectarFilasDesdeXlsx(filasXlsx);

		if (filas.length === 0) {
			return NextResponse.json(
				{
					error:
						"No se encontraron alumnos válidos en el XLSX. Usa nombreCompleto + grupo, o clave/token.",
				},
				{ status: 400 },
			);
		}

		const supabase = obtenerClienteSupabaseAdmin();
		const { data: grupos, error: errGrupos } = await supabase
			.from("grupo_tokens")
			.select("id, clave_acceso, grado, grupo, institucion_grupo_id");

		if (errGrupos || !grupos) {
			console.error("importar xml grupos", errGrupos);
			return NextResponse.json({ error: "No se pudieron cargar los grupos" }, { status: 500 });
		}

		const porClave = new Map<string, string>();
		const porGradoGrupo = new Map<string, string>();
		const tokenPorId = new Map<string, { institucion_grupo_id: string | null }>();
		for (const g of grupos) {
			porClave.set(String(g.clave_acceso).toLowerCase(), String(g.id));
			const llave = `${String(g.grado).toLowerCase()}|${String(g.grupo).toLowerCase()}`;
			porGradoGrupo.set(llave, String(g.id));
			tokenPorId.set(String(g.id), {
				institucion_grupo_id: (g.institucion_grupo_id as string | null) ?? null,
			});
		}

		const filasPreparadas: {
			grupo_token_id: string;
			institucion_grupo_id: string | null;
			nombre_completo: string;
		}[] = [];
		let sinGrupo = 0;

		for (const fila of filas) {
			let grupoTokenId: string | null = null;
			if (fila.claveAcceso) {
				grupoTokenId = porClave.get(fila.claveAcceso.toLowerCase()) ?? null;
			}
			if (!grupoTokenId && fila.grado && fila.grupo) {
				const llave = `${fila.grado.toLowerCase()}|${fila.grupo.toLowerCase()}`;
				grupoTokenId = porGradoGrupo.get(llave) ?? null;
			}
			if (!grupoTokenId) {
				sinGrupo += 1;
				continue;
			}
			const meta = tokenPorId.get(grupoTokenId);
			filasPreparadas.push({
				grupo_token_id: grupoTokenId,
				institucion_grupo_id: meta?.institucion_grupo_id ?? null,
				nombre_completo: fila.nombreCompleto,
			});
		}

		if (filasPreparadas.length === 0) {
			return NextResponse.json(
				{ error: "Ningún alumno pudo relacionarse con un grupo existente" },
				{ status: 400 },
			);
		}

		const unicas = new Map<
			string,
			{ grupo_token_id: string; institucion_grupo_id: string | null; nombre_completo: string }
		>();
		for (const f of filasPreparadas) {
			const key = `${f.grupo_token_id}|${f.nombre_completo.toLowerCase()}`;
			if (!unicas.has(key)) {
				unicas.set(key, f);
			}
		}
		const filasFinales = [...unicas.values()];

		const { error: errInsert } = await insertarPadronAlumnosIgnorarDuplicados(supabase, filasFinales);

		if (errInsert) {
			console.error("importar xlsx padron", errInsert);
			return NextResponse.json({ error: "No se pudo guardar el padrón" }, { status: 500 });
		}

		return NextResponse.json({
			ok: true,
			resumen: {
				filasDetectadas: filas.length,
				filasRelacionadas: filasPreparadas.length,
				filasGuardadas: filasFinales.length,
				filasSinGrupo: sinGrupo,
			},
		});
	} catch (e) {
		console.error("importar xlsx", e);
		return NextResponse.json({ error: "Error al procesar el XLSX" }, { status: 500 });
	}
}
