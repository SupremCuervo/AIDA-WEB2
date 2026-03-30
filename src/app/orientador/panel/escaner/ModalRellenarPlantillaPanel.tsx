"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
	CLAVES_DATO_ALUMNO,
	etiquetaClave,
	type CampoPlantillaRelleno,
	type ClaveDatoAlumno,
} from "@/lib/orientador/plantilla-definicion-relleno";
import { exportarPdfConAnotaciones } from "@/lib/orientador/plantillas-export-pdf";

function PaginaRelleno({
	pdf,
	pageIndex,
	campos,
	valores,
	onValor,
}: {
	pdf: PDFDocumentProxy;
	pageIndex: number;
	campos: CampoPlantillaRelleno[];
	valores: Record<string, string>;
	onValor: (id: string, v: string) => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const wrapRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let cancel = false;
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		(async () => {
			const page = await pdf.getPage(pageIndex + 1);
			if (cancel) {
				return;
			}
			const ctx = canvas.getContext("2d");
			if (!ctx) {
				return;
			}
			const scale = 1.15;
			const viewport = page.getViewport({ scale });
			canvas.width = viewport.width;
			canvas.height = viewport.height;
			await page.render({ canvasContext: ctx, viewport }).promise;
		})();
		return () => {
			cancel = true;
		};
	}, [pdf, pageIndex]);

	const dePagina = campos.filter((c) => c.pageIndex === pageIndex);

	return (
		<div className="flex shrink-0 flex-col items-center">
			<div
				ref={wrapRef}
				className="relative inline-block max-w-[min(100%,320px)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow"
			>
				<canvas ref={canvasRef} className="block max-w-full" />
				{dePagina.map((c) => (
					<input
						key={c.id}
						type="text"
						value={valores[c.id] ?? ""}
						onChange={(e) => onValor(c.id, e.target.value)}
						className="absolute z-[2] min-w-[4rem] rounded border border-slate-400 bg-white/95 px-1 py-0.5 text-xs text-slate-900 shadow-sm outline-none focus:ring-1 focus:ring-violet-500"
						style={{
							left: `${c.xPct}%`,
							top: `${c.yPct}%`,
							transform: "translate(-2px, -2px)",
							width: "min(85%, 14rem)",
							fontSize: `${Math.max(9, Math.min(c.fontSizePt, 14))}px`,
						}}
						placeholder={etiquetaClave(c.clave)}
						aria-label={etiquetaClave(c.clave)}
					/>
				))}
			</div>
		</div>
	);
}

type Props = {
	abierto: boolean;
	plantillaId: string;
	titulo: string;
	onCerrar: () => void;
	onDefinicionActualizada?: () => void;
};

export default function ModalRellenarPlantillaPanel({
	abierto,
	plantillaId,
	titulo,
	onCerrar,
	onDefinicionActualizada,
}: Props) {
	const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
	const [numPages, setNumPages] = useState(0);
	const [campos, setCampos] = useState<CampoPlantillaRelleno[]>([]);
	const [valores, setValores] = useState<Record<string, string>>({});
	const pdfBytesRef = useRef<ArrayBuffer | null>(null);
	const [cargando, setCargando] = useState(false);
	const [error, setError] = useState("");
	const [exportando, setExportando] = useState(false);
	const [claveNueva, setClaveNueva] = useState<ClaveDatoAlumno>("nombre_completo");
	const [guardandoCampo, setGuardandoCampo] = useState(false);

	const cargar = useCallback(async () => {
		if (!plantillaId) {
			return;
		}
		setCargando(true);
		setError("");
		try {
			const [rp, rd] = await Promise.all([
				fetch(`/api/orientador/plantillas/${plantillaId}/pdf`, { credentials: "include" }),
				fetch(`/api/orientador/plantillas/${plantillaId}/definicion-relleno`, { credentials: "include" }),
			]);
			if (!rp.ok) {
				const j = (await rp.json()) as { error?: string };
				setError(j.error ?? "No se pudo cargar el PDF");
				return;
			}
			const buf = await rp.arrayBuffer();
			pdfBytesRef.current = buf.slice(0);
			const pdfjs = await import("pdfjs-dist");
			if (typeof window !== "undefined") {
				pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdf.worker.min.mjs`;
			}
			const doc = await pdfjs.getDocument({ data: buf.slice(0) }).promise;
			setPdf(doc);
			setNumPages(doc.numPages);

			let lista: CampoPlantillaRelleno[] = [];
			if (rd.ok) {
				const jd = (await rd.json()) as { definicion?: { campos?: CampoPlantillaRelleno[] } };
				lista = jd.definicion?.campos ?? [];
			}
			setCampos(lista);
			const v: Record<string, string> = {};
			for (const c of lista) {
				v[c.id] = "";
			}
			setValores(v);
		} catch {
			setError("Error de red al cargar la plantilla");
		} finally {
			setCargando(false);
		}
	}, [plantillaId]);

	useEffect(() => {
		if (!abierto) {
			setPdf(null);
			setNumPages(0);
			setCampos([]);
			setValores({});
			pdfBytesRef.current = null;
			setError("");
			return;
		}
		void cargar();
	}, [abierto, cargar]);

	const onValor = useCallback((id: string, v: string) => {
		setValores((prev) => ({ ...prev, [id]: v }));
	}, []);

	const persistirDefinicion = useCallback(
		async (nuevaLista: CampoPlantillaRelleno[]) => {
			const res = await fetch(`/api/orientador/plantillas/${plantillaId}/definicion-relleno`, {
				method: "PUT",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ definicion: { version: 1, campos: nuevaLista } }),
			});
			if (!res.ok) {
				const j = (await res.json()) as { error?: string };
				throw new Error(j.error ?? "No se pudo guardar la definición");
			}
		},
		[plantillaId],
	);

	const agregarCampo = useCallback(async () => {
		if (!pdf || numPages < 1) {
			return;
		}
		setGuardandoCampo(true);
		setError("");
		try {
			const id = crypto.randomUUID();
			const nuevo: CampoPlantillaRelleno = {
				id,
				pageIndex: 0,
				xPct: 12,
				yPct: 18,
				fontSizePt: 11,
				clave: claveNueva,
			};
			const nuevaLista = [...campos, nuevo];
			await persistirDefinicion(nuevaLista);
			setCampos(nuevaLista);
			setValores((prev) => ({ ...prev, [id]: "" }));
			onDefinicionActualizada?.();
		} catch (e) {
			setError(e instanceof Error ? e.message : "Error al agregar campo");
		} finally {
			setGuardandoCampo(false);
		}
	}, [pdf, numPages, campos, claveNueva, persistirDefinicion, onDefinicionActualizada]);

	const descargarPdf = useCallback(async () => {
		const buf = pdfBytesRef.current;
		if (!buf) {
			setError("PDF no cargado");
			return;
		}
		setExportando(true);
		setError("");
		try {
			const anotaciones = campos.map((c) => ({
				pageIndex: c.pageIndex,
				xPct: c.xPct,
				yPct: c.yPct,
				text: valores[c.id] ?? "",
				colorHex: "#0f172a",
				fondo: true,
			}));
			const out = await exportarPdfConAnotaciones(buf, anotaciones);
			const blob = new Blob([out], { type: "application/pdf" });
			const u = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = u;
			a.download = `${titulo.replace(/\s+/g, "_")}_relleno.pdf`;
			a.click();
			URL.revokeObjectURL(u);
		} catch {
			setError("No se pudo generar el PDF");
		} finally {
			setExportando(false);
		}
	}, [campos, valores, titulo]);

	const imprimir = useCallback(async () => {
		const buf = pdfBytesRef.current;
		if (!buf) {
			return;
		}
		setExportando(true);
		try {
			const anotaciones = campos.map((c) => ({
				pageIndex: c.pageIndex,
				xPct: c.xPct,
				yPct: c.yPct,
				text: valores[c.id] ?? "",
				colorHex: "#0f172a",
				fondo: true,
			}));
			const out = await exportarPdfConAnotaciones(buf, anotaciones);
			const blob = new Blob([out], { type: "application/pdf" });
			const u = URL.createObjectURL(blob);
			const w = window.open(u, "_blank");
			if (w) {
				w.onload = () => {
					w.print();
				};
			}
			setTimeout(() => URL.revokeObjectURL(u), 60_000);
		} finally {
			setExportando(false);
		}
	}, [campos, valores]);

	if (!abierto) {
		return null;
	}

	return (
		<div
			className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-900/55 p-3 sm:p-4"
			onClick={(e) => {
				if (e.target === e.currentTarget) {
					onCerrar();
				}
			}}
			role="presentation"
		>
			<div
				className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="titulo-relleno-plantilla"
			>
				<div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-2">
					<button
						type="button"
						onClick={onCerrar}
						className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
						aria-label="Volver"
					>
						<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
							<path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
						</svg>
					</button>
					<h2 id="titulo-relleno-plantilla" className="flex-1 text-center text-base font-bold text-slate-900">
						{titulo}
					</h2>
					<span className="w-9" />
				</div>

				<div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto p-4">
					{cargando ? (
						<p className="text-center text-sm text-slate-600">Cargando…</p>
					) : error && !pdf ? (
						<p className="text-center text-sm text-red-600">{error}</p>
					) : pdf && numPages > 0 ? (
						<div className="flex flex-row flex-nowrap gap-4">
							{Array.from({ length: numPages }, (_, i) => (
								<PaginaRelleno
									key={i}
									pdf={pdf}
									pageIndex={i}
									campos={campos}
									valores={valores}
									onValor={onValor}
								/>
							))}
						</div>
					) : null}
				</div>

				{error && pdf ? <p className="px-4 text-center text-sm text-red-600">{error}</p> : null}

				<div className="shrink-0 space-y-2 border-t border-slate-100 px-4 py-3">
					<div className="flex flex-wrap items-center justify-center gap-2">
						<label className="flex items-center gap-2 text-xs text-slate-600">
							Campo nuevo
							<select
								value={claveNueva}
								onChange={(e) => setClaveNueva(e.target.value as ClaveDatoAlumno)}
								className="rounded border border-slate-300 px-2 py-1 text-sm"
							>
								{CLAVES_DATO_ALUMNO.map((c) => (
									<option key={c.clave} value={c.clave}>
										{c.etiqueta}
									</option>
								))}
							</select>
						</label>
						<button
							type="button"
							onClick={() => void agregarCampo()}
							disabled={guardandoCampo || !pdf}
							className="rounded-xl bg-slate-200 px-4 py-2 text-sm font-semibold text-slate-800 hover:bg-slate-300 disabled:opacity-50"
						>
							{guardandoCampo ? "Guardando…" : "Agregar campo de texto"}
						</button>
					</div>
					<div className="flex flex-col gap-2 sm:flex-row">
						<button
							type="button"
							onClick={() => void descargarPdf()}
							disabled={exportando}
							className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-600 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
						>
							Descargar en PDF
						</button>
						<button
							type="button"
							onClick={() => void imprimir()}
							disabled={exportando}
							className="flex flex-1 items-center justify-center gap-2 rounded-xl bg-slate-600 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
						>
							Imprimir
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
