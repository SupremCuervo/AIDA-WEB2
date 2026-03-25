import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import type { CampoPlantillaRelleno, ValoresRellenoAlumno } from "@/lib/orientador/plantilla-definicion-relleno";

function truncarLinea(texto: string, maxChars: number): string {
	const t = texto.trim();
	if (t.length <= maxChars) {
		return t;
	}
	return `${t.slice(0, Math.max(0, maxChars - 1))}…`;
}

/**
 * Superpone texto del alumno sobre el PDF base según campos en coordenadas %.
 */
export async function rellenarPdfConValores(
	pdfBytes: ArrayBuffer,
	campos: CampoPlantillaRelleno[],
	valores: ValoresRellenoAlumno,
): Promise<Uint8Array> {
	const doc = await PDFDocument.load(pdfBytes);
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const pages = doc.getPages();

	const porPagina = new Map<number, CampoPlantillaRelleno[]>();
	for (const c of campos) {
		const lista = porPagina.get(c.pageIndex) ?? [];
		lista.push(c);
		porPagina.set(c.pageIndex, lista);
	}

	for (const [pageIndex, lista] of porPagina) {
		const page = pages[pageIndex];
		if (!page) {
			continue;
		}
		const { width: W, height: H } = page.getSize();

		for (const c of lista) {
			const textoBruto = valores[c.clave] ?? "";
			const fontSize = c.fontSizePt;
			const lineHeight = fontSize * 1.25;
			const maxChars = Math.max(12, Math.floor((W * 0.92) / (fontSize * 0.55)));
			const texto = truncarLinea(textoBruto, maxChars);
			const lineas = texto === "" ? [" "] : texto.split(/\r?\n/);
			const xLeft = (c.xPct / 100) * W;
			let yTop = H - (c.yPct / 100) * H;

			for (let li = 0; li < lineas.length; li++) {
				const linea = lineas[li] === "" ? " " : lineas[li];
				const baselineY = yTop - fontSize - li * lineHeight;
				page.drawText(linea, {
					x: xLeft,
					y: baselineY,
					size: fontSize,
					font,
					color: rgb(0, 0, 0),
					maxWidth: Math.max(40, W - xLeft - 8),
				});
			}
		}
	}

	return doc.save();
}
