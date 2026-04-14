"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { createPortal } from "react-dom";
import { IconoSalir } from "@/app/alumno/aida-iconos";
import { OrientadorRolPanelProvider, type RolPanelOrientador } from "./OrientadorPanelRolContext";

export default function OrientadorPanelShell({ children }: { children: ReactNode }) {
	const router = useRouter();
	const [listo, setListo] = useState(false);
	const [email, setEmail] = useState("");
	const [rolPanel, setRolPanel] = useState<RolPanelOrientador>("jefe");
	const [salirCargando, setSalirCargando] = useState(false);
	const [confirmarSalirAbierto, setConfirmarSalirAbierto] = useState(false);
	const [montado, setMontado] = useState(false);

	const comprobar = useCallback(async () => {
		const res = await fetch("/api/orientador/sesion", { credentials: "include" });
		const data = (await res.json()) as { autenticado?: boolean; email?: string };
		if (!res.ok || !data.autenticado) {
			router.replace("/orientador");
			return;
		}
		setEmail(data.email ?? "");
		setListo(true);
	}, [router]);

	useEffect(() => {
		void comprobar();
	}, [comprobar]);

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

	async function salir() {
		setSalirCargando(true);
		try {
			await fetch("/api/orientador/salir", { method: "POST", credentials: "include" });
			router.replace("/orientador");
		} finally {
			setSalirCargando(false);
		}
	}

	if (!listo) {
		return (
			<div className="flex min-h-screen items-center justify-center bg-slate-50 text-slate-600">
				<span className="inline-flex items-center gap-2">
					<span className="h-5 w-5 animate-spin rounded-full border-2 border-emerald-600 border-t-transparent" />
					Verificando sesión…
				</span>
			</div>
		);
	}

	return (
		<div className="min-h-screen w-full min-h-[100dvh] bg-gradient-to-b from-slate-50 to-emerald-50/20">
			<header className="sticky top-0 z-20 w-full overflow-visible border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur">
				<div className="relative w-full px-3 pt-2.5 pb-3 sm:px-4 sm:pt-3 sm:pb-3 lg:px-6">
					<div className="flex min-h-[3rem] items-start justify-between gap-3 sm:min-h-[3.5rem]">
						<div className="min-w-0 max-w-[min(100%,calc(100%-3.75rem))] sm:max-w-[52%]">
							<p
								className="line-clamp-2 text-lg font-semibold leading-snug text-slate-800 sm:text-xl"
								title={email}
							>
								{email}
							</p>

						</div>
						<button
							type="button"
							onClick={() => setConfirmarSalirAbierto(true)}
							disabled={salirCargando}
							aria-label={salirCargando ? "Cerrando sesión…" : "Cerrar sesión"}
							title="Cerrar sesión"
							aria-busy={salirCargando}
							aria-haspopup="dialog"
							aria-expanded={confirmarSalirAbierto}
							className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-xl border-2 border-[#B91C1C] bg-[#DC2626] text-white shadow-md transition hover:border-[#991B1B] hover:bg-[#B91C1C] disabled:opacity-50 sm:h-12 sm:w-12"
						>
							{salirCargando ? (
								<span
									className="h-5 w-5 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent sm:h-6 sm:w-6"
									aria-hidden
								/>
							) : (
								<IconoSalir className="h-6 w-6 shrink-0 sm:h-7 sm:w-7" aria-hidden />
							)}
						</button>
					</div>
					{/* Logo centrado “volando”: mitad sobre la franja del header y mitad hacia el contenido (como antes en web) */}
					<div className="pointer-events-none absolute left-1/2 top-full z-30 -translate-x-1/2 -translate-y-1/2">
						<Link href="/orientador/panel" className="pointer-events-auto block leading-none">
							<div className="flex items-center justify-center rounded-full border-2 border-[#C4B5FD] bg-white p-2 shadow-md sm:p-2.5">
								<Image
									src="/imagenes/Inicio/aida.png"
									alt="A.I.D.A"
									width={240}
									height={100}
									priority
									className="h-10 w-auto max-w-[min(80vw,210px)] object-contain sm:h-[46px] sm:max-w-[230px]"
								/>
							</div>
						</Link>
					</div>
				</div>
			</header>
			{/* Contenido al ancho útil de la ventana (sin tope max-width); padding alineado con el header */}
			<div className="w-full max-w-none px-3 pb-6 pt-12 sm:px-4 sm:pb-8 sm:pt-14 lg:px-6">
				<OrientadorRolPanelProvider rol={rolPanel}>{children}</OrientadorRolPanelProvider>
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
								aria-labelledby="confirmar-salir-titulo"
							>
								<div className="bg-gradient-to-br from-violet-50 via-white to-sky-50/80 px-7 pb-8 pt-9 sm:px-10 sm:pb-9 sm:pt-10">
									<p
										id="confirmar-salir-titulo"
										className="text-xl font-bold tracking-tight text-slate-800 sm:text-2xl"
									>
										¿Deseas cerrar sesión?
									</p>
									<p className="mx-auto mt-3 max-w-[18rem] text-sm leading-relaxed text-slate-500 sm:text-[0.9375rem]">
										Saldrás del panel del orientador. Podrás volver a entrar cuando quieras.
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
		</div>
	);
}
