import { PDFDocument } from "pdf-lib";

export async function jpegsABufferPdf(jpegs: Uint8Array[]): Promise<Uint8Array> {
	const doc = await PDFDocument.create();
	for (const bytes of jpegs) {
		const img = await doc.embedJpg(bytes);
		const { width, height } = img.scale(1);
		const page = doc.addPage([width, height]);
		page.drawImage(img, { x: 0, y: 0, width, height });
	}
	return doc.save();
}
