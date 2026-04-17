"use client";

import { mensajeRedAmigable } from "@/lib/mensaje-red-amigable";
import { mensajeOcrUiCorto } from "@/lib/ocr/mensaje-ocr-ui-corto";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
	CAMPOS_EDITABLES_POR_TRAMITE_OCR,
	esTramiteConPlantillaOcr,
} from "@/lib/ocr/campos-editables-por-tramite-ocr";
import { type CampoOcrCelda, textoConfianzaOcr } from "@/lib/ocr/campos-ocr-vista";

const TRAMITES_OCR = [
	{ value: "curp", etiqueta: "CURP" },
	{ value: "ine", etiqueta: "INE" },
	{ value: "acta_nacimiento", etiqueta: "Acta de nacimiento" },
	{ value: "comprobante", etiqueta: "Comprobante de domicilio" },
	{ value: "certificado_medico", etiqueta: "Certificado médico" },
	{ value: "otro", etiqueta: "Otro (sin OCR)" },
] as const;

type TramiteOcr = (typeof TRAMITES_OCR)[number]["value"];

type AlumnoExp = {
	padronId: string;
	nombreCompleto: string;
	matricula: string;
	grado: string;
	grupo: string;
	grupoTokenId: string | null;
	institucionGrupoId: string | null;
	carreraId: string | null;
	carreraNombre: string;
	cuentaId: string | null;
};

type GrupoCat = {
	id: string | null;
	institucionGrupoId: string | null;
	grado: string;
	grupo: string;
};

function idDestinoGrupo(g: GrupoCat): string {
	if (g.id != null && String(g.id).trim() !== "") {
		return String(g.id);
	}
	if (g.institucionGrupoId != null && String(g.institucionGrupoId).trim() !== "") {
		return String(g.institucionGrupoId);
	}
	return "";
}

function valorCampo(fields: Record<string, CampoOcrCelda> | undefined, claves: string[]): string {
	if (!fields) {
		return "";
	}
	for (const k of claves) {
		const v = fields[k]?.value;
		if (typeof v === "string" && v.trim() !== "") {
			return v.trim();
		}
	}
	return "";
}

function celdaValorTexto(c: CampoOcrCelda | undefined): string {
	const v = c?.value;
	return typeof v === "string" ? v.trim() : "";
}

function construirOcrCamposParaAdjunto(
	tramite: TramiteOcr,
	ocrFields: Record<string, CampoOcrCelda> | null,
	valoresPlantilla: Record<string, string>,
): Record<string, CampoOcrCelda> | null {
	if (tramite === "otro" || !esTramiteConPlantillaOcr(tramite)) {
		return null;
	}
	const plantilla = CAMPOS_EDITABLES_POR_TRAMITE_OCR[tramite];
	const out: Record<string, CampoOcrCelda> = {};
	if (ocrFields) {
		for (const [k, v] of Object.entries(ocrFields)) {
			out[k] = {
				value: typeof v?.value === "string" ? v.value : undefined,
				confidence:
					typeof v?.confidence === "number" && Number.isFinite(v.confidence) ? v.confidence : undefined,
			};
		}
	}
	for (const row of plantilla) {
		const typed = (valoresPlantilla[row.clave] ?? "").trim();
		const fromOcr = out[row.clave];
		if (typed !== "" || fromOcr !== undefined) {
			out[row.clave] = {
				value: typed !== "" ? typed : (fromOcr?.value ?? ""),
				...(fromOcr?.confidence != null ? { confidence: fromOcr.confidence } : {}),
			};
		}
	}
	const cleaned: Record<string, CampoOcrCelda> = {};
	for (const [k, cell] of Object.entries(out)) {
		const vv = (cell.value ?? "").trim();
		if (vv !== "" || cell.confidence != null) {
			cleaned[k] = cell;
		}
	}
	return Object.keys(cleaned).length > 0 ? cleaned : null;
}

type Props = {
	abierto: boolean;
	pdfBlob: Blob;
	nombreArchivo: string;
	primeraPaginaJpeg: Blob;
	onCerrar: () => void;
	onExito: () => void;
	/** Cierra el modal de subida y vuelve a abrir la cámara (mismo flujo de expediente). */
	onVolverAEscanear?: () => void;
};

export default function ModalSubirExpedienteEscaner({
	abierto,
	pdfBlob,
	nombreArchivo,
	primeraPaginaJpeg,
	onCerrar,
	onExito,
	onVolverAEscanear,
}: Props) {
	const [tramite, setTramite] = useState<TramiteOcr>("curp");
	const [extrayendo, setExtrayendo] = useState(false);
	const [ocrFields, setOcrFields] = useState<Record<string, CampoOcrCelda> | null>(null);
	const [ocrError, setOcrError] = useState("");
	/** Valores de los párrafos por tipo de documento (como en alumno / Flutter). */
	const [valoresPlantilla, setValoresPlantilla] = useState<Record<string, string>>({});

	const [alumnos, setAlumnos] = useState<AlumnoExp[]>([]);
	const [carrerasCat, setCarrerasCat] = useState<{ id: string; nombre: string }[]>([]);
	const [gruposCat, setGruposCat] = useState<GrupoCat[]>([]);
	const [cargandoCat, setCargandoCat] = useState(false);

	const [busquedaNombre, setBusquedaNombre] = useState("");
	const [busquedaMatricula, setBusquedaMatricula] = useState("");
	const [filtroGrado, setFiltroGrado] = useState("");
	const [filtroGrupo, setFiltroGrupo] = useState("");
	const [filtroCarreraId, setFiltroCarreraId] = useState("");
	const [padronIdSel, setPadronIdSel] = useState("");
	const [matricula, setMatricula] = useState("");
	const [gradoAlumno, setGradoAlumno] = useState("");
	const [grupoDestinoId, setGrupoDestinoId] = useState("");
	const [carreraId, setCarreraId] = useState("");

	const [subiendo, setSubiendo] = useState(false);
	const [error, setError] = useState("");
	const [previewUrl, setPreviewUrl] = useState("");

	const ejecutarExtract = useCallback(async () => {
		setExtrayendo(true);
		setOcrError("");
		setOcrFields(null);
		try {
			const form = new FormData();
			form.append("file", primeraPaginaJpeg, "pagina1.jpg");
			form.append("tramite", tramite);
			form.append("lang", "spa");
			form.append("use_ocr_space_fallback", "true");
			form.append("aplicar_preproceso_ocr", "false");
			form.append("aplicar_saturacion_hsv", "true");
			const res = await fetch("/api/orientador/ocr/extract", {
				method: "POST",
				body: form,
				credentials: "include",
			});
			const data = (await res.json()) as {
				success?: boolean;
				fields?: Record<string, CampoOcrCelda>;
				error?: string;
			};
			if (!res.ok) {
				setOcrError(data.error ?? `OCR respondió ${res.status}`);
				return;
			}
			if (!data.success) {
				setOcrError("El OCR no devolvió datos reconocidos.");
				return;
			}
			setOcrFields(data.fields ?? null);
			if (esTramiteConPlantillaOcr(tramite)) {
				const plantilla = CAMPOS_EDITABLES_POR_TRAMITE_OCR[tramite];
				const next: Record<string, string> = {};
				for (const row of plantilla) {
					next[row.clave] = celdaValorTexto(data.fields?.[row.clave]);
				}
				setValoresPlantilla(next);
			}
			// Claves reales por tramite en github.com/Cat-Not-Furry/API-OCR (extractors/*.py)
			const nombreOcr = valorCampo(data.fields, [
				"nombre",
				"nombre_tutor",
				"nombre_titular",
				"nombre_alumno",
				"nombre_completo",
				"nombres",
			]);
			if (nombreOcr) {
				setBusquedaNombre(nombreOcr);
			}
			// Ningún extractor devuelve matrícula escolar; no rellenar con CURP/clave_elector.
			const mat = valorCampo(data.fields, ["matricula", "numero_control", "no_control"]);
			if (mat) {
				setMatricula(mat);
			}
		} catch (e) {
			setOcrError(mensajeRedAmigable(e));
		} finally {
			setExtrayendo(false);
		}
	}, [primeraPaginaJpeg, tramite]);

	useEffect(() => {
		if (!abierto) {
			setTramite("curp");
			setOcrFields(null);
			setOcrError("");
			setValoresPlantilla({});
			setBusquedaNombre("");
			setBusquedaMatricula("");
			setFiltroGrado("");
			setFiltroGrupo("");
			setFiltroCarreraId("");
			setPadronIdSel("");
			setMatricula("");
			setGradoAlumno("");
			setGrupoDestinoId("");
			setCarreraId("");
			setError("");
			return;
		}

		let cancel = false;
		(async () => {
			setCargandoCat(true);
			try {
				const [rE, rG] = await Promise.all([
					fetch("/api/orientador/expediente?estado=activo", { credentials: "include" }),
					fetch("/api/orientador/grupos", { credentials: "include" }),
				]);
				if (cancel) {
					return;
				}
				if (rE.ok) {
					const j = (await rE.json()) as { alumnos?: AlumnoExp[]; carreras?: { id: string; nombre: string }[] };
					setAlumnos(j.alumnos ?? []);
					setCarrerasCat(j.carreras ?? []);
				}
				if (rG.ok) {
					const jg = (await rG.json()) as { grupos?: GrupoCat[] };
					const lista = (jg.grupos ?? []).filter((g) => idDestinoGrupo(g) !== "");
					setGruposCat(lista);
				}
			} finally {
				if (!cancel) {
					setCargandoCat(false);
				}
			}
		})();

		return () => {
			cancel = true;
		};
	}, [abierto]);

	const alCambiarTramite = useCallback((t: TramiteOcr) => {
		setTramite(t);
		setOcrFields(null);
		setOcrError("");
		setValoresPlantilla({});
	}, []);

	const ocrCamposParaSubida = useMemo(
		() => construirOcrCamposParaAdjunto(tramite, ocrFields, valoresPlantilla),
		[tramite, ocrFields, valoresPlantilla],
	);

	const plantillaCampos = useMemo(() => {
		if (tramite === "otro" || !esTramiteConPlantillaOcr(tramite)) {
			return [];
		}
		return CAMPOS_EDITABLES_POR_TRAMITE_OCR[tramite];
	}, [tramite]);

	const alumnosFiltrados = useMemo(() => {
		const q = busquedaNombre.trim().toLowerCase();
		const qm = busquedaMatricula.trim().toLowerCase();
		const fg = filtroGrado.trim();
		const fgr = filtroGrupo.trim().toUpperCase();
		const fc = filtroCarreraId.trim();
		const conCuenta = alumnos.filter((a) => a.cuentaId != null && String(a.cuentaId).trim() !== "");
		return conCuenta.filter((a) => {
			if (q && !a.nombreCompleto.toLowerCase().includes(q)) {
				return false;
			}
			if (qm && !String(a.matricula ?? "").toLowerCase().includes(qm)) {
				return false;
			}
			if (fg && String(a.grado ?? "").trim() !== fg) {
				return false;
			}
			if (fgr && String(a.grupo ?? "").trim().toUpperCase() !== fgr) {
				return false;
			}
			if (fc && String(a.carreraId ?? "").trim() !== fc) {
				return false;
			}
			return true;
		});
	}, [alumnos, busquedaMatricula, busquedaNombre, filtroCarreraId, filtroGrado, filtroGrupo]);

	const alumnoSel = useMemo(
		() => alumnosFiltrados.find((a) => a.padronId === padronIdSel) ?? null,
		[alumnosFiltrados, padronIdSel],
	);

	useEffect(() => {
		if (alumnoSel) {
			setMatricula(alumnoSel.matricula ?? "");
			setGradoAlumno(alumnoSel.grado ?? "");
			const gid =
				alumnoSel.grupoTokenId && alumnoSel.grupoTokenId.trim() !== ""
					? alumnoSel.grupoTokenId
					: alumnoSel.institucionGrupoId && alumnoSel.institucionGrupoId.trim() !== ""
						? alumnoSel.institucionGrupoId
						: "";
			setGrupoDestinoId(gid);
			setCarreraId(alumnoSel.carreraId ?? "");
		}
	}, [alumnoSel]);

	const agregarExpediente = useCallback(async () => {
		setError("");
		if (!alumnoSel?.cuentaId) {
			setError("Selecciona un alumno que tenga cuenta (debe haber iniciado sesión al menos una vez).");
			return;
		}
		setSubiendo(true);
		try {
			const destino = grupoDestinoId.trim();
			const patchBody: Record<string, unknown> = {};
			if (matricula.trim() !== (alumnoSel.matricula ?? "").trim()) {
				patchBody.matricula = matricula.trim() || null;
			}
			if (gradoAlumno.trim() !== (alumnoSel.grado ?? "").trim()) {
				patchBody.gradoAlumno = gradoAlumno.trim() || null;
			}
			const carreraTrim = carreraId.trim();
			if (carreraTrim !== (alumnoSel.carreraId ?? "")) {
				patchBody.carreraId = carreraTrim || null;
			}
			const gidActual =
				alumnoSel.grupoTokenId && alumnoSel.grupoTokenId.trim() !== ""
					? alumnoSel.grupoTokenId
					: alumnoSel.institucionGrupoId ?? "";
			if (destino !== "" && destino !== gidActual) {
				patchBody.grupoTokenIdDestino = destino;
			}
			if (Object.keys(patchBody).length > 0) {
				const rP = await fetch(`/api/orientador/padron/${alumnoSel.padronId}`, {
					method: "PATCH",
					credentials: "include",
					headers: { "Content-Type": "application/json" },
					body: JSON.stringify(patchBody),
				});
				if (!rP.ok) {
					const jp = (await rP.json()) as { error?: string };
					setError(jp.error ?? "No se pudo actualizar los datos del alumno");
					return;
				}
			}

			const fd = new FormData();
			fd.append("cuentaId", alumnoSel.cuentaId!);
			fd.append("etiqueta", nombreArchivo.replace(/\.pdf$/i, "").slice(0, 80) || "Documento escaneado");
			const archivo = new File([pdfBlob], nombreArchivo.endsWith(".pdf") ? nombreArchivo : `${nombreArchivo}.pdf`, {
				type: "application/pdf",
			});
			fd.append("archivo", archivo);
			if (ocrCamposParaSubida && Object.keys(ocrCamposParaSubida).length > 0) {
				fd.append("ocrCamposJson", JSON.stringify(ocrCamposParaSubida));
				fd.append("ocrTramite", tramite);
			}
			const rA = await fetch("/api/orientador/documento/adjunto", {
				method: "POST",
				body: fd,
				credentials: "include",
			});
			if (!rA.ok) {
				const ja = (await rA.json()) as { error?: string };
				setError(ja.error ?? "No se pudo subir el archivo");
				return;
			}
			onExito();
			onCerrar();
		} catch (e) {
			setError(mensajeRedAmigable(e));
		} finally {
			setSubiendo(false);
		}
	}, [
		alumnoSel,
		carreraId,
		gradoAlumno,
		grupoDestinoId,
		matricula,
		nombreArchivo,
		ocrCamposParaSubida,
		pdfBlob,
		tramite,
		onCerrar,
		onExito,
	]);

	useEffect(() => {
		if (!abierto) {
			setPreviewUrl("");
			return;
		}
		const u = URL.createObjectURL(pdfBlob);
		setPreviewUrl(u);
		return () => {
			URL.revokeObjectURL(u);
		};
	}, [abierto, pdfBlob]);

	if (!abierto) {
		return null;
	}

	return (
		<div
			className="fixed inset-0 z-[220] flex items-center justify-center bg-slate-900/55 p-3 sm:p-4"
			onClick={(e) => {
				if (e.target === e.currentTarget) {
					onCerrar();
				}
			}}
			role="presentation"
		>
			<div
				className="flex max-h-[95vh] w-full max-w-5xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
				onClick={(e) => e.stopPropagation()}
				role="dialog"
				aria-modal="true"
				aria-labelledby="titulo-subir-escaner"
			>
				<div className="flex shrink-0 items-center gap-2 border-b border-slate-100 px-3 py-2">
					<button
						type="button"
						onClick={onCerrar}
						className="rounded-lg p-2 text-slate-600 hover:bg-slate-100"
						aria-label="Volver"
					>
						<svg className="h-5 w-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
							<path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
						</svg>
					</button>
					<h2 id="titulo-subir-escaner" className="min-w-0 flex-1 truncate text-center text-base font-bold text-slate-900">
						Subir archivo
					</h2>
					{onVolverAEscanear ? (
						<button
							type="button"
							onClick={onVolverAEscanear}
							className="shrink-0 rounded-lg border border-violet-200 bg-violet-50 px-2 py-1.5 text-xs font-semibold text-violet-800 hover:bg-violet-100"
						>
							Volver a escanear
						</button>
					) : (
						<span className="w-9 shrink-0" aria-hidden />
					)}
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
					<div className="grid gap-4 lg:grid-cols-[1.1fr_0.9fr]">
						<div>
							<div className="mb-3 grid gap-2 sm:grid-cols-2">
						<label className="text-xs font-medium text-slate-600">
							Tipo de documento (OCR)
							<select
								value={tramite}
								onChange={(e) => alCambiarTramite(e.target.value as TramiteOcr)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
							>
								{TRAMITES_OCR.map((t) => (
									<option key={t.value} value={t.value}>
										{t.etiqueta}
									</option>
								))}
							</select>
						</label>
						<p className="self-end text-xs text-slate-500">
							{tramite === "otro"
								? "Sin OCR para este tipo."
								: extrayendo
									? "Extrayendo datos…"
									: ocrError
										? mensajeOcrUiCorto(ocrError)
										: ocrFields
											? "Revisa y corrige los campos abajo si hace falta."
											: "Puedes extraer OCR o escribir los datos a mano."}
						</p>
							</div>

					{tramite !== "otro" ? (
						<div className="mb-3">
							<button
								type="button"
								onClick={() => void ejecutarExtract()}
								disabled={extrayendo || !primeraPaginaJpeg.size}
								className="w-full rounded-xl border border-violet-300 bg-white py-2.5 text-sm font-semibold text-violet-800 shadow-sm hover:bg-violet-50 disabled:opacity-50 sm:w-auto sm:px-6"
							>
								{extrayendo ? "Extrayendo…" : "Extraer datos (OCR)"}
							</button>
						</div>
					) : null}

					{plantillaCampos.length > 0 ? (
						<section
							className="mb-4 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-3"
							aria-labelledby="titulo-datos-doc-plantilla"
						>
							<h3 id="titulo-datos-doc-plantilla" className="text-xs font-bold uppercase tracking-wide text-violet-900">
								Datos del documento
							</h3>
							<p className="mt-1 text-[11px] leading-snug text-violet-800/90">
								Campos según el tipo elegido. Usa «Extraer datos (OCR)» para autocompletar o escribe a mano; no sustituyen al padrón.
							</p>
							<div className="mt-3 space-y-3 border-t border-violet-200/80 pt-3">
								{plantillaCampos.map((c) => {
									const conf = ocrFields?.[c.clave]?.confidence;
									const confTxt = textoConfianzaOcr(conf);
									return (
										<div key={c.clave}>
											<label className="block text-[11px] font-semibold text-slate-700" htmlFor={`ocr-campo-${c.clave}`}>
												{c.etiqueta}
											</label>
											{c.multiline ? (
												<textarea
													id={`ocr-campo-${c.clave}`}
													rows={3}
													value={valoresPlantilla[c.clave] ?? ""}
													onChange={(e) =>
														setValoresPlantilla((prev) => ({ ...prev, [c.clave]: e.target.value }))
													}
													className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 shadow-sm"
												/>
											) : (
												<input
													id={`ocr-campo-${c.clave}`}
													type="text"
													value={valoresPlantilla[c.clave] ?? ""}
													onChange={(e) =>
														setValoresPlantilla((prev) => ({ ...prev, [c.clave]: e.target.value }))
													}
													className="mt-1 w-full rounded-lg border border-slate-300 bg-white px-2 py-2 text-sm text-slate-900 shadow-sm"
												/>
											)}
											{confTxt ? (
												<p className="mt-0.5 text-[10px] text-slate-500">Confianza OCR: {confTxt}</p>
											) : null}
										</div>
									);
								})}
							</div>
						</section>
					) : null}

					<label className="mb-2 block text-xs font-medium text-slate-600">
						Buscar nombre (alumno con cuenta)
						<input
							type="search"
							value={busquedaNombre}
							onChange={(e) => setBusquedaNombre(e.target.value)}
							className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
							placeholder="Coincidencia en padrón"
						/>
					</label>

					<div className="mb-2 grid gap-2 sm:grid-cols-2">
						<label className="text-xs font-medium text-slate-600">
							Buscar matrícula
							<input
								type="search"
								value={busquedaMatricula}
								onChange={(e) => setBusquedaMatricula(e.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
								placeholder="Ej. 24001234"
							/>
						</label>
						<label className="text-xs font-medium text-slate-600">
							Carrera (filtro)
							<select
								value={filtroCarreraId}
								onChange={(e) => setFiltroCarreraId(e.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
							>
								<option value="">Todas</option>
								{carrerasCat.map((c) => (
									<option key={c.id} value={c.id}>
										{c.nombre}
									</option>
								))}
							</select>
						</label>
					</div>

					<div className="mb-2 grid grid-cols-2 gap-2">
						<label className="text-xs font-medium text-slate-600">
							Grado (filtro)
							<input
								type="text"
								value={filtroGrado}
								onChange={(e) => setFiltroGrado(e.target.value.replace(/\D+/g, "").slice(0, 1))}
								className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
								placeholder="Ej. 1"
							/>
						</label>
						<label className="text-xs font-medium text-slate-600">
							Grupo (filtro)
							<input
								type="text"
								value={filtroGrupo}
								onChange={(e) => setFiltroGrupo(e.target.value.toUpperCase().slice(0, 2))}
								className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
								placeholder="Ej. A"
							/>
						</label>
					</div>

					<label className="mb-2 block text-xs font-medium text-slate-600">
						Alumno
						<select
							value={padronIdSel}
							onChange={(e) => setPadronIdSel(e.target.value)}
							className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
							disabled={cargandoCat}
						>
							<option value="">— Seleccionar —</option>
							{alumnosFiltrados.slice(0, 500).map((a) => (
								<option key={a.padronId} value={a.padronId}>
									{a.nombreCompleto}
								</option>
							))}
						</select>
						{alumnosFiltrados.length > 500 ? (
							<p className="mt-1 text-[11px] text-amber-700">
								Hay más de 500 coincidencias; escribe en «Buscar nombre» para acotar la lista.
							</p>
						) : null}
					</label>

					{alumnoSel ? (
						<div className="mb-2 rounded-lg border border-violet-200 bg-violet-50 px-3 py-2 text-sm text-violet-900">
							<span className="font-semibold">Grado:</span> {alumnoSel.grado || "—"}{" "}
							<span className="mx-2 text-violet-300">|</span>
							<span className="font-semibold">Grupo:</span> {alumnoSel.grupo || "—"}
						</div>
					) : null}

					<div className="mb-2 grid grid-cols-2 gap-2">
						<label className="text-xs font-medium text-slate-600">
							Grado
							<input
								type="text"
								value={gradoAlumno}
								onChange={(e) => setGradoAlumno(e.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
							/>
						</label>
						<label className="text-xs font-medium text-slate-600">
							Grupo
							<select
								value={grupoDestinoId}
								onChange={(e) => setGrupoDestinoId(e.target.value)}
								className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
							>
								<option value="">— Grupo —</option>
								{gruposCat.map((g) => {
									const id = idDestinoGrupo(g);
									return (
										<option key={id} value={id}>
											{g.grupo}
										</option>
									);
								})}
							</select>
						</label>
					</div>

					<label className="mb-2 block text-xs font-medium text-slate-600">
						Matrícula
						<input
							type="text"
							value={matricula}
							onChange={(e) => setMatricula(e.target.value)}
							className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
						/>
					</label>

					<label className="mb-3 block text-xs font-medium text-slate-600">
						Carrera
						<select
							value={carreraId}
							onChange={(e) => setCarreraId(e.target.value)}
							className="mt-1 w-full rounded-lg border border-slate-300 px-2 py-2 text-sm"
						>
							<option value="">— Sin carrera —</option>
							{carrerasCat.map((c) => (
								<option key={c.id} value={c.id}>
									{c.nombre}
								</option>
							))}
						</select>
					</label>

					{error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
						</div>
						<div className="rounded-xl border border-slate-200 bg-slate-50 p-3">
							<p className="mb-1 text-center text-sm font-semibold text-slate-800">{nombreArchivo}</p>
							<p className="mb-2 text-center text-xs text-slate-500">Vista previa del documento</p>
							{previewUrl ? (
								<iframe title="Vista previa PDF" src={previewUrl} className="h-[62vh] min-h-[360px] w-full rounded-lg border border-slate-200 bg-white" />
							) : (
								<div className="flex h-[62vh] min-h-[360px] items-center justify-center rounded-lg border border-slate-200 bg-white text-slate-400">PDF</div>
							)}
						</div>
					</div>
				</div>

				<div className="shrink-0 border-t border-slate-100 p-4">
					<button
						type="button"
						onClick={() => void agregarExpediente()}
						disabled={subiendo}
						className="flex w-full items-center justify-center gap-2 rounded-xl border border-[#7C3AED] bg-[#7C3AED] py-3 text-sm font-semibold text-white transition hover:bg-[#6D28D9] disabled:opacity-50"
					>
						{subiendo ? "Subiendo…" : "Agregar al expediente"}
						<span aria-hidden>⬆</span>
					</button>
				</div>
			</div>
		</div>
	);
}
