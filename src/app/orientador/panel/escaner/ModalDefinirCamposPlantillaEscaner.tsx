"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { PDFDocumentProxy } from "pdfjs-dist";
import {
	CLAVES_DATO_ALUMNO,
	etiquetaClave,
	type CampoPlantillaRelleno,
	type ClaveDatoAlumno,
} from "@/lib/orientador/plantilla-definicion-relleno";

function PaginaConCampos({
	pdf,
	pageIndex,
	campos,
	modoAgregar,
	seleccionId,
	onClickPagina,
	onSelectCampo,
	onEliminarCampo,
	onMoverCampo,
}: {
	pdf: PDFDocumentProxy;
	pageIndex: number;
	campos: CampoPlantillaRelleno[];
	modoAgregar: boolean;
	seleccionId: string | null;
	onClickPagina: (pageIndex: number, xPct: number, yPct: number) => void;
	onSelectCampo: (id: string | null) => void;
	onEliminarCampo: (id: string) => void;
	onMoverCampo: (id: string, xPct: number, yPct: number) => void;
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
			const scale = 1.1;
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

	return (
		<div className="flex shrink-0 flex-col items-center">
			<div
				ref={wrapRef}
				className="relative inline-block max-w-[min(100%,280px)] overflow-hidden rounded-lg border border-slate-200 bg-white shadow"
			>
				<canvas ref={canvasRef} className="block max-w-full" />
				<button
					type="button"
					className={`absolute inset-0 z-[1] ${modoAgregar ? "cursor-crosshair bg-emerald-500/10" : "pointer-events-none"}`}
					onClick={(e) => {
						if (!modoAgregar || !wrapRef.current) {
							return;
						}
						if ((e.target as HTMLElement).closest("[data-campo-pl]")) {
							return;
						}
						const r = wrapRef.current.getBoundingClientRect();
						onClickPagina(
							pageIndex,
							((e.clientX - r.left) / r.width) * 100,
							((e.clientY - r.top) / r.height) * 100,
						);
					}}
				/>
				{dePagina.map((c) => (
					<div
						key={c.id}
						data-campo-pl
						className={`absolute z-[2] max-w-[min(90%,12rem)] rounded border border-dashed border-emerald-600 bg-white/95 px-1 py-0.5 text-left shadow-sm ${
							seleccionId === c.id ? "ring-2 ring-emerald-500" : ""
						}`}
						style={{
							left: `${c.xPct}%`,
							top: `${c.yPct}%`,
							transform: "translate(-2px, -2px)",
						}}
						onClick={(ev) => {
							ev.stopPropagation();
							onSelectCampo(c.id);
						}}
					>
						<div
							className="mb-0.5 flex cursor-grab items-center gap-1 border-b border-slate-200 pb-0.5 text-[9px] text-slate-600 active:cursor-grabbing"
							onPointerDown={(ev) => iniciarArrastre(c, ev)}
						>
							<span aria-hidden>⋮⋮</span>
							<span>Mover</span>
						</div>
						<p className="text-[10px] font-semibold text-emerald-900">{etiquetaClave(c.clave)}</p>
						{seleccionId === c.id ? (
							<button
								type="button"
								className="mt-0.5 text-[10px] text-red-600 hover:underline"
								onClick={(ev) => {
									ev.stopPropagation();
									onEliminarCampo(c.id);
								}}
							>
								Eliminar
							</button>
						) : null}
					</div>
				))}
			</div>
		</div>
	);
}

type Props = {
	abierto: boolean;
	pdfBlob: Blob;
	nombreTitulo: string;
	onCerrar: () => void;
	onExito: (plantillaId: string) => void;
};

export default function ModalDefinirCamposPlantillaEscaner({
	abierto,
	pdfBlob,
	nombreTitulo,
	onCerrar,
	onExito,
}: Props) {
	const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
	const [numPages, setNumPages] = useState(0);
	const [cargando, setCargando] = useState(false);
	const [error, setError] = useState("");
	const [campos, setCampos] = useState<CampoPlantillaRelleno[]>([]);
	const [modoAgregar, setModoAgregar] = useState(false);
	const [claveNueva, setClaveNueva] = useState<ClaveDatoAlumno>("nombre_completo");
	const [seleccionId, setSeleccionId] = useState<string | null>(null);
	const [guardando, setGuardando] = useState(false);

	useEffect(() => {
		if (!abierto) {
			setPdf(null);
			setNumPages(0);
			setCampos([]);
			setModoAgregar(false);
			setSeleccionId(null);
			setError("");
			return;
		}

		let cancel = false;
		(async () => {
			setCargando(true);
			setError("");
			try {
				const buf = await pdfBlob.arrayBuffer();
				const pdfjs = await import("pdfjs-dist");
				if (typeof window !== "undefined") {
					pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdf.worker.min.mjs`;
				}
				const task = pdfjs.getDocument({ data: buf.slice(0) });
				const doc = await task.promise;
				if (cancel) {
					await doc.destroy().catch(() => undefined);
					return;
				}
				setPdf(doc);
				setNumPages(doc.numPages);
			} catch {
				if (!cancel) {
					setError("No se pudo cargar el PDF.");
				}
			} finally {
				if (!cancel) {
					setCargando(false);
				}
			}
		})();

		return () => {
			cancel = true;
		};
	}, [abierto, pdfBlob]);

	const onClickPagina = useCallback(
		(pageIndex: number, xPct: number, yPct: number) => {
			if (!modoAgregar) {
				return;
			}
			const id = crypto.randomUUID();
			setCampos((prev) => [
				...prev,
				{
					id,
					pageIndex,
					xPct,
					yPct,
					fontSizePt: 11,
					clave: claveNueva,
				},
			]);
			setModoAgregar(false);
			setSeleccionId(id);
		},
		[modoAgregar, claveNueva],
	);

	const onMoverCampo = useCallback((id: string, xPct: number, yPct: number) => {
		setCampos((prev) => prev.map((c) => (c.id === id ? { ...c, xPct, yPct } : c)));
	}, []);

	const crearPlantilla = useCallback(async () => {
		const titulo = nombreTitulo.trim();
		if (!titulo) {
			setError("Falta el nombre de la plantilla.");
			return;
		}
		setGuardando(true);
		setError("");
		try {
			const archivo = new File([pdfBlob], `${titulo.replace(/\s+/g, "_")}.pdf`, { type: "application/pdf" });
			const fd = new FormData();
			fd.append("archivo", archivo);
			fd.append("titulo", titulo);
			const res = await fetch("/api/orientador/plantillas", {
				method: "POST",
				body: fd,
				credentials: "include",
			});
			const j = (await res.json()) as { ok?: boolean; id?: string; error?: string };
			if (!res.ok || !j.id) {
				setError(j.error ?? "No se pudo crear la plantilla");
				return;
			}
			const def = { version: 1 as const, campos };
			const r2 = await fetch(`/api/orientador/plantillas/${j.id}/definicion-relleno`, {
				method: "PUT",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ definicion: def }),
			});
			const j2 = (await r2.json()) as { ok?: boolean; error?: string };
			if (!r2.ok) {
				setError(j2.error ?? "Plantilla creada pero no se guardaron los campos");
				return;
			}
			onExito(j.id);
			onCerrar();
		} catch {
			setError("Error de red al guardar.");
		} finally {
			setGuardando(false);
		}
	}, [nombreTitulo, pdfBlob, campos, onCerrar, onExito]);

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
				aria-labelledby="titulo-def-plantilla"
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
					<h2 id="titulo-def-plantilla" className="flex-1 text-center text-base font-bold text-slate-900">
						Verificar espacios para plantilla
					</h2>
					<span className="w-9" />
				</div>

				<div className="min-h-0 flex-1 overflow-x-auto overflow-y-auto p-4">
					{cargando ? (
						<p className="text-center text-sm text-slate-600">Cargando PDF…</p>
					) : error && !pdf ? (
						<p className="text-center text-sm text-red-600">{error}</p>
					) : pdf && numPages > 0 ? (
						<div className="flex flex-row flex-nowrap gap-4 pb-2">
							{Array.from({ length: numPages }, (_, i) => (
								<PaginaConCampos
									key={i}
									pdf={pdf}
									pageIndex={i}
									campos={campos}
									modoAgregar={modoAgregar}
									seleccionId={seleccionId}
									onClickPagina={onClickPagina}
									onSelectCampo={setSeleccionId}
									onEliminarCampo={(id) => {
										setCampos((prev) => prev.filter((c) => c.id !== id));
										setSeleccionId((s) => (s === id ? null : s));
									}}
									onMoverCampo={onMoverCampo}
								/>
							))}
						</div>
					) : null}
				</div>

				<div className="shrink-0 space-y-2 border-t border-slate-100 px-4 py-3">
					<div className="flex flex-wrap items-center gap-2">
						<label className="flex items-center gap-2 text-xs text-slate-600">
							Tipo de campo nuevo
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
					</div>
					<button
						type="button"
						onClick={() => setModoAgregar((m) => !m)}
						className={`w-full rounded-xl py-2.5 text-sm font-semibold ${
							modoAgregar ? "bg-emerald-600 text-white" : "bg-slate-200 text-slate-800"
						}`}
					>
						{modoAgregar ? "Toca la página para colocar el campo (cancelar: clic otra vez arriba)" : "Agregar campo de texto +"}
					</button>
					{error ? <p className="text-center text-sm text-red-600">{error}</p> : null}
					<button
						type="button"
						onClick={() => void crearPlantilla()}
						disabled={guardando || !pdf}
						className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-600 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
					>
						{guardando ? "Guardando…" : "Crear plantilla"}
						<span aria-hidden>📄</span>
					</button>
				</div>
			</div>
		</div>
	);
}
