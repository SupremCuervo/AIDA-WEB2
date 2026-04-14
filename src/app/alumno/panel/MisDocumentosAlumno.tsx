"use client";

import { useCallback, useEffect, useState } from "react";
import { IconoBasura, IconoDescargar, IconoDocumento, IconoSubir } from "@/app/alumno/aida-iconos";
import type { EstadoEntregaDocumentoUi } from "@/lib/alumno/estado-documento";
import {
	esTipoArchivoSubidaAlumnoOk,
	normalizarArchivoSubidaAlumnoAPdf,
} from "@/lib/alumno/subida-documento-archivo";
import { MENSAJE_TIPO_ARCHIVO_NO_PERMITIDO } from "@/lib/alumno/subida-documento-mensajes";
import { TIPOS_DOCUMENTO, type TipoDocumentoClave } from "@/lib/nombre-archivo";
import { DURACION_MENSAJE_EMERGENTE_MS } from "@/lib/ui/duracion-mensaje-emergente-ms";
import { useRefrescarSesionAlumno } from "./PanelAlumnoContext";

const ACCEPT =
	".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

const ETIQUETAS_DOCUMENTO: Record<TipoDocumentoClave, string> = {
	acta_nacimiento: "Acta de nacimiento",
	curp: "CURP",
	ine_tutor: "INE del tutor",
	comprobante_domicilio: "Comprobante de domicilio",
	certificado_medico: "Certificado médico",
};

const MENSAJE_OK_DOCUMENTO_ELIMINADO = "Documento eliminado correctamente.";

type FilaDocumentoApi = {
	tipo: TipoDocumentoClave;
	etiqueta: string;
	estado: EstadoEntregaDocumentoUi;
	motivoRechazo: string | null;
	puedeDescargar: boolean;
	validacionAutomatica: boolean;
};

function filaPorDefecto(tipo: TipoDocumentoClave): FilaDocumentoApi {
	return {
		tipo,
		etiqueta: ETIQUETAS_DOCUMENTO[tipo],
		estado: "pendiente_carga",
		motivoRechazo: null,
		puedeDescargar: false,
		validacionAutomatica: false,
	};
}

function textoEstatus(f: FilaDocumentoApi): string {
	switch (f.estado) {
		case "pendiente_carga":
			return "Pendiente de carga";
		case "pendiente_revision_manual":
			return "Pendiente de revisión manual";
		case "validado":
			return "Validado";
		case "rechazado":
			return f.motivoRechazo ? `Rechazado (${f.motivoRechazo})` : "Rechazado";
		default:
			return f.estado;
	}
}

function clasesEstatus(estado: EstadoEntregaDocumentoUi): string {
	switch (estado) {
		case "validado":
			return "bg-teal-50 text-teal-900 ring-teal-200";
		case "rechazado":
			return "bg-red-50 text-red-900 ring-red-200";
		case "pendiente_revision_manual":
			return "bg-[#F5F3FF] text-[#6D28D9] ring-[#EDE9FE]";
		default:
			return "bg-[#EFF6FF] text-[#1D4ED8] ring-[#DBEAFE]";
	}
}

export default function MisDocumentosAlumno() {
	const refrescarSesion = useRefrescarSesionAlumno();
	const [filas, setFilas] = useState<FilaDocumentoApi[]>([]);
	const [cargandoTabla, setCargandoTabla] = useState(true);
	const [subiendo, setSubiendo] = useState<TipoDocumentoClave | null>(null);
	const [eliminando, setEliminando] = useState<TipoDocumentoClave | null>(null);
	const [mensaje, setMensaje] = useState<{ tipo: "ok" | "error"; texto: string } | null>(null);
	const [confirmarEliminar, setConfirmarEliminar] = useState<{
		tipo: TipoDocumentoClave;
		etiqueta: string;
	} | null>(null);

	const cargarTabla = useCallback(async () => {
		setCargandoTabla(true);
		try {
			const res = await fetch("/api/alumno/documentos", { credentials: "include" });
			const data = (await res.json()) as { documentos?: FilaDocumentoApi[]; error?: string };
			if (!res.ok) {
				setMensaje({
					tipo: "error",
					texto: data.error ?? "No se pudieron cargar los documentos",
				});
				setFilas([]);
				return;
			}
			setFilas(data.documentos ?? []);
		} catch {
			setMensaje({ tipo: "error", texto: "Error de red al cargar documentos." });
			setFilas([]);
		} finally {
			setCargandoTabla(false);
		}
	}, []);

	useEffect(() => {
		void cargarTabla();
	}, [cargarTabla]);

	useEffect(() => {
		if (!mensaje) {
			return;
		}
		const id = window.setTimeout(() => setMensaje(null), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [mensaje]);

	useEffect(() => {
		if (!confirmarEliminar) {
			return;
		}
		function onKey(e: KeyboardEvent) {
			if (e.key === "Escape") {
				setConfirmarEliminar(null);
			}
		}
		window.addEventListener("keydown", onKey);
		return () => window.removeEventListener("keydown", onKey);
	}, [confirmarEliminar]);

	async function enviarArchivo(tipo: TipoDocumentoClave, file: File) {
		setMensaje(null);
		setSubiendo(tipo);
		try {
			const fd = new FormData();
			fd.set("tipoDocumento", tipo);
			fd.set("archivo", file);
			const res = await fetch("/api/alumno/subir-documento", {
				method: "POST",
				body: fd,
				credentials: "include",
			});
			const raw = await res.text();
			let data: { error?: string } = {};
			try {
				data = raw ? (JSON.parse(raw) as { error?: string }) : {};
			} catch {
				data = {};
			}
			if (!res.ok) {
				const texto =
					data.error ??
					(res.status === 504 || res.status === 408
						? "La subida tardó demasiado (tiempo agotado). Prueba con un archivo más pequeño o de nuevo más tarde."
						: raw && raw.length < 280 && !raw.trimStart().startsWith("<")
							? raw
							: "No se pudo subir el archivo");
				setMensaje({ tipo: "error", texto });
				return;
			}
			setMensaje({ tipo: "ok", texto: "Documento actualizado correctamente." });
			void refrescarSesion();
			await cargarTabla();
		} catch {
			setMensaje({ tipo: "error", texto: "Error de red. Intenta de nuevo." });
		} finally {
			setSubiendo(null);
		}
	}

	function alElegirArchivo(tipo: TipoDocumentoClave, e: React.ChangeEvent<HTMLInputElement>) {
		const input = e.target;
		const file = input.files?.[0];
		input.value = "";
		if (!file) {
			return;
		}
		if (!esTipoArchivoSubidaAlumnoOk(file)) {
			setMensaje({ tipo: "error", texto: MENSAJE_TIPO_ARCHIVO_NO_PERMITIDO });
			return;
		}
		void (async () => {
			setSubiendo(tipo);
			let archivoEnvio: File;
			try {
				archivoEnvio = await normalizarArchivoSubidaAlumnoAPdf(file);
			} catch {
				setSubiendo(null);
				setMensaje({
					tipo: "error",
					texto: "No se pudo preparar el archivo. Prueba con otro PDF o imagen.",
				});
				return;
			}
			await enviarArchivo(tipo, archivoEnvio);
		})();
	}

	async function ejecutarEliminacionDocumento(tipo: TipoDocumentoClave) {
		setMensaje(null);
		setEliminando(tipo);
		try {
			const res = await fetch(`/api/alumno/documento?tipo=${encodeURIComponent(tipo)}`, {
				method: "DELETE",
				credentials: "include",
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setMensaje({
					tipo: "error",
					texto: data.error ?? "No se pudo eliminar el documento",
				});
				return;
			}
			setMensaje({ tipo: "ok", texto: MENSAJE_OK_DOCUMENTO_ELIMINADO });
			void refrescarSesion();
			await cargarTabla();
		} catch {
			setMensaje({ tipo: "error", texto: "Error de red. Intenta de nuevo." });
		} finally {
			setEliminando(null);
		}
	}

	return (
		<section className="relative overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-xl shadow-[#2563EB]/10">
			{confirmarEliminar ? (
				<div
					className="fixed inset-0 z-[100] flex items-center justify-center bg-[#0F172A]/55 p-4 backdrop-blur-[2px]"
					role="presentation"
					onClick={() => setConfirmarEliminar(null)}
				>
					<div
						className="w-full max-w-md rounded-2xl border border-[#E2E8F0] bg-white p-6 shadow-2xl sm:p-8"
						role="dialog"
						aria-modal="true"
						aria-labelledby="confirmar-eliminar-titulo"
						onClick={(ev) => ev.stopPropagation()}
					>
						<h2
							id="confirmar-eliminar-titulo"
							className="text-lg font-semibold text-[#1E293B] sm:text-xl"
						>
							¿Eliminar documento?
						</h2>
						<p className="mt-3 text-sm leading-relaxed text-[#64748B] sm:text-base">
							¿Eliminar «{confirmarEliminar.etiqueta}»? Se borrará el archivo subido y volverá a estado pendiente.
						</p>
						<div className="mt-6 flex flex-col-reverse gap-3 sm:flex-row sm:justify-end">
							<button
								type="button"
								className="rounded-xl border-2 border-[#2563EB] bg-[#EFF6FF] px-5 py-2.5 text-sm font-semibold text-[#1D4ED8] transition hover:bg-[#DBEAFE] sm:text-base"
								onClick={() => setConfirmarEliminar(null)}
							>
								No
							</button>
							<button
								type="button"
								className="rounded-xl border-2 border-[#7C3AED] bg-[#F5F3FF] px-5 py-2.5 text-sm font-semibold text-[#5B21B6] transition hover:bg-[#EDE9FE] sm:text-base"
								onClick={() => {
									const t = confirmarEliminar.tipo;
									setConfirmarEliminar(null);
									void ejecutarEliminacionDocumento(t);
								}}
							>
								Sí
							</button>
						</div>
					</div>
				</div>
			) : null}
			<div className="p-5 sm:p-8">
				{mensaje ? (
					<div
						className={`mt-4 rounded-xl border px-4 py-3 text-sm ${
							mensaje.tipo === "ok"
								? "border-teal-200 bg-teal-50 text-teal-900"
								: "border-red-200 bg-red-50 text-red-900"
						}`}
						role="status"
					>
						{mensaje.texto}
					</div>
				) : null}

				<div className="mt-6 overflow-hidden rounded-xl border border-[#E2E8F0] bg-[#F8FAFC]">
					<div className="overflow-x-auto">
						<table className="w-full min-w-[min(100%,720px)] border-collapse text-left text-sm">
							<thead>
								<tr
									className="border-b border-white/25 shadow-[inset_0_-1px_0_rgba(255,255,255,0.12)]"
									style={{
										backgroundImage:
											"linear-gradient(90deg, #7C3AED 0%, #5B21B6 50%, #2563EB 100%)",
									}}
								>
									<th className="whitespace-nowrap px-4 py-3.5 text-xs font-semibold uppercase tracking-wide text-white sm:px-5">
										Documento
									</th>
									<th className="whitespace-nowrap px-4 py-3.5 text-xs font-semibold uppercase tracking-wide text-white sm:px-5">
										Estatus
									</th>
									<th className="whitespace-nowrap px-4 py-3.5 text-xs font-semibold uppercase tracking-wide text-white sm:px-5">
										Acción
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[#E2E8F0] bg-[#FFFFFF]">
								{cargandoTabla ? (
									<tr>
										<td colSpan={3} className="px-5 py-12 text-center text-[#64748B]">
											<span className="inline-flex items-center gap-2">
												<span className="h-4 w-4 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
												Cargando documentos…
											</span>
										</td>
									</tr>
								) : (
									(Object.keys(TIPOS_DOCUMENTO) as TipoDocumentoClave[]).map((tipo) => {
										const f =
											filas.find((row) => row.tipo === tipo) ?? filaPorDefecto(tipo);
										return (
											<tr key={tipo} className="transition-colors hover:bg-[#EFF6FF]/50">
												<td className="px-4 py-4 align-middle sm:px-5">
													<span className="flex items-center gap-2 font-medium text-[#1E293B]">
														<IconoDocumento className="h-4 w-4 shrink-0 text-[#64748B]" />
														{f.etiqueta}
													</span>
												</td>
												<td className="px-4 py-4 align-middle sm:px-5">
													<span
														className={`inline-flex max-w-[min(100%,280px)] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${clasesEstatus(
															f.estado,
														)}`}
													>
														{f.estado === "validado" ? (
															<span className="text-teal-600" aria-hidden>
																✓
															</span>
														) : null}
														{f.estado === "rechazado" ? (
															<span className="text-red-600" aria-hidden>
																✕
															</span>
														) : null}
														<span className="break-words">{textoEstatus(f)}</span>
													</span>
												</td>
												<td className="px-4 py-4 align-middle sm:px-5">
													<div className="flex flex-wrap items-center gap-2">
														<label className="inline-flex cursor-pointer">
															<input
																type="file"
																accept={ACCEPT}
																className="sr-only"
																disabled={
																	subiendo !== null || eliminando !== null
																}
																onChange={(ev) => alElegirArchivo(tipo, ev)}
															/>
															<span
																className={`inline-flex items-center gap-1.5 rounded-lg bg-[#2563EB] px-3 py-2 text-xs font-semibold text-white shadow-md shadow-[#2563EB]/20 transition hover:bg-[#1D4ED8] sm:text-sm ${
																	subiendo !== null || eliminando !== null
																		? "pointer-events-none opacity-50"
																		: ""
																}`}
															>
																<IconoSubir className="h-4 w-4" />
																{subiendo === tipo ? "Subiendo…" : "Subir"}
															</span>
														</label>
														{f.puedeDescargar ? (
															<button
																type="button"
																disabled={
																	subiendo !== null || eliminando !== null
																}
																onClick={() =>
																	setConfirmarEliminar({
																		tipo,
																		etiqueta: f.etiqueta,
																	})
																}
																className={`inline-flex items-center gap-1.5 rounded-lg border border-red-200 bg-red-50 px-3 py-2 text-xs font-semibold text-red-800 shadow-sm transition hover:border-red-300 hover:bg-red-100 sm:text-sm ${
																	eliminando === tipo ? "opacity-70" : ""
																} disabled:cursor-not-allowed disabled:opacity-50`}
															>
																<IconoBasura className="h-4 w-4 shrink-0" />
																{eliminando === tipo ? "Eliminando…" : "Eliminar"}
															</button>
														) : null}
														{f.puedeDescargar ? (
															<a
																href={`/api/alumno/documento/descargar?tipo=${encodeURIComponent(
																	tipo,
																)}`}
																className={`inline-flex items-center gap-1.5 rounded-lg border border-[#E2E8F0] bg-[#F8FAFC] px-3 py-2 text-xs font-semibold text-[#1E293B] shadow-sm transition hover:border-[#CBD5E1] hover:bg-white sm:text-sm ${
																	subiendo !== null || eliminando !== null
																		? "pointer-events-none opacity-50"
																		: ""
																}`}
																download
															>
																<IconoDescargar className="h-4 w-4 text-[#2563EB]" />
																Descargar
															</a>
														) : (
															<span
																className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-lg border border-dashed border-[#E2E8F0] px-3 py-2 text-xs text-[#94A3B8] sm:text-sm"
																title="Disponible cuando ya subiste un archivo"
															>
																<IconoDescargar className="h-4 w-4 opacity-50" />
																Descargar
															</span>
														)}
													</div>
												</td>
											</tr>
										);
									})
								)}
							</tbody>
						</table>
					</div>
				</div>
			</div>
		</section>
	);
}
