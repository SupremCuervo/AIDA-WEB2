"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
	entradasFieldsOrdenadas,
	type CampoOcrCelda,
} from "@/lib/ocr/campos-ocr-vista";

const TRAMITES_OCR = [
	{ value: "curp", etiqueta: "CURP" },
	{ value: "ine", etiqueta: "INE" },
	{ value: "acta_nacimiento", etiqueta: "Acta de nacimiento" },
	{ value: "comprobante", etiqueta: "Comprobante de domicilio" },
	{ value: "certificado_medico", etiqueta: "Certificado médico" },
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

type Props = {
	abierto: boolean;
	pdfBlob: Blob;
	nombreArchivo: string;
	primeraPaginaJpeg: Blob;
	onCerrar: () => void;
	onExito: () => void;
};

export default function ModalSubirExpedienteEscaner({
	abierto,
	pdfBlob,
	nombreArchivo,
	primeraPaginaJpeg,
	onCerrar,
	onExito,
}: Props) {
	const [tramite, setTramite] = useState<TramiteOcr>("curp");
	const [extrayendo, setExtrayendo] = useState(false);
	const [ocrFields, setOcrFields] = useState<Record<string, CampoOcrCelda> | null>(null);
	const [ocrError, setOcrError] = useState("");

	const [alumnos, setAlumnos] = useState<AlumnoExp[]>([]);
	const [carrerasCat, setCarrerasCat] = useState<{ id: string; nombre: string }[]>([]);
	const [gruposCat, setGruposCat] = useState<GrupoCat[]>([]);
	const [cargandoCat, setCargandoCat] = useState(false);

	const [busquedaNombre, setBusquedaNombre] = useState("");
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
		} catch {
			setOcrError("Error de red al extraer datos.");
		} finally {
			setExtrayendo(false);
		}
	}, [primeraPaginaJpeg, tramite]);

	useEffect(() => {
		if (!abierto) {
			setTramite("curp");
			setOcrFields(null);
			setOcrError("");
			setBusquedaNombre("");
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

	useEffect(() => {
		if (!abierto || !primeraPaginaJpeg.size) {
			return;
		}
		void ejecutarExtract();
	}, [abierto, primeraPaginaJpeg, tramite, ejecutarExtract]);

	const alumnosFiltrados = useMemo(() => {
		const q = busquedaNombre.trim().toLowerCase();
		const conCuenta = alumnos.filter((a) => a.cuentaId != null && String(a.cuentaId).trim() !== "");
		if (!q) {
			return conCuenta;
		}
		return conCuenta.filter((a) => a.nombreCompleto.toLowerCase().includes(q));
	}, [alumnos, busquedaNombre]);

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
			if (ocrFields && Object.keys(ocrFields).length > 0) {
				fd.append("ocrCamposJson", JSON.stringify(ocrFields));
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
		} catch {
			setError("Error de red al guardar.");
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
		ocrFields,
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

	const filasDatosDetectados = useMemo(() => {
		if (!ocrFields) {
			return [];
		}
		return entradasFieldsOrdenadas(ocrFields);
	}, [ocrFields]);

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
				className="flex max-h-[95vh] w-full max-w-lg flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl sm:max-w-xl"
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
					<h2 id="titulo-subir-escaner" className="flex-1 text-center text-base font-bold text-slate-900">
						Subir archivo
					</h2>
					<span className="w-9" />
				</div>

				<div className="min-h-0 flex-1 overflow-y-auto px-4 py-3">
					<div className="mb-3 grid gap-2 sm:grid-cols-2">
						<label className="text-xs font-medium text-slate-600">
							Tipo de documento (OCR)
							<select
								value={tramite}
								onChange={(e) => setTramite(e.target.value as TramiteOcr)}
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
							{extrayendo ? "Extrayendo datos…" : ocrError ? ocrError : ocrFields ? "Revisa los datos detectados abajo." : ""}
						</p>
					</div>

					{filasDatosDetectados.length > 0 ? (
						<section
							className="mb-4 rounded-xl border border-violet-200 bg-violet-50/60 px-3 py-3"
							aria-labelledby="titulo-datos-ocr"
						>
							<h3 id="titulo-datos-ocr" className="text-xs font-bold uppercase tracking-wide text-violet-900">
								Datos detectados (OCR)
							</h3>
							<p className="mt-1 text-[11px] leading-snug text-violet-800/90">
								Informativo: vienen del servicio según el tipo de documento elegido. No sustituyen al padrón: confirma
								al alumno, ajusta matrícula o grupo si aplica y sube el PDF al expediente.
							</p>
							<dl className="mt-2 space-y-2 border-t border-violet-200/80 pt-2">
								{filasDatosDetectados.map((fila) => (
									<div key={fila.clave} className="grid grid-cols-1 gap-0.5 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-start sm:gap-2">
										<dt className="text-[11px] font-semibold text-slate-700">{fila.etiqueta}</dt>
										<dd className="flex flex-wrap items-baseline gap-x-2 text-sm text-slate-900">
											<span className="break-words">{fila.valor}</span>
											{fila.conf ? (
												<span className="shrink-0 text-[10px] font-medium text-slate-500" title="Confianza estimada del extractor">
													{fila.conf}
												</span>
											) : null}
										</dd>
									</div>
								))}
							</dl>
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
									{a.nombreCompleto} · {a.grado}° {a.grupo}
								</option>
							))}
						</select>
						{alumnosFiltrados.length > 500 ? (
							<p className="mt-1 text-[11px] text-amber-700">
								Hay más de 500 coincidencias; escribe en «Buscar nombre» para acotar la lista.
							</p>
						) : null}
					</label>

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
											{g.grado}° {g.grupo}
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

					<p className="mb-1 text-center text-sm font-medium text-slate-800">{nombreArchivo}</p>
					<div className="mx-auto mb-3 max-h-48 overflow-hidden rounded-lg border border-slate-200 bg-slate-50 p-2">
						<p className="mb-1 text-center text-xs text-slate-500">Vista previa</p>
						{previewUrl ? (
							<iframe title="Vista previa PDF" src={previewUrl} className="h-40 w-full border-0" />
						) : (
							<div className="flex h-40 items-center justify-center text-slate-400">PDF</div>
						)}
					</div>

					{error ? <p className="mb-2 text-sm text-red-600">{error}</p> : null}
				</div>

				<div className="shrink-0 border-t border-slate-100 p-4">
					<button
						type="button"
						onClick={() => void agregarExpediente()}
						disabled={subiendo}
						className="flex w-full items-center justify-center gap-2 rounded-xl bg-slate-600 py-3 text-sm font-semibold text-white hover:bg-slate-700 disabled:opacity-50"
					>
						{subiendo ? "Subiendo…" : "Agregar al expediente"}
						<span aria-hidden>⬆</span>
					</button>
				</div>
			</div>
		</div>
	);
}
