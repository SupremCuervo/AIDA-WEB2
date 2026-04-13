import { NextResponse } from "next/server";
import { mensajeCausaParaUsuario } from "@/lib/mensaje-red-amigable";
import {
	esTipoDocumentoValido,
	nombreArchivoEstandar,
	TIPOS_DOCUMENTO,
} from "@/lib/nombre-archivo";

type CuerpoSolicitud = {
	nombreAlumno?: string;
	tipoDocumento?: string;
	extension?: string;
};

export async function POST(request: Request) {
	let cuerpo: CuerpoSolicitud;
	try {
		cuerpo = (await request.json()) as CuerpoSolicitud;
	} catch {
		return NextResponse.json(
			{ error: "JSON inválido" },
			{ status: 400 },
		);
	}

	const nombreAlumno = typeof cuerpo.nombreAlumno === "string" ? cuerpo.nombreAlumno : "";
	const tipoDocumento = typeof cuerpo.tipoDocumento === "string" ? cuerpo.tipoDocumento : "";
	const extension = typeof cuerpo.extension === "string" ? cuerpo.extension : "pdf";

	if (!nombreAlumno.trim()) {
		return NextResponse.json(
			{ error: "nombreAlumno es obligatorio" },
			{ status: 400 },
		);
	}

	if (!esTipoDocumentoValido(tipoDocumento)) {
		return NextResponse.json(
			{
				error: "tipoDocumento no válido",
				tiposPermitidos: Object.keys(TIPOS_DOCUMENTO),
			},
			{ status: 400 },
		);
	}

	try {
		const resultado = nombreArchivoEstandar(nombreAlumno, tipoDocumento, extension);
		return NextResponse.json({
			nombreTecnico: resultado.nombreCompleto,
			slugAlumno: resultado.slugAlumno,
			slugTipo: resultado.slugTipo,
			extension: resultado.extension,
		});
	} catch (e) {
		const mensaje = mensajeCausaParaUsuario(e);
		return NextResponse.json(
			{ error: mensaje === "Ocurrió un error inesperado." ? "Error al generar nombre" : mensaje },
			{ status: 400 },
		);
	}
}
