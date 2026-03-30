"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { jpegsABufferPdf } from "./imagenes-jpeg-a-pdf";

export type ResultadoCapturaEscaner = {
	nombre: string;
	pdfBlob: Blob;
	primeraPaginaJpeg: Blob;
};

type PaginaCap = {
	id: string;
	url: string;
	bytes: Uint8Array;
};

function blobAUint8(b: Blob): Promise<Uint8Array> {
	return b.arrayBuffer().then((ab) => new Uint8Array(ab));
}

function fotogramaRotado(video: HTMLVideoElement, rotacionGrados: number): Promise<Blob> {
	const w = video.videoWidth;
	const h = video.videoHeight;
	if (w < 2 || h < 2) {
		return Promise.reject(new Error("La cámara aún no está lista"));
	}
	const canvas = document.createElement("canvas");
	const r = ((rotacionGrados % 360) + 360) % 360;
	if (r === 90 || r === 270) {
		canvas.width = h;
		canvas.height = w;
	} else {
		canvas.width = w;
		canvas.height = h;
	}
	const ctx = canvas.getContext("2d");
	if (!ctx) {
		return Promise.reject(new Error("Canvas no disponible"));
	}
	ctx.translate(canvas.width / 2, canvas.height / 2);
	ctx.rotate((r * Math.PI) / 180);
	ctx.drawImage(video, -w / 2, -h / 2);
	return new Promise((resolve, reject) => {
		canvas.toBlob(
			(b) => {
				if (b) {
					resolve(b);
				} else {
					reject(new Error("No se pudo capturar la imagen"));
				}
			},
			"image/jpeg",
			0.92,
		);
	});
}

type Props = {
	abierto: boolean;
	titulo: string;
	esPlantilla: boolean;
	onCerrar: () => void;
	onCrearPdf: (r: ResultadoCapturaEscaner) => void;
};

export default function ModalCapturaEscaner({ abierto, titulo, esPlantilla, onCerrar, onCrearPdf }: Props) {
	const videoRef = useRef<HTMLVideoElement>(null);
	const streamActivaRef = useRef<MediaStream | null>(null);
	const [nombre, setNombre] = useState("");
	const [paginas, setPaginas] = useState<PaginaCap[]>([]);
	const [stream, setStream] = useState<MediaStream | null>(null);
	const [facingMode, setFacingMode] = useState<"environment" | "user">("environment");
	const [rotacion, setRotacion] = useState(0);
	const [preparando, setPreparando] = useState(false);
	const [creandoPdf, setCreandoPdf] = useState(false);
	const [error, setError] = useState("");

	const detenerCamara = useCallback(() => {
		setStream((prev) => {
			if (prev) {
				for (const t of prev.getTracks()) {
					t.stop();
				}
			}
			return null;
		});
	}, []);

	useEffect(() => {
		if (!abierto) {
			detenerCamara();
			setNombre("");
			setPaginas((p) => {
				for (const x of p) {
					URL.revokeObjectURL(x.url);
				}
				return [];
			});
			setRotacion(0);
			setError("");
			return;
		}

		let cancel = false;
		(async () => {
			try {
				const s = await navigator.mediaDevices.getUserMedia({
					video: { facingMode },
					audio: false,
				});
				if (cancel) {
					for (const t of s.getTracks()) {
						t.stop();
					}
					return;
				}
				streamActivaRef.current = s;
				setStream(s);
				if (videoRef.current) {
					videoRef.current.srcObject = s;
				}
			} catch {
				setError("No se pudo acceder a la cámara.");
			}
		})();

		return () => {
			cancel = true;
			const s = streamActivaRef.current;
			streamActivaRef.current = null;
			if (s) {
				for (const t of s.getTracks()) {
					t.stop();
				}
			}
			setStream(null);
		};
	}, [abierto, facingMode, detenerCamara]);

	useEffect(() => {
		const v = videoRef.current;
		if (v && stream) {
			v.srcObject = stream;
		}
	}, [stream]);

	const llamarPrepare = useCallback(
		async (archivoJpeg: Blob): Promise<Blob> => {
			const form = new FormData();
			form.append("file", archivoJpeg, "captura.jpg");
			if (esPlantilla) {
				form.append("binarizar", "false");
				form.append("corregir_perspectiva", "false");
			} else {
				form.append("binarizar", "true");
				form.append("corregir_perspectiva", "false");
			}
			const res = await fetch("/api/orientador/ocr/prepare", {
				method: "POST",
				body: form,
				credentials: "include",
			});
			if (res.ok) {
				return res.blob();
			}
			let msg = "No se pudo preparar la imagen";
			let errTxt = "";
			try {
				const j = (await res.json()) as { error?: string };
				errTxt = typeof j.error === "string" ? j.error : "";
				if (errTxt) {
					msg = errTxt;
				}
			} catch {
				/* ignore */
			}
			const sinOcr =
				res.status === 503 &&
				(errTxt.includes("AIDA_OCR_API_BASE_URL") || errTxt.includes("OCR no configurado"));
			if (sinOcr) {
				return archivoJpeg;
			}
			throw new Error(msg);
		},
		[esPlantilla],
	);

	const capturar = useCallback(async () => {
		const video = videoRef.current;
		if (!video) {
			return;
		}
		setPreparando(true);
		setError("");
		try {
			const raw = await fotogramaRotado(video, rotacion);
			const preparada = await llamarPrepare(raw);
			const bytes = await blobAUint8(preparada);
			const url = URL.createObjectURL(preparada);
			const id = crypto.randomUUID();
			setPaginas((prev) => [...prev, { id, url, bytes }]);
		} catch (e) {
			setError(e instanceof Error ? e.message : "Error al capturar");
		} finally {
			setPreparando(false);
		}
	}, [llamarPrepare, rotacion]);

	const quitarPagina = useCallback((id: string) => {
		setPaginas((prev) => {
			const p = prev.find((x) => x.id === id);
			if (p) {
				URL.revokeObjectURL(p.url);
			}
			return prev.filter((x) => x.id !== id);
		});
	}, []);

	const mover = useCallback((id: string, delta: number) => {
		setPaginas((prev) => {
			const i = prev.findIndex((x) => x.id === id);
			const j = i + delta;
			if (i < 0 || j < 0 || j >= prev.length) {
				return prev;
			}
			const copia = [...prev];
			const [item] = copia.splice(i, 1);
			copia.splice(j, 0, item);
			return copia;
		});
	}, []);

	const crearPdf = useCallback(async () => {
		const n = nombre.trim();
		if (!n) {
			setError("Escribe un nombre para el archivo.");
			return;
		}
		if (paginas.length === 0) {
			setError("Agrega al menos una página.");
			return;
		}
		setCreandoPdf(true);
		setError("");
		try {
			const jpegs = paginas.map((p) => p.bytes);
			const pdfBytes = await jpegsABufferPdf(jpegs);
			const pdfBlob = new Blob([pdfBytes], { type: "application/pdf" });
			const primera = new Blob([paginas[0].bytes], { type: "image/jpeg" });
			onCrearPdf({ nombre: n, pdfBlob, primeraPaginaJpeg: primera });
		} catch {
			setError("No se pudo generar el PDF.");
		} finally {
			setCreandoPdf(false);
		}
	}, [nombre, paginas, onCrearPdf]);

	if (!abierto) {
		return null;
	}

	return (
		<div
			className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-900/55 p-3 sm:p-4"
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
				aria-labelledby="titulo-modal-captura"
			>
				<div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-2 sm:px-4">
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
					<h2 id="titulo-modal-captura" className="flex-1 text-center text-base font-bold text-slate-900 sm:text-lg">
						{titulo}
					</h2>
					<span className="w-9" aria-hidden />
				</div>

				<div className="shrink-0 px-4 py-3">
					<label className="flex flex-wrap items-center gap-2 text-sm font-medium text-slate-700">
						<span>Nombre:</span>
						<input
							type="text"
							value={nombre}
							onChange={(e) => setNombre(e.target.value)}
							className="min-w-[12rem] flex-1 rounded-lg border border-slate-300 px-3 py-2 text-slate-900 outline-none focus:border-violet-500 focus:ring-1 focus:ring-violet-500"
							placeholder="Ej. Acta escaneada"
						/>
					</label>
				</div>

				<div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto px-4 pb-3 md:grid-cols-2 md:gap-4">
					<div className="flex min-h-[220px] flex-col rounded-xl border border-slate-200 bg-slate-50">
						<div className="relative flex flex-1 items-center justify-center overflow-hidden rounded-t-xl bg-black/5">
							<video ref={videoRef} autoPlay playsInline muted className="max-h-[min(50vh,360px)] w-full object-contain" />
						</div>
						<div className="flex items-center justify-center gap-4 py-3">
							<button
								type="button"
								onClick={() => setFacingMode((m) => (m === "environment" ? "user" : "environment"))}
								className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
								title="Cambiar cámara"
								aria-label="Cambiar cámara"
							>
								<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M3 9a2 2 0 012-2h.93a2 2 0 001.664-.89l.812-1.22A2 2 0 0110.07 4h3.86a2 2 0 011.664.89l.812 1.22A2 2 0 0018.07 7H19a2 2 0 012 2v9a2 2 0 01-2 2H5a2 2 0 01-2-2V9z"
									/>
									<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 13a3 3 0 11-6 0 3 3 0 016 0z" />
								</svg>
							</button>
							<button
								type="button"
								onClick={() => void capturar()}
								disabled={preparando}
								className="flex h-14 w-14 items-center justify-center rounded-full border-4 border-violet-600 bg-white shadow-md transition hover:bg-violet-50 disabled:opacity-50"
								title="Capturar"
								aria-label="Capturar foto"
							>
								<span className="h-8 w-8 rounded-full bg-violet-600" />
							</button>
							<button
								type="button"
								onClick={() => setRotacion((r) => (r + 90) % 360)}
								className="flex h-11 w-11 items-center justify-center rounded-full border border-slate-300 bg-white text-slate-700 shadow-sm hover:bg-slate-50"
								title="Rotar vista"
								aria-label="Rotar"
							>
								<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
									<path
										strokeLinecap="round"
										strokeLinejoin="round"
										strokeWidth={2}
										d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15"
									/>
								</svg>
							</button>
						</div>
					</div>

					<div className="rounded-xl border border-slate-200 bg-white p-2">
						<p className="mb-2 text-center text-xs font-medium text-slate-500">Páginas del PDF</p>
						<div className="grid max-h-[min(50vh,400px)] grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-3">
							{paginas.map((p, idx) => (
								<div
									key={p.id}
									className="relative overflow-hidden rounded-lg border border-slate-200 bg-slate-100"
								>
									<img src={p.url} alt="" className="aspect-[3/4] w-full object-cover" />
									<div className="absolute left-1 top-1 flex gap-1">
										<button
											type="button"
											onClick={() => mover(p.id, -1)}
											disabled={idx === 0}
											className="rounded bg-white/90 px-1 text-[10px] shadow disabled:opacity-30"
										>
											↑
										</button>
										<button
											type="button"
											onClick={() => mover(p.id, 1)}
											disabled={idx === paginas.length - 1}
											className="rounded bg-white/90 px-1 text-[10px] shadow disabled:opacity-30"
										>
											↓
										</button>
									</div>
									<button
										type="button"
										onClick={() => quitarPagina(p.id)}
										className="absolute bottom-1 right-1 rounded-full bg-red-600 p-1 text-white shadow hover:bg-red-700"
										aria-label="Eliminar página"
									>
										<svg className="h-3.5 w-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
											<path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16" />
										</svg>
									</button>
								</div>
							))}
						</div>
					</div>
				</div>

				{error ? (
					<p className="px-4 pb-2 text-center text-sm text-red-600">{error}</p>
				) : null}
				{preparando ? (
					<p className="px-4 pb-2 text-center text-xs text-slate-500">Preparando imagen con el servicio OCR…</p>
				) : null}

				<div className="shrink-0 border-t border-slate-100 p-4">
					<button
						type="button"
						onClick={() => void crearPdf()}
						disabled={creandoPdf || !nombre.trim() || paginas.length === 0}
						className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-600 py-3 text-sm font-semibold text-white transition hover:bg-slate-700 disabled:cursor-not-allowed disabled:opacity-45"
					>
						{creandoPdf ? "Generando…" : "Crear PDF"}
						<span aria-hidden>📄</span>
					</button>
				</div>
			</div>
		</div>
	);
}
