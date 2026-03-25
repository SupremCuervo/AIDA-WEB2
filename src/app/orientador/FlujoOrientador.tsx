"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconoCandado, IconoCorreo, IconoUsuario } from "@/app/alumno/aida-iconos";

export default function FlujoOrientador() {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [cargando, setCargando] = useState(false);

	async function enviar(e: React.FormEvent) {
		e.preventDefault();
		setError("");
		setCargando(true);
		try {
			const res = await fetch("/api/orientador/acceso", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ email: email.trim(), password }),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setError(data.error ?? "No se pudo iniciar sesión");
				return;
			}
			router.replace("/orientador/panel");
		} catch {
			setError("Error de red");
		} finally {
			setCargando(false);
		}
	}

	return (
		<div className="min-h-screen bg-gradient-to-br from-[#EFF6FF] via-[#FFFFFF] to-[#F5F3FF] px-4 py-10">
			<div className="mx-auto max-w-md">
				<Link
					href="/"
					className="inline-flex items-center gap-2 text-sm font-medium text-[#2563EB] hover:text-[#1D4ED8] hover:underline"
				>
					← Volver al inicio
				</Link>

				<div className="mt-8 overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] shadow-xl shadow-[#2563EB]/10">
					<div className="border-b border-[#E2E8F0] bg-gradient-to-r from-[#2563EB] via-[#3B82F6] to-[#7C3AED] px-6 py-8 text-center text-white">
						<div className="relative mx-auto mb-4 h-20 w-20 overflow-hidden rounded-xl border-2 border-white/40 shadow-md shadow-[#1E40AF]/30">
							<Image
								src="/imagenes/Inicio/orientador.png"
								alt="Orientador"
								fill
								className="object-cover"
								sizes="80px"
							/>
						</div>
						<div className="mx-auto mb-2 flex w-fit items-center gap-2 rounded-full bg-white/15 px-3 py-1 text-xs font-semibold tracking-wide text-white/95 ring-1 ring-white/20">
							<IconoUsuario className="h-4 w-4" />
							Acceso orientador
						</div>
						<h1 className="text-xl font-bold">Panel administrativo</h1>
						<p className="mt-1 text-sm text-white/95">
							Credenciales administrativas del panel global
						</p>
					</div>

					<form onSubmit={enviar} className="space-y-4 bg-[#FFFFFF] p-6">
						<div>
							<label htmlFor="ori-email" className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[#1E293B]">
								<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#EFF6FF] text-[#2563EB]">
									<IconoCorreo className="h-4 w-4" />
								</span>
								Correo electrónico
							</label>
							<input
								id="ori-email"
								type="email"
								autoComplete="email"
								className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 text-[#1E293B] outline-none placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-2 focus:ring-[#DBEAFE]"
								value={email}
								onChange={(ev) => setEmail(ev.target.value)}
								disabled={cargando}
								required
							/>
						</div>
						<div>
							<label htmlFor="ori-pass" className="mb-1.5 flex items-center gap-2 text-sm font-medium text-[#1E293B]">
								<span className="flex h-7 w-7 items-center justify-center rounded-lg bg-[#F5F3FF] text-[#7C3AED]">
									<IconoCandado className="h-4 w-4" />
								</span>
								Contraseña
							</label>
							<input
								id="ori-pass"
								type="password"
								autoComplete="current-password"
								className="w-full rounded-xl border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2.5 text-[#1E293B] outline-none placeholder:text-[#94A3B8] focus:border-[#7C3AED] focus:ring-2 focus:ring-[#EDE9FE]"
								value={password}
								onChange={(ev) => setPassword(ev.target.value)}
								disabled={cargando}
								required
							/>
						</div>
						{error ? (
							<p className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600" role="alert">
								{error}
							</p>
						) : null}
						<button
							type="submit"
							disabled={cargando}
							className="w-full rounded-xl bg-gradient-to-r from-[#2563EB] to-[#4F46E5] py-3 font-semibold text-white shadow-md shadow-[#2563EB]/20 transition hover:from-[#1D4ED8] hover:to-[#4338CA] disabled:opacity-50"
						>
							{cargando ? "Entrando…" : "Entrar al panel"}
						</button>
					</form>
				</div>
			</div>
		</div>
	);
}
