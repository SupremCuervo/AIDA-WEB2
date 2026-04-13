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
		<div className="mx-auto mt-5 w-full max-w-none">
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
								className="mt-3 flex flex-1 flex-col items-center justify-center gap-2 rounded-xl border border-slate-100 bg-slate-50 p-2 text-slate-600 transition hover:bg-slate-100"
							>
								<div className="h-36 w-full overflow-hidden rounded-lg border border-slate-200 bg-white">
									<iframe
										title={`Vista previa ${p.titulo}`}
										src={`/api/orientador/plantillas/${p.id}/pdf`}
										className="h-full w-full border-0"
									/>
								</div>
								<span className="text-xs font-medium uppercase tracking-wide text-slate-500">Vista previa</span>
							</button>
							<button
								type="button"
								onClick={() => {
									setUsarTitulo(p.titulo);
									setUsarId(p.id);
								}}
								className="mt-3 w-full rounded-xl border border-[#7C3AED] bg-[#EDE9FE] py-2.5 text-sm font-semibold text-[#5B21B6] hover:bg-[#DDD6FE]"
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
