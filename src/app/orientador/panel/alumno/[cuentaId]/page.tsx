"use client";

import Link from "next/link";
import { useParams } from "next/navigation";
import { Fragment, useCallback, useEffect, useState } from "react";
import { DURACION_MENSAJE_EMERGENTE_MS } from "@/lib/ui/duracion-mensaje-emergente-ms";
import type { EstadoEntregaDocumentoUi } from "@/lib/alumno/estado-documento";
import { GRADO_ESCOLAR_MAX } from "@/lib/padron/grado-alumno";
import {
	entradasFieldsOrdenadas,
	type CampoOcrCelda,
} from "@/lib/ocr/campos-ocr-vista";
import type { TipoDocumentoClave } from "@/lib/nombre-archivo";

const TIPOS_DESCARGA_EXP: { tipo: TipoDocumentoClave; etiqueta: string }[] = [
	{ tipo: "acta_nacimiento", etiqueta: "Acta de nacimiento" },
	{ tipo: "curp", etiqueta: "CURP" },
	{ tipo: "ine_tutor", etiqueta: "INE del tutor" },
	{ tipo: "comprobante_domicilio", etiqueta: "Comprobante de domicilio" },
	{ tipo: "certificado_medico", etiqueta: "Certificado médico" },
];

type DocFila = {
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

type CarreraCat = { id: string; codigo: string; nombre: string };

type AlumnoInfo = {
	cuentaId: string;
	padronId: string;
	grupoTokenId: string;
	nombreCompleto: string;
	/** Grado único que ve expediente y alumno (resuelto desde padrón o enlace). */
	grado: string;
	gradoToken: string;
	gradoAlumno: string | null;
	grupo: string;
	requiereCarrera: boolean;
	carreraId: string | null;
	carreraNombre: string | null;
	carreraCodigo: string | null;
	matricula: string | null;
};

function textoEstado(e: EstadoEntregaDocumentoUi, motivo: string | null): string {
	switch (e) {
		case "pendiente_carga":
			return "Pendiente de carga";
		case "pendiente_revision_manual":
			return "Pendiente de revisión manual";
		case "validado":
			return "Validado";
		case "rechazado":
			return motivo ? `Rechazado (${motivo})` : "Rechazado";
		default:
			return e;
	}
}

export default function OrientadorExpedientePage() {
	const params = useParams();
	const cuentaId = typeof params.cuentaId === "string" ? params.cuentaId : "";

	const [alumno, setAlumno] = useState<AlumnoInfo | null>(null);
	const [documentos, setDocumentos] = useState<DocFila[]>([]);
	const [cargando, setCargando] = useState(true);
	const [error, setError] = useState("");
	const [mensaje, setMensaje] = useState<{ ok: boolean; t: string } | null>(null);
	const [subiendo, setSubiendo] = useState<TipoDocumentoClave | null>(null);
	const [gradoSeleccion, setGradoSeleccion] = useState<string>("__token__");
	const [gradoGuardando, setGradoGuardando] = useState(false);
	const [carrerasCatalogo, setCarrerasCatalogo] = useState<CarreraCat[]>([]);
	const [carreraSeleccion, setCarreraSeleccion] = useState<string>("__sin__");
	const [matriculaExpediente, setMatriculaExpediente] = useState("");
	const [carreraGuardando, setCarreraGuardando] = useState(false);
	const [tipoDescargaRapida, setTipoDescargaRapida] = useState<TipoDocumentoClave>("acta_nacimiento");
	const [ocrExpandido, setOcrExpandido] = useState<TipoDocumentoClave | null>(null);

	const cargar = useCallback(async () => {
		if (!cuentaId) {
			return;
		}
		setCargando(true);
		setError("");
		try {
			const res = await fetch(`/api/orientador/expediente/${cuentaId}`, {
				credentials: "include",
			});
			const data = (await res.json()) as {
				alumno?: AlumnoInfo;
				carrerasCatalogo?: CarreraCat[];
				documentos?: DocFila[];
				error?: string;
			};
			if (!res.ok) {
				setError(data.error ?? "Error");
				setAlumno(null);
				setDocumentos([]);
				return;
			}
			const a = data.alumno ?? null;
			setAlumno(a);
			setDocumentos(data.documentos ?? []);
			setCarrerasCatalogo(data.carrerasCatalogo ?? []);
			if (a) {
				setGradoSeleccion(
					a.gradoAlumno != null && String(a.gradoAlumno).trim() !== ""
						? String(a.gradoAlumno).trim()
						: "__token__",
				);
				setCarreraSeleccion(
					a.requiereCarrera && a.carreraId != null && String(a.carreraId).trim() !== ""
						? String(a.carreraId).trim()
						: "__sin__",
				);
				setMatriculaExpediente(
					a.requiereCarrera && a.matricula != null && String(a.matricula).trim() !== ""
						? String(a.matricula).trim()
						: "",
				);
			}
		} catch {
			setError("Error de red");
		} finally {
			setCargando(false);
		}
	}, [cuentaId]);

	useEffect(() => {
		void cargar();
	}, [cargar]);

	useEffect(() => {
		if (!mensaje) {
			return;
		}
		const id = window.setTimeout(() => setMensaje(null), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [mensaje]);

	useEffect(() => {
		if (!error.trim()) {
			return;
		}
		const id = window.setTimeout(() => setError(""), DURACION_MENSAJE_EMERGENTE_MS);
		return () => window.clearTimeout(id);
	}, [error]);

	async function patchEntrega(tipo: TipoDocumentoClave, accion: "rechazar" | "validar_manual") {
		setMensaje(null);
		let motivoRechazo: string | undefined;
		if (accion === "rechazar") {
			motivoRechazo = window.prompt("Motivo del rechazo (obligatorio):") ?? "";
			if (!motivoRechazo.trim()) {
				return;
			}
		}
		const res = await fetch("/api/orientador/entrega", {
			method: "PATCH",
			headers: { "Content-Type": "application/json" },
			credentials: "include",
			body: JSON.stringify({
				cuentaId,
				tipoDocumento: tipo,
				accion,
				...(motivoRechazo ? { motivoRechazo: motivoRechazo.trim() } : {}),
			}),
		});
		const d = (await res.json()) as { error?: string };
		if (!res.ok) {
			setMensaje({ ok: false, t: d.error ?? "No se pudo actualizar" });
			return;
		}
		setMensaje({ ok: true, t: "Estado actualizado." });
		await cargar();
	}

	async function subirArchivo(tipo: TipoDocumentoClave, e: React.ChangeEvent<HTMLInputElement>) {
		const file = e.target.files?.[0];
		e.target.value = "";
		if (!file) {
			return;
		}
		setSubiendo(tipo);
		setMensaje(null);
		try {
			const fd = new FormData();
			fd.set("cuentaId", cuentaId);
			fd.set("tipoDocumento", tipo);
			fd.set("archivo", file);
			const res = await fetch("/api/orientador/subir-documento", {
				method: "POST",
				body: fd,
				credentials: "include",
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setMensaje({ ok: false, t: d.error ?? "Error al subir" });
				return;
			}
			setMensaje({ ok: true, t: "Archivo subido. Queda en revisión manual hasta que valides." });
			await cargar();
		} catch {
			setMensaje({ ok: false, t: "Error de red" });
		} finally {
			setSubiendo(null);
		}
	}

	async function guardarGradoMostrado() {
		if (!alumno) {
			return;
		}
		setGradoGuardando(true);
		setMensaje(null);
		try {
			const res = await fetch(`/api/orientador/padron/${alumno.padronId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					gradoAlumno: gradoSeleccion === "__token__" ? null : gradoSeleccion,
				}),
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setMensaje({ ok: false, t: d.error ?? "No se pudo guardar el grado" });
				return;
			}
			setMensaje({ ok: true, t: "Grado actualizado." });
			await cargar();
		} catch {
			setMensaje({ ok: false, t: "Error de red" });
		} finally {
			setGradoGuardando(false);
		}
	}

	async function guardarCarreraYMatriculaExpediente() {
		if (!alumno) {
			return;
		}
		setCarreraGuardando(true);
		setMensaje(null);
		const mat = matriculaExpediente.trim();
		try {
			const res = await fetch(`/api/orientador/padron/${alumno.padronId}`, {
				method: "PATCH",
				headers: { "Content-Type": "application/json" },
				credentials: "include",
				body: JSON.stringify({
					carreraId: carreraSeleccion === "__sin__" ? null : carreraSeleccion,
					matricula: mat === "" ? null : mat,
				}),
			});
			const d = (await res.json()) as { error?: string };
			if (!res.ok) {
				setMensaje({ ok: false, t: d.error ?? "No se pudo guardar carrera o matrícula" });
				return;
			}
			setMensaje({ ok: true, t: "Carrera y matrícula actualizadas." });
			await cargar();
		} catch {
			setMensaje({ ok: false, t: "Error de red" });
		} finally {
			setCarreraGuardando(false);
		}
	}

	const volverGrupo = alumno?.grupoTokenId
		? `/orientador/panel/grupo/${alumno.grupoTokenId}`
		: "/orientador/panel";

	return (
		<div>
			<Link href={volverGrupo} className="text-sm font-medium text-emerald-800 hover:underline">
				← Volver al grupo
			</Link>

			{cargando ? (
				<p className="mt-6 text-slate-500">Cargando expediente…</p>
			) : error ? (
				<p className="mt-6 text-red-600">{error}</p>
			) : alumno ? (
				<>
					<h1 className="mt-4 text-2xl font-bold text-slate-900">{alumno.nombreCompleto}</h1>
					<p className="text-sm text-slate-600">
						<span className="font-medium text-slate-800">
							{alumno.grado} · Grupo {alumno.grupo}
							{alumno.requiereCarrera && alumno.carreraNombre ? (
								<> · {alumno.carreraNombre}</>
							) : null}
							{alumno.requiereCarrera && alumno.matricula ? <> · Matrícula {alumno.matricula}</> : null}
						</span>
					</p>

					<div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-sky-200 bg-sky-50/60 px-3 py-3">
						<div className="min-w-[12rem] flex-1">
							<p className="text-xs font-medium text-sky-900">Descargas rápidas</p>
							<a
								href={`/api/orientador/expediente-zip?cuentaId=${encodeURIComponent(cuentaId)}`}
								className="mt-1 inline-block text-sm font-medium text-emerald-800 underline"
							>
								Expediente completo (ZIP)
							</a>
						</div>
						<div>
							<label htmlFor="expediente-tipo-uno" className="block text-xs font-medium text-sky-900">
								Un documento
							</label>
							<select
								id="expediente-tipo-uno"
								value={tipoDescargaRapida}
								onChange={(e) => setTipoDescargaRapida(e.target.value as TipoDocumentoClave)}
								className="mt-1 rounded-lg border border-sky-300 bg-white px-2 py-1.5 text-sm"
							>
								{TIPOS_DESCARGA_EXP.map((t) => (
									<option key={t.tipo} value={t.tipo}>
										{t.etiqueta}
									</option>
								))}
							</select>
							<a
								href={`/api/orientador/documento/descargar?cuentaId=${encodeURIComponent(cuentaId)}&tipo=${encodeURIComponent(tipoDescargaRapida)}`}
								className="mt-1 block text-sm font-medium text-sky-800 underline"
							>
								Descargar seleccionado
							</a>
						</div>
					</div>

					<div className="mt-3 flex flex-wrap items-end gap-3 rounded-lg border border-slate-200 bg-slate-50/80 px-3 py-3">
						<div>
							<label htmlFor="expediente-grado-mostrado" className="block text-xs font-medium text-slate-600">
								Grado escolar (expediente y panel del alumno)
							</label>
							<select
								id="expediente-grado-mostrado"
								value={gradoSeleccion}
								onChange={(e) => setGradoSeleccion(e.target.value)}
								className="mt-1 rounded-lg border border-slate-300 bg-white px-2 py-1.5 text-sm"
							>
								<option value="__token__">
									Predeterminado del enlace ({alumno.gradoToken ?? "—"})
								</option>
								{Array.from({ length: GRADO_ESCOLAR_MAX }, (_, i) => i + 1).map((n) => (
									<option key={n} value={String(n)}>
										Grado {n}
									</option>
								))}
							</select>
						</div>
						<button
							type="button"
							disabled={gradoGuardando}
							onClick={() => void guardarGradoMostrado()}
							className="rounded-lg border border-emerald-600 bg-emerald-600 px-3 py-1.5 text-sm font-medium text-white hover:bg-emerald-700 disabled:opacity-60"
						>
							{gradoGuardando ? "Guardando…" : "Guardar grado"}
						</button>
					</div>

					{alumno.requiereCarrera ? (
						<div className="mt-3 flex flex-col gap-3 rounded-lg border border-violet-200 bg-violet-50/70 px-3 py-3 sm:flex-row sm:flex-wrap sm:items-end">
							<div className="min-w-[12rem] flex-1">
								<label htmlFor="expediente-carrera" className="block text-xs font-medium text-violet-900">
									Carrera (desde 2.° grado)
								</label>
								<select
									id="expediente-carrera"
									value={carreraSeleccion}
									onChange={(e) => setCarreraSeleccion(e.target.value)}
									className="mt-1 w-full rounded-lg border border-violet-300 bg-white px-2 py-1.5 text-sm"
								>
									<option value="__sin__">— Elige una carrera —</option>
									{carrerasCatalogo.map((c) => (
										<option key={c.id} value={c.id}>
											{c.nombre}
										</option>
									))}
								</select>
							</div>
							<div className="min-w-[10rem] flex-1">
								<label htmlFor="expediente-matricula" className="block text-xs font-medium text-violet-900">
									Matrícula
								</label>
								<input
									id="expediente-matricula"
									type="text"
									value={matriculaExpediente}
									onChange={(e) => setMatriculaExpediente(e.target.value)}
									placeholder="Ej. 1719002345"
									maxLength={48}
									className="mt-1 w-full rounded-lg border border-violet-300 bg-white px-2 py-1.5 text-sm"
								/>
							</div>
							<button
								type="button"
								disabled={carreraGuardando}
								onClick={() => void guardarCarreraYMatriculaExpediente()}
								className="rounded-lg border border-violet-700 bg-violet-700 px-3 py-1.5 text-sm font-medium text-white hover:bg-violet-800 disabled:opacity-60"
							>
								{carreraGuardando ? "Guardando…" : "Guardar carrera y matrícula"}
							</button>
						</div>
					) : null}

					{mensaje ? (
						<p
							className={`mt-4 rounded-lg border px-4 py-2 text-sm ${
								mensaje.ok
									? "border-emerald-200 bg-emerald-50 text-emerald-900"
									: "border-red-200 bg-red-50 text-red-900"
							}`}
						>
							{mensaje.t}
						</p>
					) : null}

					<div className="mt-6 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-sm">
						<table className="w-full min-w-[900px] text-left text-sm">
							<thead className="border-b border-slate-200 bg-slate-50">
								<tr>
									<th className="px-3 py-3 font-semibold text-slate-600">Documento</th>
									<th className="px-3 py-3 font-semibold text-slate-600">Estatus</th>
									<th className="px-3 py-3 font-semibold text-slate-600">OCR</th>
									<th className="px-3 py-3 font-semibold text-slate-600">Acciones</th>
								</tr>
							</thead>
							<tbody className="divide-y divide-slate-100">
								{documentos.map((d) => {
									const nOcr = d.ocrCampos != null ? Object.keys(d.ocrCampos).length : 0;
									const hayOcr = nOcr > 0 || Boolean(d.ocrError?.trim());
									const filasOcr =
										d.ocrCampos != null && nOcr > 0 ? entradasFieldsOrdenadas(d.ocrCampos) : [];
									return (
										<Fragment key={d.tipo}>
											<tr>
												<td className="px-3 py-3 font-medium text-slate-900">{d.etiqueta}</td>
												<td className="px-3 py-3 text-slate-700">
													<span className="inline-flex items-center gap-1">
														{d.estado === "validado" && d.validacionAutomatica ? (
															<span className="text-emerald-600">✓</span>
														) : null}
														{textoEstado(d.estado, d.motivoRechazo)}
													</span>
												</td>
												<td className="max-w-[180px] px-3 py-3 text-xs text-slate-600">
													{!d.puedeDescargar ? (
														<span className="text-slate-400">—</span>
													) : hayOcr ? (
														<button
															type="button"
															className="font-medium text-violet-700 underline decoration-violet-300 hover:decoration-violet-600"
															onClick={() =>
																setOcrExpandido((prev) => (prev === d.tipo ? null : d.tipo))
															}
														>
															{nOcr > 0
																? `${nOcr} campo${nOcr === 1 ? "" : "s"}`
																: "Sin datos"}
															{d.ocrError ? " · aviso" : ""}
														</button>
													) : (
														<span className="text-slate-400">Sin datos</span>
													)}
												</td>
												<td className="px-3 py-3">
											<div className="flex flex-wrap gap-2">
												<label className="cursor-pointer">
													<input
														type="file"
														accept=".pdf,.png,.jpg,.jpeg,.webp"
														className="sr-only"
														disabled={subiendo !== null}
														onChange={(ev) => void subirArchivo(d.tipo, ev)}
													/>
													<span
														className={`inline-block rounded-lg bg-slate-800 px-2 py-1.5 text-xs font-semibold text-white hover:bg-slate-900 ${
															subiendo !== null ? "pointer-events-none opacity-50" : ""
														}`}
													>
														{subiendo === d.tipo ? "Subiendo…" : "Subir (USB)"}
													</span>
												</label>
												{d.puedeDescargar ? (
													<a
														href={`/api/orientador/documento/descargar?cuentaId=${encodeURIComponent(cuentaId)}&tipo=${encodeURIComponent(d.tipo)}`}
														className="inline-block rounded-lg border border-slate-300 px-2 py-1.5 text-xs font-semibold text-slate-800 hover:bg-slate-50"
														download
													>
														Descargar
													</a>
												) : null}
												{d.estado !== "pendiente_carga" ? (
													<>
														<button
															type="button"
															className="rounded-lg border border-emerald-600 px-2 py-1.5 text-xs font-semibold text-emerald-800 hover:bg-emerald-50"
															onClick={() => void patchEntrega(d.tipo, "validar_manual")}
														>
															Validar manual
														</button>
														<button
															type="button"
															className="rounded-lg border border-red-300 px-2 py-1.5 text-xs font-semibold text-red-800 hover:bg-red-50"
															onClick={() => void patchEntrega(d.tipo, "rechazar")}
														>
															Rechazar
														</button>
													</>
												) : null}
											</div>
										</td>
									</tr>
											{ocrExpandido === d.tipo && d.puedeDescargar && hayOcr ? (
												<tr className="bg-slate-50 text-xs text-slate-700">
													<td colSpan={4} className="px-3 pb-3 pt-0">
														<div className="rounded-lg border border-slate-200 bg-white p-3">
															{d.ocrTramite ? (
																<p className="mb-2 text-[11px] text-slate-500">
																	Trámite:{" "}
																	<span className="font-mono text-slate-800">{d.ocrTramite}</span>
																	{d.ocrExtraidoEn ? (
																		<>
																			{" "}
																			· {new Date(d.ocrExtraidoEn).toLocaleString("es-MX")}
																		</>
																	) : null}
																</p>
															) : null}
															{d.ocrError ? (
																<p className="mb-2 rounded border border-amber-200 bg-amber-50 px-2 py-1 text-amber-900">
																	{d.ocrError}
																</p>
															) : null}
															{filasOcr.length > 0 ? (
																<ul className="max-h-40 space-y-1 overflow-y-auto">
																	{filasOcr.map((row) => (
																		<li
																			key={row.clave}
																			className="flex flex-wrap gap-x-2 border-b border-slate-100 py-1 last:border-0"
																		>
																			<span className="font-medium">{row.etiqueta}</span>
																			<span className="break-all">{row.valor}</span>
																			{row.conf ? (
																				<span className="text-[10px] text-slate-400">({row.conf})</span>
																			) : null}
																		</li>
																	))}
																</ul>
															) : null}
														</div>
													</td>
												</tr>
											) : null}
										</Fragment>
									);
								})}
							</tbody>
						</table>
					</div>
				</>
			) : null}
		</div>
	);
}
