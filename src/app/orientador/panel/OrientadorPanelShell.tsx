"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState, type ReactNode } from "react";

export default function OrientadorPanelShell({ children }: { children: ReactNode }) {
	const router = useRouter();
	const [listo, setListo] = useState(false);
	const [email, setEmail] = useState("");

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
		await fetch("/api/orientador/salir", { method: "POST", credentials: "include" });
		router.replace("/orientador");
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
			<header className="sticky top-0 z-20 border-b border-emerald-200/60 bg-white/95 shadow-sm backdrop-blur">
				<div className="mx-auto flex max-w-6xl items-center justify-between gap-4 px-4 py-3 sm:px-6">
					<div className="min-w-0">
						<Link
							href="/orientador/panel"
							className="text-sm font-semibold text-emerald-900 hover:text-emerald-800 sm:text-base"
						>
							Panel orientador
						</Link>
						<div className="mt-0.5 flex min-w-0 items-center gap-2">
							<Image
								src="/imagenes/Alumno/logo.png"
								alt="AIDA"
								width={18}
								height={18}
								className="h-4.5 w-4.5 shrink-0 rounded object-contain"
							/>
							<p className="truncate text-xs text-slate-500 sm:text-sm">{email}</p>
						</div>
					</div>
					<div className="flex shrink-0 items-center gap-2 sm:gap-3">
						<Link
							href="/"
							className="rounded-lg px-2 py-2 text-xs font-medium text-slate-600 hover:bg-slate-100 sm:text-sm"
						>
							Inicio
						</Link>
						<button
							type="button"
							onClick={() => void salir()}
							className="rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 transition hover:bg-red-100 sm:text-sm"
						>
							Cerrar sesión
						</button>
					</div>
				</div>
			</header>
			<div className="mx-auto max-w-6xl px-4 py-8 sm:px-6">{children}</div>
		</div>
	);
}
