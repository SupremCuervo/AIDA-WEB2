"use client";

import { Fragment, useCallback, useEffect, useState } from "react";
import { IconoBasura, IconoDescargar, IconoDocumento, IconoSubir } from "@/app/alumno/aida-iconos";
import type { EstadoEntregaDocumentoUi } from "@/lib/alumno/estado-documento";
import {
	entradasFieldsOrdenadas,
	etiquetaCampoOcr,
	type CampoOcrCelda,
} from "@/lib/ocr/campos-ocr-vista";
import { TIPOS_DOCUMENTO, type TipoDocumentoClave } from "@/lib/nombre-archivo";
import { DURACION_MENSAJE_EMERGENTE_MS } from "@/lib/ui/duracion-mensaje-emergente-ms";
import { useRefrescarSesionAlumno } from "./PanelAlumnoContext";

const ACCEPT = ".pdf,.png,.jpg,.jpeg,.webp,application/pdf,image/png,image/jpeg,image/webp";

const ETIQUETAS_DOCUMENTO: Record<TipoDocumentoClave, string> = {
	acta_nacimiento: "Acta de nacimiento",
	curp: "CURP",
	ine_tutor: "INE del tutor",
	comprobante_domicilio: "Comprobante de domicilio",
	certificado_medico: "Certificado médico",
};

const MENSAJE_OK_DOCUMENTO_ELIMINADO = "Documento eliminado correctamente.";

/** Campos sugeridos si aún no hubo OCR (el alumno puede completarlos a mano). */
const PLANTILLA_CAMPOS_VACIOS: Record<TipoDocumentoClave, string[]> = {
	acta_nacimiento: ["nombre", "fecha_nacimiento", "folio", "padre", "madre"],
	curp: ["curp", "nombre", "fecha_nacimiento"],
	ine_tutor: ["nombre_tutor", "clave_elector", "vigencia", "direccion"],
	comprobante_domicilio: ["nombre_titular", "direccion"],
	certificado_medico: ["nombre_alumno", "cedula_profesional"],
};

function clavesFormularioDatosDoc(f: FilaDocumentoApi): string[] {
	const deOcr = f.ocrCampos ? Object.keys(f.ocrCampos) : [];
	const plantilla = PLANTILLA_CAMPOS_VACIOS[f.tipo] ?? [];
	const u = new Set<string>([...deOcr, ...plantilla]);
	return [...u].sort((a, b) => a.localeCompare(b, "es"));
}

function filaTieneSeccionDatos(f: FilaDocumentoApi): boolean {
	return f.puedeDescargar && clavesFormularioDatosDoc(f).length > 0;
}

function borradorDesdeFila(f: FilaDocumentoApi): Record<string, string> {
	const keys = clavesFormularioDatosDoc(f);
	const m: Record<string, string> = {};
	for (const k of keys) {
		m[k] = f.ocrCampos?.[k]?.value ?? "";
	}
	return m;
}

type FilaDocumentoApi = {
	tipo: TipoDocumentoClave;
	etiqueta: string;
	estado: EstadoEntregaDocumentoUi;
	motivoRechazo: string | null;
	puedeDescargar: boolean;
	validacionAutomatica: boolean;
	ocrCampos: Record<string, CampoOcrCelda> | null;
	ocrTramite: string | null;
	ocrExtraidoEn: string | null;
	ocrError: string | null;
};

function filaPorDefecto(tipo: TipoDocumentoClave): FilaDocumentoApi {
	return {
		tipo,
		etiqueta: ETIQUETAS_DOCUMENTO[tipo],
		estado: "pendiente_carga",
		motivoRechazo: null,
		puedeDescargar: false,
		validacionAutomatica: false,
		ocrCampos: null,
		ocrTramite: null,
		ocrExtraidoEn: null,
		ocrError: null,
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
			return f.motivoRechazo
				? `Rechazado (${f.motivoRechazo})`
				: "Rechazado";
		default:
			return f.estado;
	}
}

function clasesEstatus(estado: EstadoEntregaDocumentoUi): string {
	switch (estado) {
		case "validado":
			/* Verde azulado (aceptado) */
			return "bg-teal-50 text-teal-900 ring-teal-200";
		case "rechazado":
			return "bg-red-50 text-red-900 ring-red-200";
		case "pendiente_revision_manual":
			/* Morado: archivo subido, pendiente revisión */
			return "bg-[#F5F3FF] text-[#6D28D9] ring-[#EDE9FE]";
		default:
			/* Azul: sin subir */
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
	const [borradoresOcr, setBorradoresOcr] = useState<
		Partial<Record<TipoDocumentoClave, Record<string, string>>>
	>({});
	const [guardandoOcrTipo, setGuardandoOcrTipo] = useState<TipoDocumentoClave | null>(null);

	const cargarTabla = useCallback(async () => {
		setCargandoTabla(true);
		try {
			const res = await fetch("/api/alumno/documentos", { credentials: "include" });
			const data = (await res.json()) as { documentos?: FilaDocumentoApi[]; error?: string };
			if (!res.ok) {
				setMensaje({ tipo: "error", texto: data.error ?? "No se pudieron cargar los documentos" });
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
		setBorradoresOcr(() => {
			const next: Partial<Record<TipoDocumentoClave, Record<string, string>>> = {};
			for (const f of filas) {
				if (!filaTieneSeccionDatos(f)) {
					continue;
				}
				next[f.tipo] = borradorDesdeFila(f);
			}
			return next;
		});
	}, [filas]);

	useEffect(() => {
		if (!mensaje) {
			return;
		}
		const id = window.setTimeout(() => setMensaje(null), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [mensaje]);

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
			await refrescarSesion();
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
		void enviarArchivo(tipo, file);
	}

	async function eliminarDocumento(tipo: TipoDocumentoClave) {
		const etiqueta = ETIQUETAS_DOCUMENTO[tipo];
		if (
			typeof window !== "undefined" &&
			!window.confirm(
				`¿Eliminar “${etiqueta}”? Se borrará el archivo subido y volverá a estado pendiente.`,
			)
		) {
			return;
		}
		setMensaje(null);
		setEliminando(tipo);
		try {
			const res = await fetch(`/api/alumno/documento?tipo=${encodeURIComponent(tipo)}`, {
				method: "DELETE",
				credentials: "include",
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setMensaje({ tipo: "error", texto: data.error ?? "No se pudo eliminar el documento" });
				return;
			}
			setMensaje({ tipo: "ok", texto: MENSAJE_OK_DOCUMENTO_ELIMINADO });
			await refrescarSesion();
			await cargarTabla();
		} catch {
			setMensaje({ tipo: "error", texto: "Error de red. Intenta de nuevo." });
		} finally {
			setEliminando(null);
		}
	}

	function actualizarValorOcr(tipo: TipoDocumentoClave, clave: string, valor: string) {
		setBorradoresOcr((prev) => ({
			...prev,
			[tipo]: {
				...(prev[tipo] ?? {}),
				[clave]: valor,
			},
		}));
	}

	async function guardarDatosOcr(tipo: TipoDocumentoClave) {
		const draft = borradoresOcr[tipo];
		if (!draft || Object.keys(draft).length === 0) {
			setMensaje({ tipo: "error", texto: "No hay datos que guardar." });
			return;
		}
		setMensaje(null);
		setGuardandoOcrTipo(tipo);
		try {
			const res = await fetch("/api/alumno/documentos", {
				method: "PATCH",
				credentials: "include",
				headers: { "Content-Type": "application/json" },
				body: JSON.stringify({ tipoDocumento: tipo, campos: draft }),
			});
			const data = (await res.json()) as { error?: string };
			if (!res.ok) {
				setMensaje({ tipo: "error", texto: data.error ?? "No se pudieron guardar los datos" });
				return;
			}
			setMensaje({ tipo: "ok", texto: "Datos guardados correctamente." });
			await cargarTabla();
		} catch {
			setMensaje({ tipo: "error", texto: "Error de red al guardar." });
		} finally {
			setGuardandoOcrTipo(null);
		}
	}

	const hayAlgunaSeccionDatos = filas.some((f) => filaTieneSeccionDatos(f));

	return (
		<section className="relative overflow-hidden rounded-2xl border border-[#E2E8F0] bg-[#FFFFFF] shadow-xl shadow-[#2563EB]/10">
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
										backgroundImage: "linear-gradient(90deg, #7C3AED 0%, #5B21B6 50%, #2563EB 100%)",
									}}
								>
									<th className="whitespace-nowrap px-4 py-3.5 text-xs font-semibold uppercase tracking-wide text-white sm:px-5">
										Documento
									</th>
									<th className="whitespace-nowrap px-4 py-3.5 text-xs font-semibold uppercase tracking-wide text-white sm:px-5">
										Estatus
									</th>
									<th className="whitespace-nowrap px-4 py-3.5 text-xs font-semibold uppercase tracking-wide text-white sm:px-5">
										OCR
									</th>
									<th className="whitespace-nowrap px-4 py-3.5 text-xs font-semibold uppercase tracking-wide text-white sm:px-5">
										Acción
									</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-[#E2E8F0] bg-[#FFFFFF]">
								{cargandoTabla ? (
									<tr>
										<td colSpan={4} className="px-5 py-12 text-center text-[#64748B]">
											<span className="inline-flex items-center gap-2">
												<span className="h-4 w-4 animate-spin rounded-full border-2 border-[#2563EB] border-t-transparent" />
												Cargando documentos…
											</span>
										</td>
									</tr>
								) : (
									(Object.keys(TIPOS_DOCUMENTO) as TipoDocumentoClave[]).map((tipo) => {
										const f = filas.find((row) => row.tipo === tipo) ?? filaPorDefecto(tipo);
										const nCamposOcr =
											f.ocrCampos != null ? Object.keys(f.ocrCampos).length : 0;
										const hayDatosAbajo = filaTieneSeccionDatos(f);
										return (
											<Fragment key={tipo}>
												<tr className="transition-colors hover:bg-[#EFF6FF]/50">
													<td className="px-4 py-4 align-middle sm:px-5">
														<span className="flex items-center gap-2 font-medium text-[#1E293B]">
															<IconoDocumento className="h-4 w-4 shrink-0 text-[#64748B]" />
															{f.etiqueta}
														</span>
													</td>
													<td className="px-4 py-4 align-middle sm:px-5">
														<span
															className={`inline-flex max-w-[min(100%,280px)] items-center gap-1.5 rounded-full px-3 py-1.5 text-xs font-medium ring-1 ${clasesEstatus(f.estado)}`}
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
													<td className="max-w-[200px] px-4 py-4 align-middle text-xs text-[#475569] sm:px-5">
														{!f.puedeDescargar ? (
															<span className="text-[#94A3B8]">—</span>
														) : hayDatosAbajo ? (
															<a
																href={`#datos-doc-${tipo}`}
																className="font-medium text-[#2563EB] underline decoration-[#2563EB]/30 hover:decoration-[#2563EB]"
															>
																{nCamposOcr > 0
																	? `${nCamposOcr} campo${nCamposOcr === 1 ? "" : "s"}`
																	: "Completar abajo"}
																{f.ocrError ? " · aviso" : ""}
															</a>
														) : (
															<span className="text-[#94A3B8]" title="Sube un archivo primero">
																—
															</span>
														)}
													</td>
													<td className="px-4 py-4 align-middle sm:px-5">
													<div className="flex flex-wrap items-center gap-2">
														<label className="inline-flex cursor-pointer">
															<input
																type="file"
																accept={ACCEPT}
																className="sr-only"
																disabled={subiendo !== null || eliminando !== null}
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
																disabled={subiendo !== null || eliminando !== null}
																onClick={() => void eliminarDocumento(tipo)}
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
																href={`/api/alumno/documento/descargar?tipo=${encodeURIComponent(tipo)}`}
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
											</Fragment>
										);
									})
								)}
							</tbody>
						</table>
					</div>
				</div>

				{hayAlgunaSeccionDatos ? (
					<div className="mt-10 border-t border-[#E2E8F0] pt-8">
						<h3 className="text-center text-lg font-bold text-[#1E293B]">Datos de tus documentos</h3>
						<p className="mx-auto mt-2 max-w-2xl text-center text-sm text-[#64748B]">
							Los valores suelen rellenarse solos al subir el archivo (OCR). Revísalos, corrígelos si hace falta y
							pulsa <strong className="font-semibold text-[#475569]">Guardar datos</strong> en cada documento.
						</p>
						<div className="mt-6 space-y-6">
							{filas
								.filter((f) => filaTieneSeccionDatos(f))
								.map((f) => {
									const draft = borradoresOcr[f.tipo] ?? borradorDesdeFila(f);
									const ordenadas = entradasFieldsOrdenadas(
										Object.fromEntries(
											Object.keys(draft).map((k) => [
												k,
												{
													value: draft[k],
													confidence: f.ocrCampos?.[k]?.confidence,
												} satisfies CampoOcrCelda,
											]),
										),
									);
									return (
										<div
											key={f.tipo}
											id={`datos-doc-${f.tipo}`}
											className="scroll-mt-24 rounded-2xl border border-[#E2E8F0] bg-[#F8FAFC] p-5 shadow-sm sm:p-6"
										>
											<div className="flex flex-wrap items-start justify-between gap-3 border-b border-[#E2E8F0] pb-4">
												<div>
													<h4 className="text-base font-bold text-[#0F172A]">{f.etiqueta}</h4>
													{f.ocrTramite ? (
														<p className="mt-1 text-xs text-[#64748B]">
															Trámite OCR:{" "}
															<span className="font-mono text-[#334155]">{f.ocrTramite}</span>
															{f.ocrExtraidoEn ? (
																<>
																	{" "}
																	· {new Date(f.ocrExtraidoEn).toLocaleString("es-MX")}
																</>
															) : null}
														</p>
													) : null}
													{f.ocrError ? (
														<p className="mt-2 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-xs text-amber-900">
															Extracción automática: {f.ocrError}. Puedes escribir o corregir los datos
															abajo.
														</p>
													) : null}
												</div>
												<button
													type="button"
													disabled={
														guardandoOcrTipo !== null ||
														subiendo !== null ||
														eliminando !== null
													}
													onClick={() => void guardarDatosOcr(f.tipo)}
													className="shrink-0 rounded-xl border border-[#7C3AED] bg-[#7C3AED] px-5 py-2.5 text-sm font-semibold text-white shadow-md transition hover:bg-[#6D28D9] disabled:cursor-not-allowed disabled:opacity-50"
												>
													{guardandoOcrTipo === f.tipo ? "Guardando…" : "Guardar datos"}
												</button>
											</div>
											<div className="mt-4 grid gap-4 sm:grid-cols-2">
												{ordenadas.map((row) => (
													<label key={row.clave} className="flex flex-col gap-1.5">
														<span className="text-xs font-semibold text-[#475569]">
															{etiquetaCampoOcr(row.clave)}
															{row.conf ? (
																<span className="ml-1 font-normal text-[#94A3B8]">({row.conf})</span>
															) : null}
														</span>
														<input
															type="text"
															value={draft[row.clave] ?? ""}
															onChange={(e) =>
																actualizarValorOcr(f.tipo, row.clave, e.target.value)
															}
															className="rounded-xl border border-[#D1D5DB] bg-white px-3 py-2.5 text-sm text-[#111827] outline-none focus:border-[#7C3AED] focus:ring-2 focus:ring-[#EDE9FE]"
															autoComplete="off"
														/>
													</label>
												))}
											</div>
										</div>
									);
								})}
						</div>
					</div>
				) : null}
			</div>
		</section>
	);
}
