import { PDFDocument } from "pdf-lib";

const MIME_JPEG = new Set(["image/jpeg", "image/jpg"]);
const MIME_PNG = new Set(["image/png", "image/x-png"]);

function mimeNormalizado(mimeRaw: string): string {
	return mimeRaw.split(";")[0].trim().toLowerCase();
}

export function esImagenConvertibleApdf(mimeRaw: string): boolean {
	const m = mimeNormalizado(mimeRaw);
	return MIME_JPEG.has(m) || MIME_PNG.has(m);
}

/**
 * Convierte JPEG o PNG a un PDF de una sola página (mismas dimensiones que la imagen).
 */
export async function bufferImagenJpegPngAPdf(bytes: Buffer, mimeRaw: string): Promise<Buffer> {
	const mime = mimeNormalizado(mimeRaw);
	const pdf = await PDFDocument.create();
	let img;
	if (MIME_PNG.has(mime)) {
		img = await pdf.embedPng(bytes);
	} else if (MIME_JPEG.has(mime)) {
		img = await pdf.embedJpg(bytes);
	} else {
		throw new Error(`MIME no soportado para PDF: ${mime}`);
	}
	const page = pdf.addPage([img.width, img.height]);
	page.drawImage(img, { x: 0, y: 0, width: img.width, height: img.height });
	return Buffer.from(await pdf.save());
}
