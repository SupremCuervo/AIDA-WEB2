import { NextResponse } from "next/server";
import { gradoMostradoParaAlumno } from "@/lib/padron/grado-alumno";
import { obtenerClienteSupabaseAdmin } from "@/lib/supabase/admin";
import { obtenerPayloadOrientador } from "@/lib/orientador/sesion-request";

export const runtime = "nodejs";

function cuentaIdDesdePadron(
	c: { id: string }[] | { id: string } | null,
): string | null {
	if (!c) {
		return null;
	}
	if (Array.isArray(c)) {
		return c[0]?.id ?? null;
	}
	return typeof c.id === "string" ? c.id : null;
}

export async function GET(request: Request) {
	const orientador = await obtenerPayloadOrientador();
	if (!orientador) {
		return NextResponse.json({ error: "No autenticado" }, { status: 401 });
	}

	const url = new URL(request.url);
	const nombreQ = url.searchParams.get("nombre")?.trim() ?? "";
	const grupoTokenId = url.searchParams.get("grupoTokenId")?.trim() ?? "";
	const carreraId = url.searchParams.get("carreraId")?.trim() ?? "";

	try {
		const supabase = obtenerClienteSupabaseAdmin();
		let q = supabase
			.from("padron_alumnos")
			.select(
				`
				id,
				nombre_completo,
				grado_alumno,
				carrera_id,
				archivo_muerto_en,
				grupo_token_id,
				grupo_tokens ( grupo, grado ),
				cuentas_alumno ( id )
			`,
			)
			.not("archivo_muerto_en", "is", null)
			.order("archivo_muerto_en", { ascending: false });

		if (grupoTokenId) {
			q = q.eq("grupo_token_id", grupoTokenId);
		}
		if (carreraId) {
			q = q.eq("carrera_id", carreraId);
		}

		const { data: filas, error } = await q;
		if (error) {
			console.error("archivo-muerto alumnos", error);
			return NextResponse.json({ error: "No se pudo cargar la lista" }, { status: 500 });
		}

		type Fila = {
			id: string;
			nombre_completo: string;
			grado_alumno: string | null;
			carrera_id: string | null;
			archivo_muerto_en: string;
			grupo_token_id: string;
			grupo_tokens: { grupo: string; grado: string } | null;
			cuentas_alumno: { id: string }[] | { id: string } | null;
		};

		const lista = (filas ?? []) as unknown as Fila[];
		const idsCarrera = [...new Set(lista.map((r) => r.carrera_id).filter((x): x is string => Boolean(x)))];
		const mapaCarrera = new Map<string, { nombre: string; codigo: string }>();
		if (idsCarrera.length > 0) {
			const { data: cars } = await supabase
				.from("carreras")
				.select("id, nombre, codigo")
				.in("id", idsCarrera);
			for (const c of cars ?? []) {
				mapaCarrera.set(String(c.id), {
					nombre: String(c.nombre),
					codigo: String(c.codigo),
				});
			}
		}

		const filtrada = nombreQ
			? lista.filter((r) =>
					r.nombre_completo.toLowerCase().includes(nombreQ.toLowerCase()),
				)
			: lista;

		const salida = filtrada.map((r) => {
			const gt = r.grupo_tokens;
			const gradoTok = gt?.grado != null ? String(gt.grado) : "1";
			const gradoMostrado = gradoMostradoParaAlumno(r.grado_alumno, gradoTok);
			const cr = r.carrera_id ? mapaCarrera.get(String(r.carrera_id)) : undefined;
			const cid = cuentaIdDesdePadron(r.cuentas_alumno);
			return {
				padronId: r.id,
				nombreCompleto: r.nombre_completo,
				grupoTokenId: r.grupo_token_id,
				grupoLetra: gt?.grupo ?? "",
				gradoMostrado,
				carreraId: r.carrera_id,
				carreraNombre: cr?.nombre ?? null,
				carreraCodigo: cr?.codigo ?? null,
				archivoMuertoEn: r.archivo_muerto_en,
				cuentaId: cid,
				tieneCuenta: Boolean(cid),
			};
		});

		return NextResponse.json({ alumnos: salida });
	} catch (e) {
		console.error("archivo-muerto alumnos", e);
		return NextResponse.json({ error: "Error del servidor" }, { status: 500 });
	}
}
