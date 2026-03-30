"use client";

import { useCallback, useEffect, useState } from "react";
import ModalRellenarPlantillaPanel from "./escaner/ModalRellenarPlantillaPanel";

type FilaPlantilla = {
	id: string;
	titulo: string;
	nombre_archivo: string;
	creado_en: string;
};

export default function PlantillasSeccionOrientador() {
	const [lista, setLista] = useState<FilaPlantilla[]>([]);
	const [cargando, setCargando] = useState(true);
	const [error, setError] = useState("");
	const [previewId, setPreviewId] = useState<string | null>(null);
	const [usarId, setUsarId] = useState<string | null>(null);
	const [usarTitulo, setUsarTitulo] = useState("");

	const cargar = useCallback(async () => {
		setCargando(true);
		setError("");
		try {
			const res = await fetch("/api/orientador/plantillas", { credentials: "include" });
			const j = (await res.json()) as { plantillas?: FilaPlantilla[]; error?: string };
			if (!res.ok) {
				setError(j.error ?? "No se pudieron cargar las plantillas");
				setLista([]);
				return;
			}
			setLista(j.plantillas ?? []);
		} catch {
			setError("Error de red");
			setLista([]);
		} finally {
			setCargando(false);
		}
	}, []);

	useEffect(() => {
		void cargar();
	}, [cargar]);

	return (
		<div className="mx-auto mt-5 max-w-6xl px-4 sm:px-6">
			<h2 className="mb-6 text-center text-2xl font-bold tracking-tight text-[#111827] sm:text-3xl">
				Plantillas
			</h2>
			{cargando ? (
				<p className="text-center text-sm text-slate-600">Cargando…</p>
			) : error ? (
				<p className="text-center text-sm text-red-600">{error}</p>
			) : lista.length === 0 ? (
				<p className="rounded-2xl border border-dashed border-slate-200 bg-white py-16 text-center text-sm text-slate-500">
					No hay plantillas guardadas. Crea una desde la sección Escaner.
				</p>
			) : (
				<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
					{lista.map((p) => (
						<article
							key={p.id}
							className="flex flex-col rounded-2xl border border-slate-200 bg-white p-4 shadow-sm transition hover:shadow-md"
						>
							<h3 className="text-center text-sm font-bold text-slate-900">{p.titulo}</h3>
							<button
								type="button"
								onClick={() => setPreviewId(p.id)}
								className="mt-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-slate-100 bg-slate-50 py-8 text-slate-600 transition hover:bg-slate-100"
							>
								<svg className="h-14 w-11 text-slate-800" fill="none" viewBox="0 0 24 32" aria-hidden>
									<path
										fill="currentColor"
										fillOpacity="0.08"
										stroke="currentColor"
										strokeWidth="1.2"
										d="M4 2h10l6 6v20a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2z"
									/>
									<path stroke="currentColor" strokeWidth="1" d="M14 2v8h8" />
									<path stroke="currentColor" strokeWidth="0.8" d="M6 18h12M6 22h10M6 14h8" />
								</svg>
								<span className="text-[10px] font-medium uppercase tracking-wide text-slate-500 [writing-mode:vertical-rl] rotate-180">
									Vista previa
								</span>
							</button>
							<button
								type="button"
								onClick={() => {
									setUsarTitulo(p.titulo);
									setUsarId(p.id);
								}}
								className="mt-3 w-full rounded-xl bg-slate-200 py-2.5 text-sm font-semibold text-slate-900 hover:bg-slate-300"
							>
								Ocupar
							</button>
						</article>
					))}
				</div>
			)}

			{previewId ? (
				<div
					className="fixed inset-0 z-[210] flex items-center justify-center bg-slate-900/55 p-4"
					onClick={() => setPreviewId(null)}
					role="presentation"
				>
					<div
						className="max-h-[90vh] w-full max-w-3xl overflow-hidden rounded-2xl bg-white shadow-2xl"
						onClick={(e) => e.stopPropagation()}
					>
						<div className="flex justify-end border-b border-slate-100 px-2 py-2">
							<button
								type="button"
								onClick={() => setPreviewId(null)}
								className="rounded-lg px-3 py-1 text-sm font-medium text-slate-600 hover:bg-slate-100"
							>
								Cerrar
							</button>
						</div>
						<iframe
							title="Vista previa plantilla"
							src={`/api/orientador/plantillas/${previewId}/pdf`}
							className="h-[min(80vh,720px)] w-full border-0"
						/>
					</div>
				</div>
			) : null}

			{usarId ? (
				<ModalRellenarPlantillaPanel
					abierto
					plantillaId={usarId}
					titulo={usarTitulo}
					onCerrar={() => setUsarId(null)}
					onDefinicionActualizada={() => void cargar()}
				/>
			) : null}
		</div>
	);
}
