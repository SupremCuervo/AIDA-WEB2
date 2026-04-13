"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { createPortal } from "react-dom";
import { IconoSalir } from "@/app/alumno/aida-iconos";
import { gradoEtiquetaParaVistaAlumno } from "@/lib/padron/grado-alumno";
import MisDocumentosAlumno from "./MisDocumentosAlumno";
import { PanelAlumnoProvider } from "./PanelAlumnoContext";

type Sesion = {
	autenticado: boolean;
	nombreCompleto?: string;
	grupo?: string;
	grado?: string;
	requiereCarrera?: boolean;
	carreraId?: string | null;
	carreraNombre?: string | null;
	carreraCodigo?: string | null;
	carrerasOpciones?: { id: string; codigo: string; nombre: string }[];
	porcentajeDocumentos?: number;
	documentosSubidos?: number;
	documentosTotales?: number;
};

export default function PanelAlumnoPage() {
	const router = useRouter();
	const [sesion, setSesion] = useState<Sesion | null>(null);
	const [salirCargando, setSalirCargando] = useState(false);
	const [confirmarSalirAbierto, setConfirmarSalirAbierto] = useState(false);
	const [montado, setMontado] = useState(false);
	const [carreraSel, setCarreraSel] = useState<string>("__sin__");
	const [carreraGuardando, setCarreraGuardando] = useState(false);
	const [carreraMsg, setCarreraMsg] = useState<{ ok: boolean; t: string } | null>(null);

	const cargar = useCallback(async () => {
		const res = await fetch("/api/alumno/sesion", { credentials: "include" });
		const data = (await res.json()) as Sesion;
		if (!res.ok || !data.autenticado) {
			router.replace("/alumno");
			return;
		}
		setSesion(data);
	}, [router]);

	useEffect(() => {
		cargar();
	}, [cargar]);

	useEffect(() => {
		setMontado(true);
	}, []);

	useEffect(() => {
		if (!confirmarSalirAbierto) {
			return;
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape" && !salirCargando) {
				setConfirmarSalirAbierto(false);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [confirmarSalirAbierto, salirCargando]);

	useEffect(() => {
		if (!sesion?.requiereCarrera) {
			setCarreraSel("__sin__");
			return;
		}
		const id = sesion.carreraId;
		setCarreraSel(id != null && id !== "" ? id : "__sin__");
	}, [sesion?.requiereCarrera, sesion?.carreraId]);

	async function guardarCarreraAlumno() {
		setCarreraMsg(null);
		setCarreraGuardando(true);
		try {
			const res = await fetch("/api/alumno/carrera", {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					carreraId: carreraSel === "__sin__" ? null : carreraSel,
				}),
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setCarreraMsg({ ok: false, t: d.error ?? "No se pudo guardar" });
				return;
			}
			setCarreraMsg({ ok: true, t: "Carrera guardada." });
			await cargar();
		} catch {
			setCarreraMsg({ ok: false, t: "Error de red" });
		} finally {
			setCarreraGuardando(false);
		}
	}

	async function salir() {
		setSalirCargando(true);
		try {
			await fetch("/api/alumno/salir", { method: "POST", credentials: "include" });
			router.replace("/alumno");
		} finally {
			setSalirCargando(false);
		}
	}

	if (!sesion?.autenticado) {
		return (
			<div
				className="flex min-h-screen items-center justify-center text-[#64748B]"
				style={{
					backgroundImage: "linear-gradient(135deg, #EFF6FF 0%, #FFFFFF 50%, #F5F3FF 100%)",
				}}
			>
				<div className="flex items-center gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-6 py-4 shadow-lg shadow-[#2563EB]/10">
					<span className="h-5 w-5 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
					<span className="text-sm font-medium text-[#1E293B]">Comprobando sesión…</span>
				</div>
			</div>
		);
	}

	const pct =
		typeof sesion.porcentajeDocumentos === "number" ? sesion.porcentajeDocumentos : 0;
	const total = sesion.documentosTotales ?? 5;
	const subidos = sesion.documentosSubidos ?? 0;

	return (
		<PanelAlumnoProvider refrescarSesion={cargar}>
			<div
				className="min-h-screen"
				style={{
					backgroundImage:
						"linear-gradient(180deg, #FFFFFF 0%, #F8FAFC 50%, rgba(239, 246, 255, 0.8) 100%)",
				}}
			>
				<header className="sticky top-0 z-20 overflow-visible border-b border-[#E2E8F0] bg-[#FFFFFF]/95 shadow-sm backdrop-blur-md">
					<div className="mx-auto flex max-w-5xl items-center justify-between gap-2 overflow-visible px-3 py-2 sm:gap-3 sm:px-5 sm:py-2.5">
						<div className="relative h-10 w-[128px] shrink-0 overflow-visible sm:h-11 sm:w-[148px]">
							<Image
								src="/imagenes/Alumno/logo.png"
								alt="AIDA"
								width={220}
								height={74}
								className="absolute left-0 top-1/2 h-10 w-auto max-w-[190px] origin-left -translate-y-1/2 scale-[1.22] object-contain object-left sm:h-11 sm:max-w-[220px] sm:scale-[1.24]"
								priority
							/>
						</div>
						<div className="flex min-w-0 flex-1 items-center justify-center gap-2 px-1 sm:gap-2.5 sm:px-2">
							{/* Solo lectura: no es un campo editable */}
							<p
								className="min-w-0 max-w-[min(100%,280px)] truncate text-center text-sm font-semibold leading-snug text-[#1E293B] sm:max-w-md sm:text-base md:text-lg"
								title={sesion.nombreCompleto}
							>
								{sesion.nombreCompleto}
							</p>
							<div
								className="flex shrink-0 items-center gap-1.5 rounded-full bg-[#EFF6FF] px-2 py-1 ring-1 ring-[#DBEAFE] sm:gap-2 sm:px-2.5 sm:py-1.5"
								title={`${subidos} de ${total} documentos subidos · ${pct}%`}
							>
								<div className="relative h-9 w-9 shrink-0 sm:h-10 sm:w-10" aria-hidden>
									<div
										className="absolute inset-0 rounded-full"
										style={{
											background: `conic-gradient(#2563EB 0deg ${pct * 3.6}deg, #E2E8F0 ${pct * 3.6}deg 360deg)`,
										}}
									/>
									<div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-white text-[10px] font-bold tabular-nums text-[#1E293B] shadow-inner sm:text-xs">
										{pct}
									</div>
								</div>
								<span className="text-[10px] font-medium text-[#1D4ED8] sm:text-xs">
									<span className="hidden sm:inline">% avance</span>
									<span className="sm:hidden">%</span>
								</span>
							</div>
						</div>
						<div className="flex shrink-0 flex-col items-end justify-center">
							<button
								type="button"
								onClick={() => setConfirmarSalirAbierto(true)}
								disabled={salirCargando}
								aria-label="Cerrar sesión"
								aria-busy={salirCargando}
								aria-haspopup="dialog"
								aria-expanded={confirmarSalirAbierto}
								className="inline-flex items-center justify-center rounded-lg border border-[#B91C1C] bg-[#DC2626] p-2 text-white shadow-sm transition hover:border-[#991B1B] hover:bg-[#B91C1C] disabled:opacity-50 sm:p-2.5"
							>
								<IconoSalir className="h-5 w-5 sm:h-6 sm:w-6" aria-hidden />
							</button>
						</div>
					</div>
				</header>

				<main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
					<div className="mb-8 text-center">
						<h1 className="mt-1 text-4xl font-bold tracking-tight text-[#1E293B] sm:text-5xl lg:text-[2.875rem]">
							Tus documentos
						</h1>
						<p className="mx-auto mt-3 max-w-2xl text-lg leading-relaxed text-[#64748B] sm:text-xl lg:text-2xl">
							<span className="font-bold text-[#6D28D9]">
								{gradoEtiquetaParaVistaAlumno(sesion.grado)} · {sesion.grupo}
							</span>
							{sesion.requiereCarrera && sesion.carreraNombre ? (
								<>
									{" · "}
									<span className="font-medium text-[#1E293B]">{sesion.carreraNombre}</span>
								</>
							) : null}
						</p>
						<p className="mx-auto mt-2 max-w-2xl text-sm leading-relaxed text-[#6B7280] sm:text-base">
							Debes subir tus documentos a tiempo en AIDA; si no lo haces aquí, tendrás que acudir a la escuela para completar tu trámite de manera presencial.
						</p>
						{sesion.requiereCarrera ? (
							<div className="mx-auto mt-4 flex max-w-xl flex-col gap-2 rounded-xl border border-[#EDE9FE] bg-[#F5F3FF] px-4 py-3 text-sm text-[#1E293B] sm:flex-row sm:flex-wrap sm:items-end">
								<div className="min-w-[12rem] flex-1">
									<label htmlFor="alumno-carrera" className="block text-xs font-medium text-[#6D28D9]">
										Carrera (desde 2.° grado)
									</label>
									<select
										id="alumno-carrera"
										value={carreraSel}
										onChange={(e) => setCarreraSel(e.target.value)}
										className="mt-1 w-full rounded-lg border border-[#C4B5FD] bg-white px-2 py-2 text-sm"
									>
										<option value="__sin__">— Elige una carrera —</option>
										{(sesion.carrerasOpciones ?? []).map((c) => (
											<option key={c.id} value={c.id}>
												{c.nombre}
											</option>
										))}
									</select>
								</div>
								<button
									type="button"
									disabled={carreraGuardando}
									onClick={() => void guardarCarreraAlumno()}
									className="rounded-lg border border-[#7C3AED] bg-[#7C3AED] px-4 py-2 text-sm font-semibold text-white shadow-md shadow-[#7C3AED]/20 hover:bg-[#6D28D9] disabled:opacity-60"
								>
									{carreraGuardando ? "Guardando…" : "Guardar carrera"}
								</button>
								{carreraMsg ? (
									<p
										className={`w-full text-xs sm:order-last ${
											carreraMsg.ok ? "text-teal-800" : "text-red-700"
										}`}
									>
										{carreraMsg.t}
									</p>
								) : null}
							</div>
						) : null}
					</div>

					<MisDocumentosAlumno />

				</main>
			</div>
			{montado && confirmarSalirAbierto
				? createPortal(
						<div
							className="fixed inset-0 z-[300] flex items-center justify-center bg-slate-900/45 p-4 backdrop-blur-[2px]"
							onClick={(e) => {
								if (e.target === e.currentTarget && !salirCargando) {
									setConfirmarSalirAbierto(false);
								}
							}}
							role="presentation"
						>
							<div
								className="w-full max-w-[min(100%,22rem)] overflow-hidden rounded-[1.75rem] border border-violet-100 bg-white text-center shadow-[0_25px_50px_-12px_rgba(91,33,182,0.18),0_0_0_1px_rgba(255,255,255,0.8)_inset] sm:max-w-md"
								onClick={(e) => e.stopPropagation()}
								role="dialog"
								aria-modal="true"
								aria-labelledby="alumno-confirmar-salir-titulo"
							>
								<div className="bg-gradient-to-br from-violet-50 via-white to-sky-50/80 px-7 pb-8 pt-9 sm:px-10 sm:pb-9 sm:pt-10">
									<p
										id="alumno-confirmar-salir-titulo"
										className="text-xl font-bold tracking-tight text-slate-800 sm:text-2xl"
									>
										¿Deseas cerrar sesión?
									</p>
									<p className="mx-auto mt-3 max-w-[18rem] text-sm leading-relaxed text-slate-500 sm:text-[0.9375rem]">
										Saldrás del panel del alumno. Podrás volver a entrar cuando quieras.
									</p>
									<div className="mt-9 flex flex-col gap-3 sm:mt-10 sm:flex-row sm:flex-wrap sm:items-center sm:justify-center sm:gap-4">
										<button
											type="button"
											disabled={salirCargando}
											onClick={() => setConfirmarSalirAbierto(false)}
											className="w-full rounded-2xl border-2 border-[#3B82F6] bg-[#DBEAFE] px-6 py-3 text-sm font-semibold text-[#1D4ED8] shadow-sm transition hover:border-[#2563EB] hover:bg-[#BFDBFE] disabled:opacity-60 sm:w-auto sm:min-w-[7.5rem] sm:text-base"
										>
											No
										</button>
										<button
											type="button"
											disabled={salirCargando}
											onClick={() => void salir()}
											className="w-full rounded-2xl border-2 border-[#7C3AED] bg-[#EDE9FE] px-6 py-3 text-sm font-semibold text-[#5B21B6] shadow-sm transition hover:border-[#6D28D9] hover:bg-[#DDD6FE] disabled:opacity-60 sm:w-auto sm:min-w-[7.5rem] sm:text-base"
										>
											{salirCargando ? "Cerrando…" : "Sí"}
										</button>
									</div>
								</div>
							</div>
						</div>,
						document.body,
					)
				: null}
		</PanelAlumnoProvider>
	);
}
