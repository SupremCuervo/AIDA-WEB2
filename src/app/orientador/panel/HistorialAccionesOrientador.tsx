"use client";

import { useCallback, useEffect, useState } from "react";

type RegistroLog = {
	id: string;
	creado_en: string;
	actor_tipo: string;
	actor_etiqueta: string;
	accion: string;
	entidad: string;
	entidad_id: string | null;
	origen: string;
};

function formatearFechaHora(iso: string): string {
	const d = new Date(iso);
	if (Number.isNaN(d.getTime())) {
		return iso;
	}
	const dd = String(d.getDate()).padStart(2, "0");
	const mm = String(d.getMonth() + 1).padStart(2, "0");
	const yyyy = d.getFullYear();
	const hh = String(d.getHours()).padStart(2, "0");
	const min = String(d.getMinutes()).padStart(2, "0");
	return `${dd}/${mm}/${yyyy} ${hh}:${min}`;
}

function etiquetaUsuario(actorEtiqueta: string): string {
	const t = actorEtiqueta.trim();
	if (t === "" || t.toLowerCase() === "sistema") {
		return "Sistema";
	}
	return t;
}

export default function HistorialAccionesOrientador() {
	const [cargando, setCargando] = useState(true);
	const [error, setError] = useState("");
	const [registros, setRegistros] = useState<RegistroLog[]>([]);

	const cargar = useCallback(async () => {
		setCargando(true);
		setError("");
		try {
			const res = await fetch("/api/orientador/logs", { credentials: "include" });
			const data = (await res.json()) as { ok?: boolean; registros?: RegistroLog[]; error?: string };
			if (!res.ok) {
				setError(data.error ?? "No se pudo cargar el historial");
				setRegistros([]);
				return;
			}
			setRegistros(data.registros ?? []);
		} catch {
			setError("Error de red");
			setRegistros([]);
		} finally {
			setCargando(false);
		}
	}, []);

	useEffect(() => {
		void cargar();
	}, [cargar]);

	return (
		<div id="sec-historial" className="mx-auto max-w-5xl scroll-mt-24 px-2 pb-12 pt-4 sm:px-4">
			<h2 className="mb-8 text-center text-2xl font-bold tracking-tight text-slate-900 sm:text-3xl">
				Historial de Acciones
			</h2>

			<div className="overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-lg shadow-slate-200/60">
				<div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-200 bg-slate-50/80 px-4 py-3 sm:px-6">
					<p className="text-sm text-slate-600">
						Registro de cambios importantes (API y base de datos). La fecha y hora se guardan automáticamente.
					</p>
					<button
						type="button"
						onClick={() => void cargar()}
						disabled={cargando}
						className="rounded-xl border border-emerald-200 bg-white px-4 py-2 text-sm font-semibold text-emerald-800 shadow-sm transition hover:bg-emerald-50 disabled:opacity-50"
					>
						{cargando ? "Actualizando…" : "Actualizar"}
					</button>
				</div>

				{cargando && registros.length === 0 ? (
					<p className="px-6 py-10 text-center text-slate-500">Cargando historial…</p>
				) : error ? (
					<p className="px-6 py-10 text-center text-sm font-medium text-red-600" role="alert">
						{error}
					</p>
				) : registros.length === 0 ? (
					<p className="px-6 py-10 text-center text-slate-500">
						No hay registros aún. Si acabas de desplegar, ejecuta en Supabase el SQL de auditoría (
						<code className="rounded bg-slate-100 px-1 text-xs">migracion_logs_acciones_descriptivas.sql</code>
						).
					</p>
				) : (
					<div className="overflow-x-auto">
						<table className="w-full min-w-[640px] border-collapse text-left text-sm">
							<thead>
								<tr className="border-b border-slate-200 bg-slate-50">
									<th className="px-4 py-3 font-bold text-slate-800 sm:px-6">Usuario</th>
									<th className="px-4 py-3 font-bold text-slate-800 sm:px-6">Acción</th>
									<th className="px-4 py-3 text-right font-bold text-slate-800 sm:px-6">Fecha y Hora</th>
								</tr>
							</thead>
							<tbody>
								{registros.map((r) => (
									<tr
										key={r.id}
										className="border-b border-slate-100 last:border-0 hover:bg-slate-50/80"
									>
										<td className="max-w-[140px] truncate px-4 py-3 align-top font-medium text-slate-800 sm:max-w-[200px] sm:px-6">
											{etiquetaUsuario(r.actor_etiqueta)}
										</td>
										<td className="px-4 py-3 align-top text-slate-700 sm:px-6">{r.accion}</td>
										<td className="whitespace-nowrap px-4 py-3 text-right align-top tabular-nums text-slate-600 sm:px-6">
											{formatearFechaHora(r.creado_en)}
										</td>
									</tr>
								))}
							</tbody>
						</table>
					</div>
				)}
			</div>
		</div>
	);
}
