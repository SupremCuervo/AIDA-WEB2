/**
 * Definición persistida en orientador_plantillas.definicion_relleno (jsonb).
 * Coordenadas en % del ancho/alto de la página (origen arriba-izquierda en pantalla;
 * el servidor convierte a puntos PDF como en plantillas-export-pdf).
 */

export const CLAVES_DATO_ALUMNO = [
	{ clave: "nombre_completo", etiqueta: "Nombre completo" },
	{ clave: "grado", etiqueta: "Grado escolar" },
	{ clave: "grupo", etiqueta: "Grupo (letra)" },
	{ clave: "clave_grupo", etiqueta: "Clave / token del grupo" },
	{ clave: "matricula", etiqueta: "Matrícula" },
	{ clave: "carrera", etiqueta: "Carrera" },
	{ clave: "otro", etiqueta: "Otro" },
] as const;

export type ClaveDatoAlumno = (typeof CLAVES_DATO_ALUMNO)[number]["clave"];

/** Tamaño por defecto del texto en PDF y en editor (~8px en pantalla ≈ 8 pt). */
export const PLANTILLA_FUENTE_PT_DEFECTO = 8;

/**
 * Misma familia que el texto superpuesto en PDF (`StandardFonts.Helvetica` en pdf-lib).
 * El visor PDF suele sustituir Helvetica por Helvetica o Arial del sistema; en pantalla
 * forzamos Helvetica/Arial y evitamos `system-ui` o solo «Helvetica Neue» (métricas distintas).
 */
export const PLANTILLA_FUENTE_FAMILIA_CSS =
	'Helvetica, Arial, "Liberation Sans", "Nimbus Sans", sans-serif';

export type CampoPlantillaRelleno = {
	id: string;
	pageIndex: number;
	xPct: number;
	yPct: number;
	/** Tamaño de fuente en puntos tipográficos (pt). */
	fontSizePt: number;
	clave: ClaveDatoAlumno;
};

export type PlantillaDefinicionRelleno = {
	version: 1;
	campos: CampoPlantillaRelleno[];
};

const CLAVES_SET = new Set<string>(CLAVES_DATO_ALUMNO.map((c) => c.clave));

export function etiquetaClave(clave: string): string {
	const h = CLAVES_DATO_ALUMNO.find((c) => c.clave === clave);
	return h?.etiqueta ?? clave;
}

export function normalizarDefinicionRelleno(raw: unknown): PlantillaDefinicionRelleno | null {
	if (raw == null || typeof raw !== "object") {
		return null;
	}
	const o = raw as Record<string, unknown>;
	if (o.version !== 1) {
		return null;
	}
	if (!Array.isArray(o.campos)) {
		return { version: 1, campos: [] };
	}
	const campos: CampoPlantillaRelleno[] = [];
	for (const c of o.campos) {
		if (!c || typeof c !== "object") {
			continue;
		}
		const x = c as Record<string, unknown>;
		const id = typeof x.id === "string" ? x.id.trim() : "";
		const clave = typeof x.clave === "string" ? x.clave.trim() : "";
		if (!id || !CLAVES_SET.has(clave)) {
			continue;
		}
		const pageIndex = Number(x.pageIndex);
		const xPct = Number(x.xPct);
		const yPct = Number(x.yPct);
		let fontSizePt = Number(x.fontSizePt);
		if (!Number.isFinite(pageIndex) || pageIndex < 0) {
			continue;
		}
		if (!Number.isFinite(xPct) || !Number.isFinite(yPct)) {
			continue;
		}
		if (!Number.isFinite(fontSizePt) || fontSizePt < 6 || fontSizePt > 48) {
			fontSizePt = PLANTILLA_FUENTE_PT_DEFECTO;
		}
		campos.push({
			id,
			pageIndex: Math.floor(pageIndex),
			xPct: Math.min(100, Math.max(0, xPct)),
			yPct: Math.min(100, Math.max(0, yPct)),
			fontSizePt,
			clave: clave as ClaveDatoAlumno,
		});
	}
	return { version: 1, campos };
}

export type ValoresRellenoAlumno = Record<ClaveDatoAlumno, string>;

export function construirValoresDesdePadron(fila: {
	nombreCompleto: string;
	gradoTexto: string;
	grupoLetra: string;
	claveGrupo: string;
	matricula: string;
	carreraNombre: string;
}): ValoresRellenoAlumno {
	return {
		nombre_completo: fila.nombreCompleto,
		grado: fila.gradoTexto,
		grupo: fila.grupoLetra,
		clave_grupo: fila.claveGrupo,
		matricula: fila.matricula,
		carrera: fila.carreraNombre,
		otro: "",
	};
}
