import { PDFDocument, type PDFImage } from "pdf-lib";

const MIME_PDF = "application/pdf";

function extensionInferior(nombre: string): string {
	const i = nombre.lastIndexOf(".");
	return i >= 0 ? nombre.slice(i + 1).toLowerCase() : "";
}

export function esTipoArchivoSubidaAlumnoOk(file: File): boolean {
	const type = (file.type || "").toLowerCase().trim();
	if (type === MIME_PDF || type === "application/x-pdf") {
		return true;
	}
	if (/^image\/(png|jpeg|jpg|webp)$/.test(type)) {
		return true;
	}
	const ext = extensionInferior(file.name);
	return ext === "pdf" || ext === "png" || ext === "jpg" || ext === "jpeg" || ext === "webp";
}

function esArchivoPdf(file: File): boolean {
	const type = (file.type || "").toLowerCase().trim();
	return type === MIME_PDF || type === "application/x-pdf" || extensionInferior(file.name) === "pdf";
}

function esPng(file: File): boolean {
	return (file.type || "").toLowerCase() === "image/png" || extensionInferior(file.name) === "png";
}

function esJpeg(file: File): boolean {
	const t = (file.type || "").toLowerCase();
	return t === "image/jpeg" || /\.jpe?g$/i.test(file.name);
}

function esWebp(file: File): boolean {
	return (file.type || "").toLowerCase() === "image/webp" || extensionInferior(file.name) === "webp";
}

async function webpBytesAPng(bytes: Uint8Array): Promise<Uint8Array> {
	const blob = new Blob([bytes], { type: "image/webp" });
	const bmp = await createImageBitmap(blob);
	try {
		const c = document.createElement("canvas");
		c.width = bmp.width;
		c.height = bmp.height;
		const ctx = c.getContext("2d");
		if (!ctx) {
			throw new Error("canvas");
		}
		ctx.drawImage(bmp, 0, 0);
		const pngBlob = await new Promise<Blob>((resolve, reject) => {
			c.toBlob((b) => (b ? resolve(b) : reject(new Error("toBlob"))), "image/png");
		});
		return new Uint8Array(await pngBlob.arrayBuffer());
	} finally {
		bmp.close();
	}
}

function nombreBaseSinExt(nombre: string): string {
	const i = nombre.lastIndexOf(".");
	return i > 0 ? nombre.slice(0, i) : nombre || "documento";
}

/**
 * Si el archivo ya es PDF, se devuelve tal cual (ajustando tipo MIME).
 * Si es imagen (png, jpeg, webp), genera un PDF de una página con la imagen a tamaño natural.
 */
export async function normalizarArchivoSubidaAlumnoAPdf(file: File): Promise<File> {
	if (!esTipoArchivoSubidaAlumnoOk(file)) {
		throw new Error("TIPO_NO_PERMITIDO");
	}
	if (esArchivoPdf(file)) {
		const buf = await file.arrayBuffer();
		return new File([buf], nombreBaseSinExt(file.name) + ".pdf", { type: MIME_PDF });
	}

	const bytes = new Uint8Array(await file.arrayBuffer());
	const pdfDoc = await PDFDocument.create();
	let embedded: PDFImage;

	if (esPng(file)) {
		embedded = await pdfDoc.embedPng(bytes);
	} else if (esJpeg(file)) {
		embedded = await pdfDoc.embedJpg(bytes);
	} else if (esWebp(file)) {
		const pngBytes = await webpBytesAPng(bytes);
		embedded = await pdfDoc.embedPng(pngBytes);
	} else {
		throw new Error("TIPO_NO_PERMITIDO");
	}

	const { width, height } = embedded;
	const page = pdfDoc.addPage([width, height]);
	page.drawImage(embedded, { x: 0, y: 0, width, height });

	const out = await pdfDoc.save();
	return new File([out], `${nombreBaseSinExt(file.name)}.pdf`, { type: MIME_PDF });
}
