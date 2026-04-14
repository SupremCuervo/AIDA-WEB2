import { PDFDocument, StandardFonts, rgb } from "pdf-lib";
import { PLANTILLA_FUENTE_PT_DEFECTO } from "@/lib/orientador/plantilla-definicion-relleno";

export type AnotacionExport = {
	pageIndex: number;
	xPct: number;
	yPct: number;
	text: string;
	colorHex: string;
	/** Si true, rectángulo blanco y borde gris detrás del texto (impresión más “formulario”). */
	fondo: boolean;
	/** Tamaño en puntos tipográficos; alineado con `CampoPlantillaRelleno.fontSizePt`. */
	fontSizePt?: number;
};

function hexARgb01(hex: string): { r: number; g: number; b: number } {
	const h = hex.replace("#", "").padEnd(6, "0").slice(0, 6);
	return {
		r: Number.parseInt(h.slice(0, 2), 16) / 255,
		g: Number.parseInt(h.slice(2, 4), 16) / 255,
		b: Number.parseInt(h.slice(4, 6), 16) / 255,
	};
}

export async function exportarPdfConAnotaciones(
	pdfBytes: ArrayBuffer,
	anotaciones: AnotacionExport[],
): Promise<Uint8Array> {
	const doc = await PDFDocument.load(pdfBytes);
	const font = await doc.embedFont(StandardFonts.Helvetica);
	const pages = doc.getPages();

	const porPagina = new Map<number, AnotacionExport[]>();
	for (const a of anotaciones) {
		const lista = porPagina.get(a.pageIndex) ?? [];
		lista.push(a);
		porPagina.set(a.pageIndex, lista);
	}

	for (const [pageIndex, lista] of porPagina) {
		const page = pages[pageIndex];
		if (!page) {
			continue;
		}
		const { width: W, height: H } = page.getSize();

		for (const a of lista) {
			const fontSize = Math.max(
				6,
				Math.min(Number(a.fontSizePt) || PLANTILLA_FUENTE_PT_DEFECTO, 48),
			);
			const lineHeight = fontSize * 1.25;
			const texto = a.text.trim() === "" ? " " : a.text;
			const lineas = texto.split("\n");
			const col = hexARgb01(a.colorHex);
			const xLeft = (a.xPct / 100) * W;
			let yTop = H - (a.yPct / 100) * H;

			for (let li = 0; li < lineas.length; li++) {
				const linea = lineas[li] === "" ? " " : lineas[li];
				const baselineY = yTop - fontSize - li * lineHeight;
				const tw = font.widthOfTextAtSize(linea, fontSize);
				if (a.fondo) {
					page.drawRectangle({
						x: xLeft - 2,
						y: baselineY - 2,
						width: Math.min(tw + 6, W - xLeft + 2),
						height: fontSize + 4,
						color: rgb(1, 1, 1),
						borderColor: rgb(0.85, 0.85, 0.85),
						borderWidth: 0.5,
					});
				}
				page.drawText(linea, {
					x: xLeft,
					y: baselineY,
					size: fontSize,
					font,
					color: rgb(col.r, col.g, col.b),
				});
			}
		}
	}

	return doc.save();
}
