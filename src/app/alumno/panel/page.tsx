"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { IconoSalir } from "@/app/alumno/aida-iconos";
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
			<div className="flex min-h-screen items-center justify-center bg-gradient-to-br from-[#EFF6FF] via-[#FFFFFF] to-[#F5F3FF] text-[#64748B]">
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
			<div className="min-h-screen bg-gradient-to-b from-[#FFFFFF] via-[#F8FAFC] to-[#EFF6FF]/80">
				<header className="sticky top-0 z-20 border-b border-[#E2E8F0] bg-[#FFFFFF]/95 shadow-sm backdrop-blur-md">
					<div className="mx-auto flex max-w-5xl items-center justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-6">
						<div className="flex min-w-0 shrink-0 items-center">
							<Image
								src="/imagenes/Alumno/logo.png"
								alt="AIDA"
								width={132}
								height={44}
								className="h-9 w-auto max-w-[148px] object-contain object-left sm:h-10"
								priority
							/>
						</div>
						<div className="flex min-w-0 flex-1 items-center justify-center gap-2 px-2 sm:gap-3">
							{/* Solo lectura: no es un campo editable */}
							<p
								className="min-w-0 max-w-[min(100%,260px)] truncate text-center text-sm font-semibold text-[#1E293B] sm:max-w-md sm:text-base"
								title={sesion.nombreCompleto}
							>
								{sesion.nombreCompleto}
							</p>
							<div
								className="flex shrink-0 items-center gap-2 rounded-full bg-[#EFF6FF] px-3 py-1 ring-1 ring-[#DBEAFE]"
								title={`${subidos} de ${total} documentos subidos · ${pct}%`}
							>
								<div className="relative h-9 w-9 shrink-0" aria-hidden>
									<div
										className="absolute inset-0 rounded-full"
										style={{
											background: `conic-gradient(#2563EB 0deg ${pct * 3.6}deg, #E2E8F0 ${pct * 3.6}deg 360deg)`,
										}}
									/>
									<div className="absolute inset-[3px] flex items-center justify-center rounded-full bg-white text-[10px] font-bold tabular-nums text-[#1E293B] shadow-inner">
										{pct}
									</div>
								</div>
								<span className="text-xs font-medium text-[#1D4ED8]">
									<span className="hidden sm:inline">% avance</span>
									<span className="sm:hidden">%</span>
								</span>
							</div>
						</div>
						<div className="flex shrink-0 flex-col items-end justify-center">
							<button
								type="button"
								onClick={salir}
								disabled={salirCargando}
								className="inline-flex items-center gap-2 rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs font-semibold text-[#1E293B] transition hover:border-[#CBD5E1] hover:bg-white disabled:opacity-50 sm:text-sm"
							>
								<IconoSalir className="h-4 w-4 text-[#64748B]" />
								{salirCargando ? "…" : "Cerrar sesión"}
							</button>
						</div>
					</div>
				</header>

				<main className="mx-auto max-w-5xl px-4 py-8 sm:px-6 sm:py-10">
					<div className="mb-8">
						<p className="bg-gradient-to-r from-[#2563EB] to-[#7C3AED] bg-clip-text text-xs font-bold uppercase tracking-wide text-transparent">
							Expediente digital
						</p>
						<h1 className="mt-1 text-2xl font-bold tracking-tight text-[#1E293B] sm:text-3xl">
							Tus documentos
						</h1>
						<p className="mt-2 max-w-2xl text-sm leading-relaxed text-[#64748B] sm:text-base">
							<span className="font-medium text-[#1E293B]">
								{sesion.grado} · Grupo {sesion.grupo}
							</span>
							{sesion.requiereCarrera && sesion.carreraNombre ? (
								<>
									{" · "}
									<span className="font-medium text-[#1E293B]">{sesion.carreraNombre}</span>
								</>
							) : null}
							{" · "}
							Sube cada archivo en su fila. El orientador podrá revisar entregas y fechas límite
							desde su panel.
						</p>
						{sesion.requiereCarrera ? (
							<div className="mt-4 flex max-w-xl flex-col gap-2 rounded-xl border border-[#EDE9FE] bg-[#F5F3FF] px-4 py-3 text-sm text-[#1E293B] sm:flex-row sm:flex-wrap sm:items-end">
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

					<p className="mt-10 text-center text-sm text-[#64748B]">
						<Link
							href="/"
							className="font-semibold text-[#2563EB] underline-offset-4 hover:text-[#1D4ED8] hover:underline"
						>
							Volver al inicio
						</Link>
					</p>
				</main>
			</div>
		</PanelAlumnoProvider>
	);
}
