"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";
import { IconoCandado, IconoCorreo } from "@/app/alumno/aida-iconos";

export default function FlujoOrientador() {
	const router = useRouter();
	const [email, setEmail] = useState("");
	const [password, setPassword] = useState("");
	const [error, setError] = useState("");
	const [ok, setOk] = useState("");
	const [cargando, setCargando] = useState(false);

	async function enviar(e: React.FormEvent) {
		e.preventDefault();
		setError("");
		setOk("");
		setCargando(true);
		try {
			const res = await fetch("/api/orientador/acceso", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ email: email.trim(), password }),
			});
			const data = (await res.json()) as { error?: string; solicitudEnviada?: boolean; mensaje?: string };
			if (res.status === 202 && data.solicitudEnviada) {
				setOk(data.mensaje ?? "Solicitud enviada. Espera aprobación.");
				return;
			}
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
					className="inline-flex items-center gap-2.5 rounded-full border border-[#DBEAFE] bg-white/80 px-4 py-2 text-base font-semibold text-[#1D4ED8] shadow-sm transition hover:border-[#BFDBFE] hover:bg-white hover:text-[#1E40AF] sm:text-lg"
				>
					<span aria-hidden>←</span>
					<span>Volver al inicio</span>
				</Link>

				<div className="mt-8">
					<div className="overflow-visible rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-xl shadow-[#2563EB]/10">
						<div className="relative z-[1] flex items-end justify-between gap-3 overflow-visible px-6 pb-3 pt-5 sm:gap-4 sm:px-8 sm:pb-4 sm:pt-6">
							<h1 className="min-w-0 flex-1 self-center pr-2 text-left text-xl font-bold leading-tight text-[#1E293B] sm:text-2xl">
								Panel Orientador
							</h1>
							<div className="relative -mt-8 -mr-1 shrink-0 sm:-mt-14 sm:-mr-2 md:-mt-16 md:-mr-4 lg:-mt-[4.5rem]">
								<Image
									src="/imagenes/Inicio/orientador.png"
									alt="Orientador"
									width={384}
									height={384}
									priority
									className="h-44 w-44 object-contain drop-shadow-lg sm:h-56 sm:w-56 md:h-64 md:w-64 lg:h-72 lg:w-72"
									sizes="(max-width: 640px) 176px, (max-width: 768px) 224px, (max-width: 1024px) 256px, 288px"
								/>
							</div>
						</div>

						<form
							onSubmit={enviar}
							className="relative z-[2] -mt-2 space-y-4 px-6 pb-6 pt-2 sm:-mt-3 sm:px-8 sm:pb-6 sm:pt-3"
						>
              <div>
                <label
                  htmlFor="ori-email"
                  className="mb-1.5 flex items-center gap-2 text-base font-bold text-[#1E293B] sm:text-lg"
                >
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
                <label
                  htmlFor="ori-pass"
                  className="mb-1.5 flex items-center gap-2 text-base font-bold text-[#1E293B] sm:text-lg"
                >
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
								<p
									className="rounded-xl border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-600"
									role="alert"
								>
									{error}
								</p>
							) : null}
							{ok ? (
								<p
									className="rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-700"
									role="status"
								>
									{ok}
								</p>
							) : null}
							<button
								type="submit"
								disabled={cargando}
								className="w-full rounded-xl bg-gradient-to-r from-[#2563EB] to-[#4F46E5] py-3 font-semibold text-white shadow-md shadow-[#2563EB]/20 transition hover:from-[#1D4ED8] hover:to-[#4338CA] disabled:opacity-50"
							>
								{cargando ? "Enviando…" : "Iniciar o enviar solicitud"}
							</button>
						</form>
					</div>
				</div>
			</div>
		</div>
	);
}
