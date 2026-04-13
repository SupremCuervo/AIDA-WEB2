import JSZip from "jszip";

function decodificarXml(texto: string): string {
	return texto
		.replace(/&amp;/g, "&")
		.replace(/&lt;/g, "<")
		.replace(/&gt;/g, ">")
		.replace(/&quot;/g, '"')
		.replace(/&apos;/g, "'");
}

function leerAtributo(attrsRaw: string, nombre: string): string | null {
	const re = new RegExp(`${nombre}="([^"]+)"`, "i");
	const m = re.exec(attrsRaw);
	if (!m?.[1]) {
		return null;
	}
	return decodificarXml(m[1]);
}

function columnaAIndice(columna: string): number {
	let out = 0;
	for (const ch of columna.toUpperCase()) {
		const code = ch.charCodeAt(0);
		if (code < 65 || code > 90) {
			return 0;
		}
		out = out * 26 + (code - 64);
	}
	return Math.max(0, out - 1);
}

function extraerTextoPlanoDesdeSi(siRaw: string): string {
	const trozos: string[] = [];
	const reT = /<t[^>]*>([\s\S]*?)<\/t>/gi;
	let m: RegExpExecArray | null = reT.exec(siRaw);
	while (m) {
		trozos.push(decodificarXml(m[1] ?? ""));
		m = reT.exec(siRaw);
	}
	return trozos.join("").trim();
}

function extraerSharedStrings(xml: string | null): string[] {
	if (!xml) {
		return [];
	}
	const out: string[] = [];
	const reSi = /<si[^>]*>([\s\S]*?)<\/si>/gi;
	let m: RegExpExecArray | null = reSi.exec(xml);
	while (m) {
		out.push(extraerTextoPlanoDesdeSi(m[1] ?? ""));
		m = reSi.exec(xml);
	}
	return out;
}

function extraerValorCelda(cuerpo: string, tipo: string | null, shared: string[]): string {
	if ((tipo ?? "").toLowerCase() === "inlineStr".toLowerCase()) {
		const t = /<t[^>]*>([\s\S]*?)<\/t>/i.exec(cuerpo);
		return decodificarXml((t?.[1] ?? "").trim());
	}
	const v = /<v[^>]*>([\s\S]*?)<\/v>/i.exec(cuerpo);
	const valorBruto = decodificarXml((v?.[1] ?? "").trim());
	if ((tipo ?? "").toLowerCase() === "s") {
		const idx = Number.parseInt(valorBruto, 10);
		if (Number.isNaN(idx) || idx < 0 || idx >= shared.length) {
			return "";
		}
		return shared[idx] ?? "";
	}
	return valorBruto;
}

function normalizarRutaInterna(basePath: string, destino: string): string {
	const destinoLimpio = destino.replace(/^\/+/, "");
	if (/^(xl|docProps|_rels)\//i.test(destinoLimpio)) {
		return destinoLimpio;
	}
	const basePartes = basePath.split("/");
	basePartes.pop();
	const out: string[] = [];
	for (const p of [...basePartes, ...destinoLimpio.split("/")]) {
		if (!p || p === ".") {
			continue;
		}
		if (p === "..") {
			out.pop();
			continue;
		}
		out.push(p);
	}
	return out.join("/");
}

async function resolverRutaHoja1(zip: JSZip): Promise<string> {
	const workbookPath = "xl/workbook.xml";
	const relsPath = "xl/_rels/workbook.xml.rels";
	const workbookXml = await zip.file(workbookPath)?.async("text");
	const relsXml = await zip.file(relsPath)?.async("text");
	if (!workbookXml || !relsXml) {
		throw new Error("Estructura XLSX inválida (workbook).");
	}

	const sheetMatch = /<sheet\b[^>]*r:id="([^"]+)"[^>]*\/?>/i.exec(workbookXml);
	if (!sheetMatch?.[1]) {
		throw new Error("No se encontró una hoja en el XLSX.");
	}
	const relId = sheetMatch[1];

	const relRe = /<Relationship\b([^>]*)\/?>/gi;
	let rel: RegExpExecArray | null = relRe.exec(relsXml);
	while (rel) {
		const attrs = rel[1] ?? "";
		const id = leerAtributo(attrs, "Id");
		if (id === relId) {
			const target = leerAtributo(attrs, "Target");
			if (!target) {
				break;
			}
			const candidatos = [
				normalizarRutaInterna(workbookPath, target),
				normalizarRutaInterna(relsPath, target),
			];
			for (const c of candidatos) {
				if (zip.file(c)) {
					return c;
				}
			}
			return candidatos[0];
		}
		rel = relRe.exec(relsXml);
	}
	throw new Error("No se pudo resolver la hoja principal del XLSX.");
}

export async function leerFilasXlsx(archivo: File): Promise<string[][]> {
	const buffer = await archivo.arrayBuffer();
	const zip = await JSZip.loadAsync(buffer);
	const sharedXml = (await zip.file("xl/sharedStrings.xml")?.async("text")) ?? null;
	const shared = extraerSharedStrings(sharedXml);
	const hojaPath = await resolverRutaHoja1(zip);
	const hojaXml = await zip.file(hojaPath)?.async("text");
	if (!hojaXml) {
		throw new Error("No se pudo leer la primera hoja del XLSX.");
	}

	const filas: string[][] = [];
	const reRow = /<row\b[^>]*>([\s\S]*?)<\/row>/gi;
	let rowMatch: RegExpExecArray | null = reRow.exec(hojaXml);
	while (rowMatch) {
		const rowRaw = rowMatch[1] ?? "";
		const fila: string[] = [];

		const reCell = /<c\b([^>]*)>([\s\S]*?)<\/c>|<c\b([^>]*)\/>/gi;
		let cell: RegExpExecArray | null = reCell.exec(rowRaw);
		while (cell) {
			const attrsRaw = (cell[1] ?? cell[3] ?? "").trim();
			const bodyRaw = cell[2] ?? "";
			const ref = leerAtributo(attrsRaw, "r") ?? "";
			const colTxt = (ref.match(/^[A-Za-z]+/)?.[0] ?? "A").toUpperCase();
			const col = columnaAIndice(colTxt);
			const tipo = leerAtributo(attrsRaw, "t");
			const val = extraerValorCelda(bodyRaw, tipo, shared);
			while (fila.length <= col) {
				fila.push("");
			}
			fila[col] = val;
			cell = reCell.exec(rowRaw);
		}

		const tieneAlgo = fila.some((v) => v.trim() !== "");
		if (tieneAlgo) {
			filas.push(fila.map((v) => v.trim()));
		}
		rowMatch = reRow.exec(hojaXml);
	}
	return filas;
}
