"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import {
	IconoCandado,
	IconoCheck,
	IconoLlave,
	IconoUsuario,
} from "@/app/alumno/aida-iconos";
import { gradoEtiquetaParaVistaAlumno } from "@/lib/padron/grado-alumno";

type Paso = "cargando" | "clave" | "cuenta";
type AyudaModal = null | "nombre" | "contrasena";

export default function FlujoAlumno() {
	const router = useRouter();
	const [paso, setPaso] = useState<Paso>("cargando");
	const [grupo, setGrupo] = useState("");
	const [grado, setGrado] = useState("");
	const [clave, setClave] = useState("");
	const [nombreCompleto, setNombreCompleto] = useState("");
	const [password, setPassword] = useState("");
	const [errorClave, setErrorClave] = useState("");
	const [errorCuenta, setErrorCuenta] = useState("");
	const [cargando, setCargando] = useState(false);
	const [mostrarUsb, setMostrarUsb] = useState(false);
	const [ayudaModal, setAyudaModal] = useState<AyudaModal>(null);

	const claveYaValidada = paso === "cuenta";

	const inicializar = useCallback(async () => {
		setPaso("cargando");
		try {
			const rSesion = await fetch("/api/alumno/sesion", { credentials: "include" });
			if (rSesion.ok) {
				const s = (await rSesion.json()) as { autenticado?: boolean };
				if (s.autenticado) {
					router.replace("/alumno/panel");
					return;
				}
			}
			const rPaso = await fetch("/api/alumno/paso-clave", { credentials: "include" });
			const p = (await rPaso.json()) as {
				claveValidada?: boolean;
				grupo?: string;
				grado?: string;
				claveAcceso?: string;
			};
			if (p.claveValidada && p.grado && p.grupo) {
				setGrado(p.grado);
				if (p.claveAcceso) {
					setClave(p.claveAcceso);
				}
				setGrupo(p.grupo);
				setPaso("cuenta");
				return;
			}
		} catch {
			/* continuar a clave */
		}
		setPaso("clave");
	}, [router]);

	useEffect(() => {
		void inicializar();
	}, [inicializar]);

	useEffect(() => {
		if (!ayudaModal) {
			return;
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") {
				setAyudaModal(null);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [ayudaModal]);

	async function enviarClave(e: React.FormEvent) {
		e.preventDefault();
		setErrorClave("");
		setCargando(true);
		try {
			const res = await fetch("/api/alumno/validar-clave", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({ clave: clave.trim() }),
			});
			const data = (await res.json()) as {
				grupo?: string;
				grado?: string;
				error?: string;
			};
			if (!res.ok) {
				setErrorClave(data.error ?? "No se pudo validar la clave");
				return;
			}
			setGrado(data.grado ?? "");
			setGrupo(data.grupo ?? "");
			setPaso("cuenta");
		} catch {
			setErrorClave("Error de red. Intenta de nuevo.");
		} finally {
			setCargando(false);
		}
	}

	async function enviarCuenta(e: React.FormEvent) {
		e.preventDefault();
		if (!claveYaValidada) {
			return;
		}
		setErrorCuenta("");
		setMostrarUsb(false);
		setCargando(true);
		try {
			const res = await fetch("/api/alumno/acceso", {
				method: "POST",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					nombreCompleto: nombreCompleto.trim(),
					password,
				}),
			});
			const data = (await res.json()) as { code?: string; error?: string };
			if (!res.ok) {
				if (data.code === "PASSWORD_INVALID") {
					setMostrarUsb(true);
					return;
				}
				setErrorCuenta(data.error ?? "No se pudo completar el acceso");
				return;
			}
			router.replace("/alumno/panel");
		} catch {
			setErrorCuenta("Error de red. Intenta de nuevo.");
		} finally {
			setCargando(false);
		}
	}

	return (
		<div className="min-h-screen bg-[#FFFFFF] bg-gradient-to-br from-[#EFF6FF] via-[#FFFFFF] to-[#F5F3FF] px-4 py-8 sm:py-10 lg:py-12">
			<div className="mx-auto max-w-6xl">
				<Link
					href="/"
					className="inline-flex items-center gap-2.5 rounded-full border border-[#DBEAFE] bg-white/80 px-4 py-2 text-base font-semibold text-[#1D4ED8] shadow-sm transition hover:border-[#BFDBFE] hover:bg-white hover:text-[#1E40AF] sm:text-lg"
				>
					<span>Volver al inicio</span>
				</Link>
			</div>

			{paso === "cargando" && (
				<div className="fixed inset-0 z-40 flex items-center justify-center bg-[#1E293B]/25 backdrop-blur-[2px]">
					<div className="flex items-center gap-3 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] px-6 py-4 shadow-xl">
						<span
							className="h-6 w-6 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent"
							aria-hidden
						/>
						<span className="text-sm font-medium text-[#1E293B]">Cargando…</span>
					</div>
				</div>
			)}

			{paso !== "cargando" ? (
				<div className="mx-auto mt-6 max-w-6xl overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] shadow-xl shadow-[#2563EB]/10">
					{/* Cabecera a todo el ancho */}
					<div className="bg-gradient-to-r from-[#2563EB] via-[#3B82F6] to-[#7C3AED] px-6 py-8 text-white lg:px-10 lg:py-10">
						<div className="mx-auto max-w-4xl text-center">
							<h1 className="mt-3 text-3xl font-bold tracking-tight sm:text-4xl lg:text-5xl">
								Entra a tu expediente
							</h1>
							<p className="mx-auto mt-5 max-w-3xl text-base font-bold leading-relaxed text-white sm:text-lg lg:text-xl">
								Primero valida la clave que te dio el orientador; después podrás escribir tu nombre con mayúsculas y
								tu contraseña.
							</p>
						</div>
					</div>

					{/* Dos columnas en escritorio: clave | identidad */}
					<div className="grid grid-cols-1 bg-[#FFFFFF] lg:grid-cols-2 lg:gap-0">
						<section className="flex min-h-[min(420px,70vh)] flex-col justify-center border-b border-[#E2E8F0] p-6 sm:p-8 lg:min-h-[min(480px,72vh)] lg:border-b-0 lg:border-r lg:border-[#E2E8F0]">
							<div className="mx-auto flex w-full max-w-md flex-col items-center text-center lg:max-w-none">
								<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#DBEAFE] text-[#2563EB]">
									<IconoLlave className="h-5 w-5" />
								</span>
								<h2 className="mt-4 text-lg font-semibold text-[#1E293B]">Clave de acceso</h2>
								<p className="mt-1 text-sm text-[#64748B]">Identifica tu grupo en el sistema.</p>
								<form onSubmit={enviarClave} className="mt-5 w-full space-y-3 text-left">
										<label htmlFor="aida-clave" className="sr-only">
											Clave de acceso
										</label>
										<input
											id="aida-clave"
											type="text"
											autoComplete="off"
											readOnly={claveYaValidada}
											className={`w-full rounded-xl border px-4 py-3 font-mono text-base tracking-wide outline-none transition ${
												claveYaValidada
													? "cursor-default border-[#7C3AED]/35 bg-[#EDE9FE] text-[#5B21B6] shadow-inner"
													: "border-[#E2E8F0] bg-white text-[#1E293B] placeholder:text-[#64748B] focus:border-[#2563EB] focus:ring-2 focus:ring-[#DBEAFE]"
											}`}
											placeholder={
												claveYaValidada && !clave.trim()
													? "Clave validada"
													: "Escribe la clave"
											}
											value={clave}
											onChange={(e) => !claveYaValidada && setClave(e.target.value)}
											disabled={cargando && !claveYaValidada}
											aria-invalid={Boolean(errorClave)}
										/>
										{errorClave ? (
											<p className="text-sm font-medium text-red-600" role="alert">
												{errorClave}
											</p>
										) : null}
										{!claveYaValidada ? (
											<button
												type="submit"
												disabled={cargando || !clave.trim()}
												className="flex w-full items-center justify-center gap-2 rounded-xl bg-[#2563EB] py-3 text-sm font-semibold text-white shadow-md shadow-[#2563EB]/25 transition hover:bg-[#1D4ED8] disabled:opacity-50"
											>
												{cargando ? "Validando…" : "Validar clave"}
											</button>
										) : (
											<div className="flex flex-col gap-2 rounded-xl border border-[#7C3AED]/25 bg-[#F5F3FF] px-4 py-3 text-sm font-medium text-[#6D28D9] sm:flex-row sm:items-center">
												<IconoCheck className="h-5 w-5 shrink-0 text-[#7C3AED]" />
												<span>
													Clave correcta — ya puedes completar tus datos{" "}
													<span className="lg:hidden">abajo</span>
													<span className="hidden lg:inline">a la derecha</span>.
												</span>
											</div>
										)}
								</form>
							</div>
						</section>

						<section
							className={`relative flex min-h-[min(420px,70vh)] flex-col justify-center p-6 sm:p-8 lg:min-h-[min(480px,72vh)] ${!claveYaValidada ? "opacity-[0.42]" : ""} transition`}
						>
							{!claveYaValidada ? (
								<p className="pointer-events-none absolute inset-0 z-[1] flex items-center justify-center bg-[#F8FAFC]/85 p-6 text-center text-base font-medium leading-relaxed text-[#64748B] backdrop-blur-[2px] sm:text-lg lg:p-8">
									<span className="max-w-sm sm:max-w-md">
										Valida tu clave en el panel{" "}
										<span className="lg:hidden">de arriba</span>
										<span className="hidden lg:inline">izquierdo</span> para habilitar nombre y contraseña.
									</span>
								</p>
							) : null}
							<div
								className={`mx-auto flex w-full max-w-md flex-col items-center text-center lg:max-w-none ${!claveYaValidada ? "pointer-events-none" : ""}`}
							>
								<span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-xl bg-[#EDE9FE] text-[#7C3AED]">
									<IconoUsuario className="h-5 w-5" />
								</span>
								<h2 className="mt-4 text-xl font-semibold text-[#1E293B] sm:text-2xl">Tu identidad</h2>
								<p className="mt-2 max-w-lg text-base leading-relaxed text-[#64748B] sm:text-lg">
									Grado{" "}
									<span className="font-semibold text-[#1E293B]">
										{grado ? gradoEtiquetaParaVistaAlumno(grado) : "—"}
									</span>
									{" "}
									· Grupo <span className="font-semibold text-[#1E293B]">{grupo || "—"}</span>
									{" "}
									— escribe tu nombre tal como lo registró el orientador.
								</p>
								<form onSubmit={enviarCuenta} className="mt-5 w-full space-y-4 text-left">
									<div className="flex items-center gap-2.5">
										<span className="shrink-0 text-[#64748B]" title="Nombre completo">
											<IconoUsuario className="h-5 w-5" />
										</span>
										<label htmlFor="aida-nombre" className="sr-only">
											Nombre completo
										</label>
										<input
											id="aida-nombre"
											type="text"
											autoComplete="name"
											className="min-w-0 flex-1 rounded-xl border border-[#E2E8F0] bg-white px-4 py-3.5 text-base text-[#1E293B] outline-none placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-2 focus:ring-[#DBEAFE] disabled:bg-[#F1F5F9] sm:text-lg"
											placeholder="Nombre completo"
											value={nombreCompleto}
											onChange={(e) => setNombreCompleto(e.target.value)}
											disabled={cargando || !claveYaValidada}
										/>
										<button
											type="button"
											onClick={() => setAyudaModal("nombre")}
											className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#E2E8F0] bg-[#F8FAFC] text-base font-bold text-[#2563EB] outline-none transition hover:border-[#DBEAFE] hover:bg-[#EFF6FF] focus-visible:ring-2 focus-visible:ring-[#2563EB]/30"
											aria-label="Ayuda: cómo escribir tu nombre completo"
										>
											?
										</button>
									</div>
									<div className="flex items-center gap-2.5">
										<span className="shrink-0 text-[#64748B]" title="Contraseña">
											<IconoCandado className="h-5 w-5" />
										</span>
										<label htmlFor="aida-pass" className="sr-only">
											Contraseña
										</label>
										<input
											id="aida-pass"
											type="password"
											autoComplete="new-password"
											className="min-w-0 flex-1 rounded-xl border border-[#E2E8F0] bg-white px-4 py-3.5 text-base text-[#1E293B] outline-none placeholder:text-[#94A3B8] focus:border-[#2563EB] focus:ring-2 focus:ring-[#DBEAFE] disabled:bg-[#F1F5F9] sm:text-lg"
											placeholder="Contraseña "
											value={password}
											onChange={(e) => setPassword(e.target.value)}
											disabled={cargando || !claveYaValidada}
										/>
										<button
											type="button"
											onClick={() => setAyudaModal("contrasena")}
											className="pointer-events-auto flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-[#E2E8F0] bg-[#F8FAFC] text-base font-bold text-[#7C3AED] outline-none transition hover:border-[#EDE9FE] hover:bg-[#F5F3FF] focus-visible:ring-2 focus-visible:ring-[#7C3AED]/30"
											aria-label="Ayuda sobre tu contraseña"
										>
											?
										</button>
									</div>
									{errorCuenta ? (
										<p className="text-base font-medium text-red-600" role="alert">
											{errorCuenta}
										</p>
									) : null}
									<button
										type="submit"
										disabled={
											cargando || !claveYaValidada || !nombreCompleto.trim() || !password
										}
										className="w-full rounded-xl bg-gradient-to-r from-[#2563EB] to-[#4F46E5] py-3.5 text-base font-semibold text-white shadow-md shadow-[#2563EB]/20 transition hover:from-[#1D4ED8] hover:to-[#4338CA] disabled:opacity-50 sm:py-4 sm:text-lg"
									>
										{cargando ? "Entrando…" : "Entrar al panel"}
									</button>
								</form>
							</div>
						</section>
					</div>
				</div>
			) : null}

			{ayudaModal ? (
				<div
					className="fixed inset-0 z-[55] flex items-center justify-center bg-[#1E293B]/50 p-4 backdrop-blur-sm sm:p-6"
					role="presentation"
					onClick={() => setAyudaModal(null)}
				>
					<div
						className="w-full max-w-lg overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] shadow-2xl sm:max-w-xl"
						role="dialog"
						aria-modal="true"
						aria-labelledby="ayuda-titulo"
						aria-describedby="ayuda-texto"
						onClick={(e) => e.stopPropagation()}
					>
						<div
							className={`px-6 py-5 text-white sm:px-8 sm:py-6 ${
								ayudaModal === "nombre"
									? "bg-gradient-to-r from-[#2563EB] to-[#1D4ED8]"
									: "bg-gradient-to-r from-[#7C3AED] to-[#6D28D9]"
							}`}
						>
							<h2 id="ayuda-titulo" className="text-xl font-bold sm:text-2xl">
								{ayudaModal === "nombre" ? "Nombre completo" : "Tu contraseña"}
							</h2>
						</div>
						<div className="px-6 pb-6 pt-5 sm:px-8 sm:pb-8 sm:pt-6">
							<p
								id="ayuda-texto"
								className="text-base font-bold leading-relaxed text-[#1E293B] sm:text-lg md:text-xl"
							>
								{ayudaModal === "nombre" ? (
									<>
										Digita tu nombre completo por ejemplo{" "}
										<span className="font-extrabold text-[#1E293B]">Juan Fernandez Ortiz</span>.
									</>
								) : (
									<>
										Crea una contraseña pero anótala bien ya que no la puedes recuperar si se te olvida.
										Deberás ir a la escuela con una USB y tus archivos previamente escaneados.
									</>
								)}
							</p>
							<button
								type="button"
								className="mt-8 w-full rounded-xl bg-[#2563EB] py-3.5 text-base font-bold text-white transition hover:bg-[#1D4ED8] sm:mt-10 sm:py-4 sm:text-lg"
								onClick={() => setAyudaModal(null)}
							>
								Entendido
							</button>
						</div>
					</div>
				</div>
			) : null}

			{mostrarUsb && (
				<div className="fixed inset-0 z-[60] flex items-center justify-center bg-[#1E293B]/50 p-4 backdrop-blur-sm">
					<div
						className="w-full max-w-sm overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] shadow-2xl"
						role="alertdialog"
						aria-labelledby="usb-titulo"
						aria-describedby="usb-texto"
					>
						<div className="bg-gradient-to-r from-amber-500 to-orange-500 px-5 py-4 text-white">
							<h3 id="usb-titulo" className="text-lg font-semibold">
								Contraseña incorrecta
							</h3>
						</div>
						<div className="px-5 pb-5 pt-4">
							<p id="usb-texto" className="text-sm leading-relaxed text-[#1E293B]">
								Debes de asistir a la escuela con tus documentos en una USB.
							</p>
							<button
								type="button"
								className="mt-6 w-full rounded-xl bg-[#1E293B] py-3 text-sm font-semibold text-white transition hover:bg-[#334155]"
								onClick={() => setMostrarUsb(false)}
							>
								Entendido
							</button>
						</div>
					</div>
				</div>
			)}
		</div>
	);
}
