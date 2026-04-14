"use client";

import { useCallback, useEffect, useState } from "react";
import { DURACION_MENSAJE_EMERGENTE_MS } from "@/lib/ui/duracion-mensaje-emergente-ms";

type SolicitudAcceso = {
	id: string;
	email: string;
	estado: "pendiente" | "aceptada" | "rechazada";
	creado_en: string;
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

export default function SolicitudesAccesoEscolarOrientador() {
	const [cargando, setCargando] = useState(true);
	const [solicitudes, setSolicitudes] = useState<SolicitudAcceso[]>([]);
	const [mutandoSolicitudId, setMutandoSolicitudId] = useState<string | null>(null);
	const [mensaje, setMensaje] = useState("");
	const [mensajeEsError, setMensajeEsError] = useState(false);

	const cargar = useCallback(async () => {
		setCargando(true);
		try {
			const res = await fetch("/api/orientador/solicitudes-acceso", { credentials: "include" });
			const data = (await res.json()) as { solicitudes?: SolicitudAcceso[]; error?: string };
			if (!res.ok) {
				setMensajeEsError(true);
				setMensaje(data.error ?? "No se pudieron cargar las solicitudes");
				setSolicitudes([]);
				return;
			}
			setSolicitudes(data.solicitudes ?? []);
		} catch {
			setMensajeEsError(true);
			setMensaje("Error de red al cargar solicitudes");
			setSolicitudes([]);
		} finally {
			setCargando(false);
		}
	}, []);

	useEffect(() => {
		void cargar();
	}, [cargar]);

	useEffect(() => {
		if (!mensaje.trim()) {
			return;
		}
		const id = window.setTimeout(() => setMensaje(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [mensaje]);

	async function resolver(solicitudId: string, accion: "aceptar" | "rechazar") {
		setMutandoSolicitudId(solicitudId);
		setMensaje("");
		setMensajeEsError(false);
		try {
			const res = await fetch("/api/orientador/solicitudes-acceso", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ solicitudId, accion }),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setMensajeEsError(true);
				setMensaje(data.error ?? "No se pudo actualizar la solicitud");
				return;
			}
			setMensajeEsError(false);
			setMensaje(
				accion === "aceptar"
					? "Cuenta activada: el orientador ya puede iniciar sesión."
					: "Solicitud rechazada.",
			);
			await cargar();
		} catch {
			setMensajeEsError(true);
			setMensaje("Error de red al actualizar la solicitud");
		} finally {
			setMutandoSolicitudId(null);
		}
	}

	const pendientes = solicitudes.length;

	return (
		<div
			id="sec-escolar-solicitudes"
			className="mt-10 rounded-2xl border border-violet-200/80 bg-gradient-to-b from-violet-50/90 to-white p-5 shadow-md shadow-violet-100/40 sm:p-6"
			aria-labelledby="escolar-solicitudes-titulo"
		>
			<div className="flex flex-wrap items-start justify-between gap-3 border-b border-violet-100 pb-4">
				<div>
					<h3
						id="escolar-solicitudes-titulo"
						className="text-lg font-bold tracking-tight text-slate-900"
					>
						Solicitudes de acceso
					</h3>
				</div>
				<div className="flex shrink-0 flex-wrap items-center gap-2">
					{pendientes > 0 ? (
						<span className="rounded-full border border-violet-300 bg-violet-100 px-3 py-1 text-xs font-bold text-violet-900">
							{pendientes} pendiente{pendientes === 1 ? "" : "s"}
						</span>
					) : null}
					<button
						type="button"
						onClick={() => {
							setMensaje("");
							setMensajeEsError(false);
							void cargar();
						}}
						disabled={cargando}
						className="rounded-xl border border-slate-300 bg-white px-3 py-1.5 text-xs font-semibold text-slate-700 shadow-sm transition hover:bg-slate-50 disabled:opacity-50 sm:text-sm"
					>
						{cargando ? "Actualizando…" : "Actualizar lista"}
					</button>
				</div>
			</div>

			{mensaje ? (
				<p
					className={`mt-4 rounded-xl px-3 py-2.5 text-sm font-medium ${
						mensaje.includes("Error") || mensaje.includes("No se")
							? "bg-red-50 text-red-800"
							: "bg-emerald-50 text-emerald-900"
					}`}
					role="status"
				>
					{mensaje}
				</p>
			) : null}

			<div className="mt-4">
				{cargando && solicitudes.length === 0 ? (
					<p className="py-8 text-center text-sm text-slate-500">Cargando solicitudes…</p>
				) : solicitudes.length === 0 ? (
					<div className="rounded-xl border border-dashed border-slate-200 bg-slate-50/50 py-10 text-center">
						<p className="text-sm font-medium text-slate-700">No hay solicitudes pendientes</p>
						<p className="mx-auto mt-2 max-w-sm text-xs text-slate-500">
							Cuando alguien se registre con un correo nuevo, aparecerá aquí para que decidas si
							aceptar o rechazar.
						</p>
					</div>
				) : (
					<ul className="space-y-3">
						{solicitudes.map((s) => (
							<li
								key={s.id}
								className="flex flex-col gap-3 rounded-xl border border-slate-200/80 bg-white p-4 shadow-sm sm:flex-row sm:items-center sm:justify-between"
							>
								<div className="min-w-0 flex-1">
									<p className="truncate text-sm font-semibold text-slate-900" title={s.email}>
										{s.email}
									</p>
									<p className="mt-0.5 text-xs text-slate-500">
										Solicitud: {formatearFechaHora(s.creado_en)}
									</p>
								</div>
								<div className="flex shrink-0 flex-wrap gap-2 sm:justify-end">
									{mutandoSolicitudId === s.id ? (
										<span className="flex items-center px-2 text-sm font-medium text-slate-500">
											Procesando…
										</span>
									) : (
										<>
											<button
												type="button"
												disabled={mutandoSolicitudId !== null}
												onClick={() => void resolver(s.id, "rechazar")}
												className="rounded-xl border-2 border-[#2563EB] bg-[#DBEAFE] px-4 py-2 text-sm font-semibold text-[#1E40AF] transition hover:bg-[#BFDBFE] disabled:opacity-50"
											>
												Rechazar
											</button>
											<button
												type="button"
												disabled={mutandoSolicitudId !== null}
												onClick={() => void resolver(s.id, "aceptar")}
												className="rounded-xl border-2 border-[#7C3AED] bg-[#EDE9FE] px-4 py-2 text-sm font-semibold text-[#5B21B6] shadow-sm transition hover:bg-[#DDD6FE] disabled:opacity-50"
											>
												Aceptar
											</button>
										</>
									)}
								</div>
							</li>
						))}
					</ul>
				)}
			</div>
		</div>
	);
}
