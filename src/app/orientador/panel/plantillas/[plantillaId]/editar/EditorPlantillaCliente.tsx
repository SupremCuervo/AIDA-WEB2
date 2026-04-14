"use client";

import Link from "next/link";
import { useParams, useRouter, useSearchParams } from "next/navigation";
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
import { IconoDocumento } from "@/app/alumno/aida-iconos";
import { exportarPdfConAnotaciones } from "@/lib/orientador/plantillas-export-pdf";

const COLORES = {
	azul: "#1d4ed8",
	negro: "#0f172a",
	rojo: "#dc2626",
} as const;

type ColorKey = keyof typeof COLORES;

export type AnotacionUi = {
	id: string;
	pageIndex: number;
	xPct: number;
	yPct: number;
	text: string;
	colorHex: string;
	fondo: boolean;
	/** Mismo tamaño que en el PDF (Helvetica); coincide con exportarPdfConAnotaciones. */
	fontSizePt: number;
};

function PaginaPdf({
	pdf,
	pageIndex,
	modoColocar,
	modoEditor,
	anotaciones,
	camposRelleno,
	seleccionadaId,
	seleccionadaCampoId,
	onPageClick,
	onSelect,
	onChangeTexto,
	onEliminar,
	onMoverAnotacion,
	onSelectCampo,
	onEliminarCampo,
}: {
	pdf: PDFDocumentProxy;
	pageIndex: number;
	modoColocar: boolean;
	modoEditor: "anotaciones" | "campos";
	anotaciones: AnotacionUi[];
	camposRelleno: CampoPlantillaRelleno[];
	seleccionadaId: string | null;
	seleccionadaCampoId: string | null;
	onPageClick: (pageIndex: number, xPct: number, yPct: number) => void;
	onSelect: (id: string | null) => void;
	onChangeTexto: (id: string, texto: string) => void;
	onEliminar: (id: string) => void;
	onMoverAnotacion: (id: string, xPct: number, yPct: number) => void;
	onSelectCampo: (id: string | null) => void;
	onEliminarCampo: (id: string) => void;
}) {
	const canvasRef = useRef<HTMLCanvasElement>(null);
	const wrapRef = useRef<HTMLDivElement>(null);
	const [previewPos, setPreviewPos] = useState<{ xPct: number; yPct: number } | null>(null);

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
				const scale = 1.35;
				const viewport = page.getViewport({ scale });
				canvas.width = viewport.width;
				canvas.height = viewport.height;
				if (cancelled) {
					return;
				}
				renderTask = page.render({
					canvasContext: ctx,
					viewport,
				});
				await renderTask.promise;
			} catch {
				/* render cancelado o canvas liberado */
			}
		})();
		return () => {
			cancelled = true;
			renderTask?.cancel();
		};
	}, [pdf, pageIndex]);

	useEffect(() => {
		if (!modoColocar) {
			setPreviewPos(null);
		}
	}, [modoColocar]);

	const iniciarArrastreAnotacion = useCallback(
		(a: AnotacionUi, ev: React.PointerEvent) => {
			ev.preventDefault();
			ev.stopPropagation();
			onSelect(a.id);
			const wrap = wrapRef.current;
			if (!wrap) {
				return;
			}
			const startX = ev.clientX;
			const startY = ev.clientY;
			const { xPct: origXPct, yPct: origYPct } = a;
			const onMove = (e: PointerEvent) => {
				const r = wrap.getBoundingClientRect();
				const dxPct = ((e.clientX - startX) / r.width) * 100;
				const dyPct = ((e.clientY - startY) / r.height) * 100;
				let nx = origXPct + dxPct;
				let ny = origYPct + dyPct;
				nx = Math.max(0, Math.min(100, nx));
				ny = Math.max(0, Math.min(100, ny));
				onMoverAnotacion(a.id, nx, ny);
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
		[onMoverAnotacion, onSelect],
	);

	const deEstaPagina = anotaciones.filter((a) => a.pageIndex === pageIndex);
	const camposDePagina = camposRelleno.filter((c) => c.pageIndex === pageIndex);

	return (
		<div className="mb-6 flex justify-center">
			<div
				ref={wrapRef}
				className="relative inline-block max-w-full overflow-hidden rounded-lg border border-slate-200 bg-white shadow-md"
			>
				<canvas ref={canvasRef} className="block max-w-full" />
				<div
					className={`absolute inset-0 z-[1] ${modoColocar ? "cursor-crosshair bg-sky-500/[0.07]" : "pointer-events-none"}`}
					onMouseMove={(e) => {
						if (!modoColocar || modoEditor !== "anotaciones" || !wrapRef.current) {
							return;
						}
						const r = wrapRef.current.getBoundingClientRect();
						setPreviewPos({
							xPct: ((e.clientX - r.left) / r.width) * 100,
							yPct: ((e.clientY - r.top) / r.height) * 100,
						});
					}}
					onMouseLeave={() => setPreviewPos(null)}
					onClick={(e) => {
						if (!modoColocar || !wrapRef.current) {
							return;
						}
						if ((e.target as HTMLElement).closest("[data-anotacion]")) {
							return;
						}
						if ((e.target as HTMLElement).closest("[data-campo-relleno]")) {
							return;
						}
						const r = wrapRef.current.getBoundingClientRect();
						const xPct = ((e.clientX - r.left) / r.width) * 100;
						const yPct = ((e.clientY - r.top) / r.height) * 100;
						onPageClick(pageIndex, xPct, yPct);
					}}
				/>
				{modoColocar && modoEditor === "anotaciones" && previewPos ? (
					<div
						className="pointer-events-none absolute z-[2] min-h-[4.5rem] w-[min(90%,18rem)] min-w-[6rem] rounded border-2 border-dashed border-sky-500 bg-sky-400/15 shadow-sm ring-1 ring-sky-400/40"
						style={{
							left: `${previewPos.xPct}%`,
							top: `${previewPos.yPct}%`,
							transform: "translate(-2px, -2px)",
						}}
						aria-hidden
					/>
				) : null}
				{modoEditor === "campos"
					? camposDePagina.map((c) => (
							<div
								key={c.id}
								data-campo-relleno
								className={`absolute max-w-[min(92%,20rem)] rounded border border-dashed px-1 py-0.5 shadow-sm ${
									seleccionadaCampoId === c.id
										? "border-emerald-600 bg-emerald-50/95 ring-2 ring-emerald-500"
										: "border-emerald-400/80 bg-white/90"
								} ${modoColocar ? "pointer-events-none" : "pointer-events-auto"}`}
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
								<p className="text-[10px] font-semibold uppercase text-emerald-800">
									{etiquetaClave(c.clave)}
								</p>
								<p className="text-[9px] text-slate-500">{c.fontSizePt} pt</p>
								{seleccionadaCampoId === c.id ? (
									<button
										type="button"
										className="mt-0.5 text-[10px] font-medium text-red-600 hover:underline"
										onClick={(ev) => {
											ev.stopPropagation();
											onEliminarCampo(c.id);
										}}
									>
										Quitar
									</button>
								) : null}
							</div>
						))
					: null}
				{modoEditor === "anotaciones"
					? deEstaPagina.map((a) => {
							const fs = Math.max(6, Math.min(a.fontSizePt ?? PLANTILLA_FUENTE_PT_DEFECTO, 48));
							return (
								<div
									key={a.id}
									data-anotacion
									className={`absolute z-[3] inline-block max-w-[min(90%,18rem)] min-w-[6rem] rounded border shadow-sm ${
										seleccionadaId === a.id ? "ring-2 ring-sky-500" : "ring-0"
									} ${modoColocar ? "pointer-events-none" : "pointer-events-auto"} ${
										a.fondo ? "border-slate-300 bg-white/95" : "border-transparent"
									}`}
									style={{
										left: `${a.xPct}%`,
										top: `${a.yPct}%`,
										transform: "translate(-2px, -2px)",
									}}
									onClick={(ev) => {
										ev.stopPropagation();
										onSelect(a.id);
									}}
								>
									<div className="relative">
										{!modoColocar ? (
											<button
												type="button"
												className="absolute right-full top-0 mr-0.5 flex w-5 shrink-0 cursor-grab items-center justify-center rounded border border-slate-200 bg-slate-100/95 text-slate-500 active:cursor-grabbing"
												title="Arrastrar"
												aria-label="Arrastrar anotación"
												style={{
													fontSize: `${Math.max(9, fs * 0.85)}px`,
													height: `${fs * 1.25}px`,
												}}
												onPointerDown={(ev) => iniciarArrastreAnotacion(a, ev)}
											>
												<span className="select-none leading-none" aria-hidden>
													⋮⋮
												</span>
											</button>
										) : null}
										<textarea
											value={a.text}
											onChange={(ev) => onChangeTexto(a.id, ev.target.value)}
											rows={3}
											className="w-full min-w-[6rem] resize-y border-0 bg-transparent px-0.5 py-0 outline-none placeholder:text-slate-400"
											style={{
												color: a.colorHex,
												fontSize: `${fs}px`,
												lineHeight: 1.25,
												fontFamily: PLANTILLA_FUENTE_FAMILIA_CSS,
											}}
											placeholder="Escribe aquí…"
											onClick={(ev) => {
												ev.stopPropagation();
												onSelect(a.id);
											}}
										/>
										{seleccionadaId === a.id ? (
											<button
												type="button"
												className="mt-0.5 text-[10px] font-medium text-red-600 hover:underline"
												onClick={(ev) => {
													ev.stopPropagation();
													onEliminar(a.id);
												}}
											>
												Quitar cuadro
											</button>
										) : null}
									</div>
								</div>
							);
						})
					: null}
			</div>
		</div>
	);
}

export default function EditorPlantillaCliente() {
	const params = useParams();
	const router = useRouter();
	const searchParams = useSearchParams();
	const modoWizard = searchParams.get("wizard") === "1";
	const modoUsar = searchParams.get("usar") === "1";
	const plantillaId = typeof params.plantillaId === "string" ? params.plantillaId : "";

	const [titulo, setTitulo] = useState("");
	const [cargando, setCargando] = useState(true);
	const [error, setError] = useState("");
	const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null);
	const [numPages, setNumPages] = useState(0);

	const [modoColocar, setModoColocar] = useState(false);
	const [modoEditor, setModoEditor] = useState<"anotaciones" | "campos">("anotaciones");
	const [colorActual, setColorActual] = useState<ColorKey>("negro");
	const [fondoActual, setFondoActual] = useState(true);
	const [anotaciones, setAnotaciones] = useState<AnotacionUi[]>([]);
	const [camposRelleno, setCamposRelleno] = useState<CampoPlantillaRelleno[]>([]);
	const [seleccionadaId, setSeleccionadaId] = useState<string | null>(null);
	const [seleccionadaCampoId, setSeleccionadaCampoId] = useState<string | null>(null);
	const [exportando, setExportando] = useState(false);
	const [guardandoDef, setGuardandoDef] = useState(false);
	const [msgDef, setMsgDef] = useState("");
	const [padronIdDescarga, setPadronIdDescarga] = useState("");
	const [descargandoRelleno, setDescargandoRelleno] = useState(false);
	/** usar=1: manual = anotaciones y texto a mano; datos = relleno desde padrón; ocr = reservado */
	const [modoEntradaExpediente, setModoEntradaExpediente] = useState<"manual" | "datos" | "ocr">("datos");

	const pdfBytesRef = useRef<ArrayBuffer | null>(null);

	const cargarPdf = useCallback(async () => {
		if (!plantillaId) {
			return;
		}
		setCargando(true);
		setError("");
		try {
			const res = await fetch(`/api/orientador/plantillas/${plantillaId}/pdf`, {
				credentials: "include",
			});
			if (res.status === 401) {
				router.replace("/orientador");
				return;
			}
			if (!res.ok) {
				const d = (await res.json()) as { error?: string };
				setError(d.error ?? "No se pudo cargar el PDF");
				setPdf(null);
				setNumPages(0);
				return;
			}
			const buf = await res.arrayBuffer();
			pdfBytesRef.current = buf.slice(0);

			const pdfjs = await import("pdfjs-dist");
			if (typeof window !== "undefined") {
				pdfjs.GlobalWorkerOptions.workerSrc = `${window.location.origin}/pdf.worker.min.mjs`;
			}

			const task = pdfjs.getDocument({ data: buf });
			const doc = await task.promise;
			setPdf(doc);
			setNumPages(doc.numPages);

			const head = await fetch(`/api/orientador/plantillas`, { credentials: "include" });
			if (head.ok) {
				const j = (await head.json()) as {
					plantillas?: { id: string; titulo: string }[];
				};
				const hit = j.plantillas?.find((p) => p.id === plantillaId);
				if (hit?.titulo) {
					setTitulo(hit.titulo);
				}
			}

			const rd = await fetch(`/api/orientador/plantillas/${plantillaId}/definicion-relleno`, {
				credentials: "include",
			});
			if (rd.ok) {
				const jd = (await rd.json()) as {
					definicion?: { campos?: CampoPlantillaRelleno[] };
				};
				setCamposRelleno(jd.definicion?.campos ?? []);
			} else {
				setCamposRelleno([]);
			}
		} catch {
			setError("Error de red al cargar el PDF");
			setPdf(null);
		} finally {
			setCargando(false);
		}
	}, [plantillaId, router]);

	useEffect(() => {
		void cargarPdf();
	}, [cargarPdf]);

	useEffect(() => {
		if (modoWizard) {
			setModoEditor("campos");
			setSeleccionadaId(null);
		} else if (modoUsar) {
			if (modoEntradaExpediente === "manual") {
				setModoEditor("anotaciones");
				setSeleccionadaCampoId(null);
			} else {
				setModoEditor("campos");
				setSeleccionadaId(null);
			}
		}
	}, [modoWizard, modoUsar, modoEntradaExpediente]);

	const moverAnotacion = useCallback((id: string, xPct: number, yPct: number) => {
		setAnotaciones((prev) => prev.map((a) => (a.id === id ? { ...a, xPct, yPct } : a)));
	}, []);

	const agregarAnotacion = useCallback(
		(pageIndex: number, xPct: number, yPct: number) => {
			const id =
				typeof crypto !== "undefined" && crypto.randomUUID
					? crypto.randomUUID()
					: `a-${Date.now()}`;
			const nueva: AnotacionUi = {
				id,
				pageIndex,
				xPct,
				yPct,
				text: "",
				colorHex: COLORES[colorActual],
				fondo: fondoActual,
				fontSizePt: PLANTILLA_FUENTE_PT_DEFECTO,
			};
			setAnotaciones((prev) => [...prev, nueva]);
			setSeleccionadaId(id);
			setModoColocar(false);
		},
		[colorActual, fondoActual],
	);

	const agregarCampoRelleno = useCallback((pageIndex: number, xPct: number, yPct: number) => {
		const id =
			typeof crypto !== "undefined" && crypto.randomUUID
				? crypto.randomUUID()
				: `c-${Date.now()}`;
		const nuevo: CampoPlantillaRelleno = {
			id,
			pageIndex,
			xPct,
			yPct,
			fontSizePt: PLANTILLA_FUENTE_PT_DEFECTO,
			clave: "nombre_completo",
		};
		setCamposRelleno((prev) => [...prev, nuevo]);
		setSeleccionadaCampoId(id);
		setModoColocar(false);
	}, []);

	const guardarDefinicionRelleno = useCallback(async (): Promise<boolean> => {
		if (!plantillaId) {
			return false;
		}
		setGuardandoDef(true);
		setMsgDef("");
		try {
			const res = await fetch(`/api/orientador/plantillas/${plantillaId}/definicion-relleno`, {
				method: "PUT",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({
					definicion: { version: 1, campos: camposRelleno },
				}),
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setMsgDef(d.error ?? "No se pudo guardar");
				return false;
			}
			setMsgDef("Zonas guardadas en el servidor.");
			return true;
		} catch {
			setMsgDef("Error de red");
			return false;
		} finally {
			setGuardandoDef(false);
		}
	}, [plantillaId, camposRelleno]);

	const finalizarWizardCrearPlantilla = useCallback(async () => {
		const ok = await guardarDefinicionRelleno();
		if (ok) {
			router.push("/orientador/panel?seccion=plantillas");
		}
	}, [guardarDefinicionRelleno, router]);

	const descargarPdfRelleno = useCallback(async () => {
		const pid = padronIdDescarga.trim();
		if (!plantillaId || !pid) {
			setMsgDef("Indica el UUID del alumno en padrón (padronId).");
			return;
		}
		setDescargandoRelleno(true);
		setMsgDef("");
		try {
			const res = await fetch(
				`/api/orientador/plantillas/${plantillaId}/rellenar?padronId=${encodeURIComponent(pid)}`,
				{ credentials: "include" },
			);
			if (!res.ok) {
				const d = (await res.json()) as { error?: string };
				setMsgDef(d.error ?? "No se pudo generar");
				return;
			}
			const blob = await res.blob();
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${titulo || "plantilla"}_relleno.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			setMsgDef("Error de red al descargar");
		} finally {
			setDescargandoRelleno(false);
		}
	}, [plantillaId, padronIdDescarga, titulo]);

	const aplicarColorA = useCallback(
		(c: ColorKey) => {
			setColorActual(c);
			const hex = COLORES[c];
			if (seleccionadaId) {
				setAnotaciones((prev) =>
					prev.map((a) => (a.id === seleccionadaId ? { ...a, colorHex: hex } : a)),
				);
			}
		},
		[seleccionadaId],
	);

	const aplicarFondo = useCallback(
		(v: boolean) => {
			setFondoActual(v);
			if (seleccionadaId) {
				setAnotaciones((prev) =>
					prev.map((a) => (a.id === seleccionadaId ? { ...a, fondo: v } : a)),
				);
			}
		},
		[seleccionadaId],
	);

	const descargarPdf = useCallback(async () => {
		const raw = pdfBytesRef.current;
		if (!raw) {
			return;
		}
		setExportando(true);
		try {
			const out = await exportarPdfConAnotaciones(
				raw.slice(0),
				anotaciones.map((a) => ({
					pageIndex: a.pageIndex,
					xPct: a.xPct,
					yPct: a.yPct,
					text: a.text,
					colorHex: a.colorHex,
					fondo: a.fondo,
					fontSizePt: a.fontSizePt ?? PLANTILLA_FUENTE_PT_DEFECTO,
				})),
			);
			const blob = new Blob([out], { type: "application/pdf" });
			const url = URL.createObjectURL(blob);
			const a = document.createElement("a");
			a.href = url;
			a.download = `${titulo || "plantilla"}_editado.pdf`;
			a.click();
			URL.revokeObjectURL(url);
		} catch {
			setError("No se pudo generar el PDF. Revisa la consola.");
		} finally {
			setExportando(false);
		}
	}, [anotaciones, titulo]);

	const tituloCabecera = modoWizard
		? "Verificar espacios para Plantilla"
		: modoUsar
			? `Expediente · ${titulo || "Plantilla"}`
			: `Muro de plantillas${titulo ? ` · ${titulo}` : ""}`;

	return (
		<div
			className={`min-h-screen bg-slate-100 print:bg-white print:pb-0 ${modoWizard ? "pb-32" : "pb-16"}`}
		>
			<div className="border-b border-slate-200 bg-white px-4 py-3 print:hidden">
				<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2">
					<Link
						href="/orientador/panel?seccion=plantillas"
						className="text-sm font-medium text-emerald-800 hover:underline"
					>
						← Volver al panel
					</Link>
					<p className="text-center text-sm font-semibold text-slate-800">{tituloCabecera}</p>
					<p className="max-w-xl text-[11px] text-slate-500">
						{modoWizard ? (
							<>
								Coloca los <strong>campos de texto</strong> (nombre, grado, etc.) y pulsa{" "}
								<strong>Crear plantilla</strong> al final.
							</>
						) : modoUsar ? (
							<>
								Elige cómo rellenar: <strong>manual</strong>, <strong>datos del alumno</strong> (padrón) u{" "}
								<strong>OCR</strong> (en preparación).
							</>
						) : (
							<>
								Anotaciones: solo en tu descarga local. <strong>Campos de datos</strong>: se guardan en el servidor
								(zonas para rellenar con nombre, grado, grupo, etc.).
							</>
						)}
					</p>
				</div>
			</div>

			{modoUsar ? (
				<div className="border-b border-violet-200 bg-violet-50/90 px-4 py-3 print:hidden">
					<div className="mx-auto flex max-w-6xl flex-wrap items-center justify-center gap-2">
						<span className="text-xs font-medium text-violet-900">Relleno:</span>
						<button
							type="button"
							onClick={() => setModoEntradaExpediente("manual")}
							className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
								modoEntradaExpediente === "manual"
									? "border-violet-700 bg-violet-700 text-white"
									: "border-violet-300 bg-white text-violet-900"
							}`}
						>
							Manual
						</button>
						<button
							type="button"
							onClick={() => setModoEntradaExpediente("datos")}
							className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
								modoEntradaExpediente === "datos"
									? "border-violet-700 bg-violet-700 text-white"
									: "border-violet-300 bg-white text-violet-900"
							}`}
						>
							Automático (datos alumno)
						</button>
						<button
							type="button"
							disabled
							title="Próximamente: OCR sobre documento escaneado"
							className="cursor-not-allowed rounded-lg border border-slate-200 bg-slate-100 px-3 py-1.5 text-xs font-medium text-slate-500"
						>
							OCR (próximamente)
						</button>
					</div>
					{modoEntradaExpediente === "manual" ? (
						<p className="mx-auto mt-2 max-w-2xl text-center text-[11px] text-violet-900/90">
							Usa <strong>Anotaciones manuales</strong> en la barra lateral para escribir sobre el PDF y descarga el
							resultado.
						</p>
					) : modoEntradaExpediente === "datos" ? (
						<p className="mx-auto mt-2 max-w-2xl text-center text-[11px] text-violet-900/90">
							Indica el <strong>UUID del padrón</strong> del alumno y descarga el PDF con los campos definidos en la
							plantilla.
						</p>
					) : (
						<p className="mx-auto mt-2 max-w-2xl text-center text-[11px] text-slate-600">
							El OCR automático se integrará cuando el pipeline esté listo.
						</p>
					)}
				</div>
			) : null}

			{cargando ? (
				<p className="mt-10 text-center text-slate-600">Cargando PDF…</p>
			) : error ? (
				<p className="mt-10 text-center text-red-600">{error}</p>
			) : pdf && numPages > 0 ? (
				<div className="mx-auto flex max-w-[1400px] flex-col gap-4 px-3 pt-6 lg:flex-row lg:items-start lg:gap-6 lg:px-6">
					<div className="min-w-0 flex-1 print:w-full">
						<div className="mb-4 flex flex-wrap items-center justify-center gap-2 print:hidden">
							{modoWizard ? (
								<p className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-2 text-xs font-medium text-emerald-900">
									Modo: <strong>Campos de texto</strong> — pulsa + y coloca cada zona en el PDF.
								</p>
							) : (
								<>
									<button
										type="button"
										onClick={() => {
											setModoEditor("anotaciones");
											setSeleccionadaCampoId(null);
										}}
										className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
											modoEditor === "anotaciones"
												? "border-sky-600 bg-sky-600 text-white"
												: "border-slate-300 bg-white text-slate-700"
										}`}
									>
										Anotaciones manuales
									</button>
									<button
										type="button"
										onClick={() => {
											setModoEditor("campos");
											setSeleccionadaId(null);
										}}
										className={`rounded-lg border px-3 py-1.5 text-xs font-medium ${
											modoEditor === "campos"
												? "border-emerald-600 bg-emerald-600 text-white"
												: "border-slate-300 bg-white text-slate-700"
										}`}
									>
										Campos alumno (relleno automático)
									</button>
								</>
							)}
						</div>
						<p className="mb-4 text-center text-xs text-slate-500 print:hidden">
							{modoEditor === "anotaciones" ? (
								<>
									Pulsa <strong>+</strong> y verás un <strong>cuadro de vista previa</strong> al mover el ratón;
									haz clic para colocar. Usa la barra <strong>Mover</strong> (⋮⋮) para arrastrar un cuadro ya
									puesto.
								</>
							) : (
								<>
									Pulsa <strong>+</strong> y haz clic donde debe ir cada dato (nombre, grado…). Luego guarda las
									zonas.
								</>
							)}
						</p>
						<div className="space-y-2">
							{Array.from({ length: numPages }, (_, i) => i).map((pageIndex) => (
								<PaginaPdf
									key={pageIndex}
									pdf={pdf}
									pageIndex={pageIndex}
									modoColocar={modoColocar}
									modoEditor={modoEditor}
									anotaciones={anotaciones}
									camposRelleno={camposRelleno}
									seleccionadaId={seleccionadaId}
									seleccionadaCampoId={seleccionadaCampoId}
									onPageClick={(pi, x, y) => {
										if (modoEditor === "campos") {
											agregarCampoRelleno(pi, x, y);
										} else {
											agregarAnotacion(pi, x, y);
										}
									}}
									onSelect={setSeleccionadaId}
									onChangeTexto={(id, texto) =>
										setAnotaciones((prev) =>
											prev.map((a) => (a.id === id ? { ...a, text: texto } : a)),
										)
									}
									onEliminar={(id) => {
										setAnotaciones((prev) => prev.filter((a) => a.id !== id));
										setSeleccionadaId((s) => (s === id ? null : s));
									}}
									onMoverAnotacion={moverAnotacion}
									onSelectCampo={setSeleccionadaCampoId}
									onEliminarCampo={(id) => {
										setCamposRelleno((prev) => prev.filter((c) => c.id !== id));
										setSeleccionadaCampoId((s) => (s === id ? null : s));
									}}
								/>
							))}
						</div>
					</div>

					<aside className="mx-auto flex w-full max-w-[14rem] shrink-0 flex-col items-stretch gap-3 rounded-2xl border border-slate-200 bg-white p-4 shadow-sm print:hidden lg:sticky lg:top-4 lg:mx-0">
						<p className="text-center text-[11px] font-semibold uppercase tracking-wide text-slate-500">
							Herramientas
						</p>

						<button
							type="button"
							onClick={() => setModoColocar((m) => !m)}
							className={`flex h-12 w-full items-center justify-center rounded-xl border-2 text-2xl font-bold transition ${
								modoColocar
									? modoEditor === "campos"
										? "border-emerald-600 bg-emerald-600 text-white"
										: "border-sky-600 bg-sky-600 text-white"
									: "border-slate-300 bg-slate-50 text-slate-700 hover:bg-slate-100"
							}`}
							title="Colocar en el PDF"
						>
							+
						</button>
						<p className="text-center text-[10px] text-slate-500">
							{modoColocar ? "Clic en el PDF para colocar" : "Activa + y luego coloca"}
						</p>

						{modoEditor === "campos" && seleccionadaCampoId ? (
							<div className="border-t border-slate-100 pt-3">
								<p className="mb-2 text-center text-[10px] font-medium text-slate-600">
									Campo seleccionado
								</p>
								<label htmlFor="clave-campo" className="sr-only">
									Dato del alumno
								</label>
								<select
									id="clave-campo"
									value={camposRelleno.find((c) => c.id === seleccionadaCampoId)?.clave ?? "nombre_completo"}
									onChange={(e) => {
										const clave = e.target.value as ClaveDatoAlumno;
										setCamposRelleno((prev) =>
											prev.map((c) => (c.id === seleccionadaCampoId ? { ...c, clave } : c)),
										);
									}}
									className="w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
								>
									{CLAVES_DATO_ALUMNO.map((o) => (
										<option key={o.clave} value={o.clave}>
											{o.etiqueta}
										</option>
									))}
								</select>
								<label htmlFor="tam-campo" className="mt-2 block text-center text-[10px] text-slate-600">
									Tamaño fuente (pt)
								</label>
								<input
									id="tam-campo"
									type="number"
									min={6}
									max={48}
									value={
										camposRelleno.find((c) => c.id === seleccionadaCampoId)?.fontSizePt ??
										PLANTILLA_FUENTE_PT_DEFECTO
									}
									onChange={(e) => {
										const n = Number.parseInt(e.target.value, 10);
										if (!Number.isFinite(n)) {
											return;
										}
										const v = Math.min(48, Math.max(6, n));
										setCamposRelleno((prev) =>
											prev.map((c) => (c.id === seleccionadaCampoId ? { ...c, fontSizePt: v } : c)),
										);
									}}
									className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
								/>
							</div>
						) : null}

						<div className={`border-t border-slate-100 pt-3 ${modoEditor === "anotaciones" ? "" : "opacity-40"}`}>
							<p className="mb-2 text-center text-[10px] font-medium text-slate-600">
								Color de letra
							</p>
							<div className="flex flex-col gap-2">
								{(Object.keys(COLORES) as ColorKey[]).map((k) => (
									<button
										key={k}
										type="button"
										disabled={modoEditor !== "anotaciones"}
										onClick={() => aplicarColorA(k)}
										className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-left text-sm font-medium capitalize ${
											colorActual === k
												? "border-slate-800 bg-slate-100"
												: "border-slate-200 hover:bg-slate-50"
										}`}
									>
										<span
											className="h-4 w-4 rounded-full border border-slate-300"
											style={{ backgroundColor: COLORES[k] }}
										/>
										{k === "azul" ? "Azul" : k === "rojo" ? "Rojo" : "Negro"}
									</button>
								))}
							</div>
						</div>

						{seleccionadaId && modoEditor === "anotaciones" ? (
							<div className="border-t border-slate-100 pt-3">
								<label htmlFor="tam-anotacion" className="mb-1 block text-center text-[10px] font-medium text-slate-600">
									Tamaño fuente anotación (pt) — igual que en PDF
								</label>
								<input
									id="tam-anotacion"
									type="number"
									min={6}
									max={48}
									value={
										anotaciones.find((x) => x.id === seleccionadaId)?.fontSizePt ??
										PLANTILLA_FUENTE_PT_DEFECTO
									}
									onChange={(e) => {
										const n = Number.parseInt(e.target.value, 10);
										if (!Number.isFinite(n)) {
											return;
										}
										const v = Math.min(48, Math.max(6, n));
										setAnotaciones((prev) =>
											prev.map((x) => (x.id === seleccionadaId ? { ...x, fontSizePt: v } : x)),
										);
									}}
									className="w-full rounded-lg border border-slate-300 px-2 py-1.5 text-sm"
								/>
							</div>
						) : null}

						<div
							className={`border-t border-slate-100 pt-3 ${modoEditor === "anotaciones" ? "" : "opacity-40"}`}
						>
							<p className="mb-2 text-center text-[10px] font-medium text-slate-600">
								Fondo del cuadro
							</p>
							<div className="flex flex-col gap-2">
								<button
									type="button"
									disabled={modoEditor !== "anotaciones"}
									onClick={() => aplicarFondo(true)}
									className={`rounded-lg border px-3 py-2 text-sm ${
										fondoActual ? "border-emerald-600 bg-emerald-50" : "border-slate-200"
									}`}
								>
									Con fondo blanco
								</button>
								<button
									type="button"
									disabled={modoEditor !== "anotaciones"}
									onClick={() => aplicarFondo(false)}
									className={`rounded-lg border px-3 py-2 text-sm ${
										!fondoActual ? "border-emerald-600 bg-emerald-50" : "border-slate-200"
									}`}
								>
									Sin fondo
								</button>
							</div>
						</div>

						{modoEditor === "campos" && !modoWizard ? (
							<div className="border-t border-emerald-100 pt-3">
								<p className="mb-2 text-center text-[10px] font-semibold uppercase text-emerald-800">
									Relleno automático
								</p>
								<button
									type="button"
									disabled={guardandoDef}
									onClick={() => void guardarDefinicionRelleno()}
									className="w-full rounded-lg border border-emerald-700 bg-emerald-50 py-2 text-sm font-medium text-emerald-900 hover:bg-emerald-100 disabled:opacity-50"
								>
									{guardandoDef ? "Guardando…" : "Guardar zonas en servidor"}
								</button>
								{(!modoUsar || modoEntradaExpediente === "datos") ? (
									<>
										<label htmlFor="padron-relleno" className="mt-3 block text-[10px] text-slate-600">
											UUID padrón del alumno
										</label>
										<input
											id="padron-relleno"
											type="text"
											value={padronIdDescarga}
											onChange={(e) => setPadronIdDescarga(e.target.value.trim())}
											placeholder="ej. copiar desde el grupo"
											className="mt-1 w-full rounded border border-slate-300 px-2 py-1.5 font-mono text-xs"
										/>
										<button
											type="button"
											disabled={descargandoRelleno}
											onClick={() => void descargarPdfRelleno()}
											className="mt-2 w-full rounded-lg border border-slate-400 bg-white py-2 text-sm font-medium text-slate-800 hover:bg-slate-50 disabled:opacity-50"
										>
											{descargandoRelleno ? "Generando…" : "Descargar PDF con datos"}
										</button>
									</>
								) : (
									<p className="mt-2 text-[10px] text-slate-600">
										Usa <strong>Descargar PDF</strong> abajo con las anotaciones que escribiste.
									</p>
								)}
								{msgDef ? (
									<p className="mt-2 text-center text-[10px] text-slate-600">{msgDef}</p>
								) : null}
							</div>
						) : null}

						<div className="border-t border-slate-100 pt-3">
							<button
								type="button"
								disabled={exportando}
								onClick={() => void descargarPdf()}
								className="w-full rounded-lg border border-emerald-700 bg-emerald-700 py-2.5 text-sm font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
							>
								{exportando ? "Generando…" : "Descargar PDF"}
							</button>
							<button
								type="button"
								onClick={() => window.print()}
								className="mt-2 w-full rounded-lg border border-slate-300 py-2 text-sm font-medium text-slate-800 hover:bg-slate-50"
							>
								Imprimir vista
							</button>
						</div>
					</aside>
				</div>
			) : (
				<p className="mt-10 text-center text-slate-600">No hay páginas en el PDF.</p>
			)}

			{modoWizard && !cargando && pdf && numPages > 0 ? (
				<div className="fixed bottom-0 left-0 right-0 z-40 border-t border-emerald-200 bg-white/95 px-4 py-3 shadow-[0_-4px_20px_rgba(0,0,0,0.08)] print:hidden">
					<div className="mx-auto flex max-w-lg flex-col items-stretch gap-2 sm:max-w-2xl sm:flex-row sm:items-center sm:justify-center">
						{msgDef ? (
							<p className="text-center text-xs text-slate-600 sm:flex-1">{msgDef}</p>
						) : (
							<p className="text-center text-xs text-slate-500 sm:flex-1">
								Revisa los campos y pulsa crear para publicar la plantilla en el muro.
							</p>
						)}
						<button
							type="button"
							disabled={guardandoDef}
							onClick={() => void finalizarWizardCrearPlantilla()}
							className="inline-flex items-center justify-center gap-2 rounded-xl border border-emerald-700 bg-emerald-600 px-6 py-3 text-sm font-semibold text-white shadow-md hover:bg-emerald-700 disabled:opacity-50"
						>
							<IconoDocumento className="h-4 w-4" />
							{guardandoDef ? "Guardando…" : "Crear plantilla"}
						</button>
					</div>
				</div>
			) : null}
		</div>
	);
}
