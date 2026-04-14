"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
	CLAVES_DATO_ALUMNO,
	etiquetaClave,
	PLANTILLA_FUENTE_FAMILIA_CSS,
	PLANTILLA_FUENTE_PT_DEFECTO,
	type CampoPlantillaRelleno,
	type ClaveDatoAlumno,
} from "@/lib/orientador/plantilla-definicion-relleno";
import { mensajeCausaParaUsuario } from "@/lib/mensaje-red-amigable";
import { exportarPdfConAnotaciones } from "@/lib/orientador/plantillas-export-pdf";

const ZOOM_BASE_CAMPO = 1.35;

function PaginaRelleno({
	pdf,
	pageIndex,
	zoom,
	campos,
	valores,
	seleccionCampoId,
	onValor,
	onSelectCampo,
	onEliminarCampo,
	onMoverCampo,
}: {
	pdf: PDFDocumentProxy;
	pageIndex: number;
	zoom: number;
	campos: CampoPlantillaRelleno[];
	valores: Record<string, string>;
	seleccionCampoId: string | null;
	onValor: (id: string, v: string) => void;
	onSelectCampo: (id: string | null) => void;
	onEliminarCampo: (id: string) => void;
	onMoverCampo: (id: string, xPct: number, yPct: number) => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const wrapRef = useRef<HTMLDivElement>(null);

	useEffect(() => {
		let cancelled = false;
		let renderTask: { cancel: () => void; promise: Promise<void> } | null = null;
		const canvas = canvasRef.current;
		if (!canvas) {
			return;
		}
		(async () => {
			try {
				const page = await pdf.getPage(pageIndex + 1);
				if (cancelled) {
					return;
				}
				const ctx = canvas.getContext("2d");
				if (!ctx) {
					return;
				}
				const scale = zoom;
				const viewport = page.getViewport({ scale });
				canvas.width = viewport.width;
				canvas.height = viewport.height;
				if (cancelled) {
					return;
				}
				renderTask = page.render({ canvasContext: ctx, viewport });
				await renderTask.promise;
			} catch {
				/* render cancelado o canvas liberado */
			}
		})();
		return () => {
			cancelled = true;
			renderTask?.cancel();
		};
	}, [pdf, pageIndex, zoom]);

	const iniciarArrastre = useCallback(
		(c: CampoPlantillaRelleno, ev: React.PointerEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			onSelectCampo(c.id);
			const wrap = wrapRef.current;
			if (!wrap) {
				return;
			}
			const startX = ev.clientX;
			const startY = ev.clientY;
			const { xPct: ox, yPct: oy } = c;
			const onMove = (e: PointerEvent) => {
				const r = wrap.getBoundingClientRect();
				const dxPct = ((e.clientX - startX) / r.width) * 100;
				const dyPct = ((e.clientY - startY) / r.height) * 100;
				onMoverCampo(c.id, Math.min(100, Math.max(0, ox + dxPct)), Math.min(100, Math.max(0, oy + dyPct)));
			};
			const onUp = () => {
				window.removeEventListener("pointermove", onMove);
				window.removeEventListener("pointerup", onUp);
				window.removeEventListener("pointercancel", onUp);
			};
			window.addEventListener("pointermove", onMove);
			window.addEventListener("pointerup", onUp);
			window.addEventListener("pointercancel", onUp);
		},
		[onMoverCampo, onSelectCampo],
	);

	const dePagina = campos.filter((c) => c.pageIndex === pageIndex);

	return (
		<div className="flex shrink-0 flex-col items-center">
			<div
				ref={wrapRef}
				className="relative inline-block max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow"
			>
				<canvas ref={canvasRef} className="block max-w-full" />
				{dePagina.map((c) => {
					const fs = Math.max(6, Math.min(c.fontSizePt, 48));
					return (
						<div
							key={c.id}
							className={`absolute z-[2] flex max-w-[min(92%,18rem)] items-center gap-0.5 ${
								seleccionCampoId === c.id ? "rounded-sm ring-1 ring-violet-500/70" : ""
							}`}
							style={{
								left: `${c.xPct}%`,
								top: `${c.yPct}%`,
								transform: `scale(${ZOOM_BASE_CAMPO / zoom})`,
								transformOrigin: "top left",
							}}
							onClick={(e) => {
								e.stopPropagation();
								onSelectCampo(c.id);
							}}
						>
							<button
								type="button"
								className="shrink-0 cursor-grab touch-manipulation rounded p-0.5 text-slate-500 hover:bg-violet-200/40 active:cursor-grabbing"
								aria-label="Mover campo"
								title="Arrastrar"
								onPointerDown={(ev) => iniciarArrastre(c, ev)}
							>
								<span className="select-none text-[11px] leading-none" aria-hidden>
									⋮⋮
								</span>
							</button>
							<textarea
								value={valores[c.id] ?? ""}
								onChange={(e) => onValor(c.id, e.target.value)}
								rows={2}
								className="min-h-[2.25em] min-w-[6rem] flex-1 resize-none border-0 bg-transparent px-0.5 py-0 text-slate-900 shadow-none outline-none ring-0 placeholder:text-slate-400/90 focus:ring-0"
								style={{
									fontSize: `${fs}px`,
									lineHeight: 1.25,
									fontFamily: PLANTILLA_FUENTE_FAMILIA_CSS,
								}}
								placeholder={etiquetaClave(c.clave)}
								aria-label={etiquetaClave(c.clave)}
								autoComplete="off"
								onClick={(e) => {
									e.stopPropagation();
									onSelectCampo(c.id);
								}}
								onDoubleClick={(e) => {
									e.currentTarget.select();
								}}
							/>
							<button
								type="button"
								className="shrink-0 rounded p-0.5 text-red-600 hover:bg-red-50"
								onClick={(ev) => {
									ev.stopPropagation();
									onEliminarCampo(c.id);
								}}
								aria-label="Eliminar campo"
								title="Eliminar"
							>
								×
							</button>
						</div>
					);
				})}
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
	const [guardandoCambios, setGuardandoCambios] = useState(false);
	const [seleccionCampoId, setSeleccionCampoId] = useState<string | null>(null);
	const [zoom, setZoom] = useState(ZOOM_BASE_CAMPO);

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
			setSeleccionCampoId(null);
			setZoom(ZOOM_BASE_CAMPO);
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
				fontSizePt: PLANTILLA_FUENTE_PT_DEFECTO,
				clave: claveNueva,
			};
			const nuevaLista = [...campos, nuevo];
			await persistirDefinicion(nuevaLista);
			setCampos(nuevaLista);
			setValores((prev) => ({ ...prev, [id]: "" }));
			onDefinicionActualizada?.();
		} catch (e) {
			setError(mensajeCausaParaUsuario(e) || "Error al agregar campo");
		} finally {
			setGuardandoCampo(false);
		}
	}, [pdf, numPages, campos, claveNueva, persistirDefinicion, onDefinicionActualizada]);

	const moverCampo = useCallback((id: string, xPct: number, yPct: number) => {
		setCampos((prev) => prev.map((c) => (c.id === id ? { ...c, xPct, yPct } : c)));
	}, []);

	const eliminarCampo = useCallback(
		async (id: string) => {
			const nuevaLista = campos.filter((c) => c.id !== id);
			try {
				await persistirDefinicion(nuevaLista);
				setCampos(nuevaLista);
				setSeleccionCampoId((s) => (s === id ? null : s));
				onDefinicionActualizada?.();
			} catch (e) {
				setError(mensajeCausaParaUsuario(e) || "No se pudo eliminar el campo");
			}
		},
		[campos, onDefinicionActualizada, persistirDefinicion],
	);

	const guardarCambiosPlantilla = useCallback(async () => {
		setGuardandoCambios(true);
		setError("");
		try {
			await persistirDefinicion(campos);
			onDefinicionActualizada?.();
		} catch (e) {
			setError(mensajeCausaParaUsuario(e) || "No se pudo guardar");
		} finally {
			setGuardandoCambios(false);
		}
	}, [campos, onDefinicionActualizada, persistirDefinicion]);

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
				fondo: false,
				fontSizePt: c.fontSizePt,
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
				fondo: false,
				fontSizePt: c.fontSizePt,
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
					<button
						type="button"
						onClick={() => void guardarCambiosPlantilla()}
						disabled={guardandoCambios || !pdf}
						className="rounded-lg border border-emerald-600 bg-emerald-50 px-3 py-1 text-xs font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
					>
						{guardandoCambios ? "Guardando…" : "Guardar"}
					</button>
				</div>

				<div className="shrink-0 border-b border-slate-100 px-4 py-2">
					<div className="flex items-center justify-end gap-2 text-sm">
						<button
							type="button"
							onClick={() => setZoom((z) => Math.max(0.8, Number((z - 0.1).toFixed(2))))}
							className="rounded-lg border border-slate-300 px-2 py-1 hover:bg-slate-50"
						>
							-
						</button>
						<span className="min-w-[4rem] text-center font-semibold text-slate-700">{Math.round(zoom * 100)}%</span>
						<button
							type="button"
							onClick={() => setZoom((z) => Math.min(2.4, Number((z + 0.1).toFixed(2))))}
							className="rounded-lg border border-slate-300 px-2 py-1 hover:bg-slate-50"
						>
							+
						</button>
					</div>
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto p-4">
					{cargando ? (
						<p className="text-center text-sm text-slate-600">Cargando…</p>
					) : error && !pdf ? (
						<p className="text-center text-sm text-red-600">{error}</p>
					) : pdf && numPages > 0 ? (
						<div className="space-y-4">
							{Array.from({ length: numPages }, (_, i) => (
								<PaginaRelleno
									key={i}
									pdf={pdf}
									pageIndex={i}
									zoom={zoom}
									campos={campos}
									valores={valores}
									seleccionCampoId={seleccionCampoId}
									onValor={onValor}
									onSelectCampo={setSeleccionCampoId}
									onEliminarCampo={(id) => void eliminarCampo(id)}
									onMoverCampo={moverCampo}
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
							className="rounded-xl border border-[#3B82F6] bg-[#DBEAFE] px-4 py-2 text-sm font-semibold text-[#1D4ED8] hover:bg-[#BFDBFE] disabled:opacity-50"
						>
							{guardandoCampo ? "Guardando…" : "Agregar campo de texto"}
						</button>
						<button
							type="button"
							onClick={() => void guardarCambiosPlantilla()}
							disabled={guardandoCampo || guardandoCambios || !pdf}
							className="rounded-xl border border-emerald-600 bg-emerald-50 px-4 py-2 text-sm font-semibold text-emerald-800 hover:bg-emerald-100 disabled:opacity-50"
						>
							{guardandoCambios ? "Guardando…" : "Guardar"}
						</button>
					</div>
					<div className="flex flex-col gap-2 sm:flex-row">
						<button
							type="button"
							onClick={() => void descargarPdf()}
							disabled={exportando}
							className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#3B82F6] bg-[#DBEAFE] py-3 text-sm font-semibold text-[#1D4ED8] hover:bg-[#BFDBFE] disabled:opacity-50"
						>
							Descargar en PDF
						</button>
						<button
							type="button"
							onClick={() => void imprimir()}
							disabled={exportando}
							className="flex flex-1 items-center justify-center gap-2 rounded-xl border border-[#7C3AED] bg-[#EDE9FE] py-3 text-sm font-semibold text-[#5B21B6] hover:bg-[#DDD6FE] disabled:opacity-50"
						>
							Imprimir
						</button>
					</div>
				</div>
			</div>
		</div>
	);
}
