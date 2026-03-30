"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";
import { IconoSalir } from "@/app/alumno/aida-iconos";

export default function OrientadorPanelShell({ children }: { children: ReactNode }) {
	const router = useRouter();
	const [listo, setListo] = useState(false);
	const [email, setEmail] = useState("");
	const [salirCargando, setSalirCargando] = useState(false);

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
		<div className="min-h-screen bg-gradient-to-b from-slate-50 to-emerald-50/20">
			<header className="sticky top-0 z-20 overflow-visible border-b border-slate-200/80 bg-white/95 shadow-sm backdrop-blur">
				<div className="relative mx-auto max-w-6xl px-3 pt-2.5 pb-3 sm:px-5 sm:pt-3 sm:pb-3">
					<div className="flex min-h-[2.75rem] items-start justify-between gap-3">
						<div className="min-w-0 max-w-[min(100%,calc(100%-3rem))] sm:max-w-[46%]">
							<p
								className="line-clamp-2 text-[13px] font-semibold leading-snug text-slate-800"
								title={email}
							>
								{email}
							</p>

						</div>
						<button
							type="button"
							onClick={() => void salir()}
							disabled={salirCargando}
							aria-label={salirCargando ? "Cerrando sesión…" : "Cerrar sesión"}
							title="Cerrar sesión"
							aria-busy={salirCargando}
							className="inline-flex h-[34px] w-[34px] shrink-0 items-center justify-center rounded-lg border border-[#B91C1C] bg-[#DC2626] text-white shadow-sm transition hover:border-[#991B1B] hover:bg-[#B91C1C] disabled:opacity-50"
						>
							{salirCargando ? (
								<span
									className="h-3.5 w-3.5 shrink-0 animate-spin rounded-full border-2 border-white border-t-transparent"
									aria-hidden
								/>
							) : (
								<IconoSalir className="h-[18px] w-[18px] shrink-0" aria-hidden />
							)}
						</button>
					</div>
					{/* Logo centrado “volando”: mitad sobre la franja del header y mitad hacia el contenido (como antes en web) */}
					<div className="pointer-events-none absolute left-1/2 top-full z-30 -translate-x-1/2 -translate-y-1/2">
						<Link href="/orientador/panel" className="pointer-events-auto block leading-none">
							<Image
								src="/imagenes/Inicio/aida.png"
								alt="A.I.D.A"
								width={240}
								height={100}
								priority
								className="h-11 w-auto max-w-[min(92vw,220px)] object-contain drop-shadow-md sm:h-[52px] sm:max-w-[240px]"
							/>
						</Link>
					</div>
				</div>
			</header>
			{/* Espacio extra arriba para que el logo superpuesto no tape el menú / contenido */}
			<div className="mx-auto max-w-6xl px-4 pb-6 pt-12 sm:px-6 sm:pb-8 sm:pt-14">{children}</div>
		</div>
	);
}
