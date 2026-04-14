import { createClient, type SupabaseClient } from "https://esm.sh/@supabase/supabase-js@2.45.0";
import JSZip from "npm:jszip@3.10.1";
import {
	alumnoRequiereCarrera,
	b64ToBytes,
	bytesToB64,
	crearTipoAdjuntoOrientador,
	cuentaIdDesdePadron,
	esAdjuntoOrientador,
	esTipoDocValido,
	extDesdeNombre,
	gradoMostradoParaAlumno,
	nombreArchivoEstandar,
	nombreRutaAdjuntoOrientador,
	slugificar,
	TIPOS_DOCUMENTO,
} from "./logic.ts";
import { corsHeaders, jsonRes } from "../_shared/cors.ts";

const EST_PEND = "pendiente_revision_manual";
const TABLA_ENT = "entregas_documento_alumno";
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_PLANTILLA = 25 * 1024 * 1024;

/** Evita devolver mensajes crudos de Postgres/PostgREST al cliente de la app. */
function mensajeErrorPostgrestParaCliente(msg: string): string {
	const m = msg.trim();
	const l = m.toLowerCase();
	if (l.includes("jwt expired") || l.includes("invalid jwt")) {
		return "La sesión caducó. Vuelve a iniciar sesión.";
	}
	if (l.includes("permission denied") || l.includes("row-level security")) {
		return "No tienes permiso para esta acción.";
	}
	if (l.includes("duplicate key") || l.includes("unique constraint")) {
		return "Ese registro ya existe o está duplicado.";
	}
	if (l.includes("foreign key")) {
		return "No se puede completar: hay datos relacionados que lo impiden.";
	}
	if (m.length > 240) {
		return "Error al guardar en la base de datos.";
	}
	return m;
}

function mensajeErrorCapturaParaCliente(e: unknown): string {
	if (e instanceof Error) {
		return mensajeErrorPostgrestParaCliente(e.message);
	}
	const s = String(e).trim();
	return s.length > 0 && s.length < 220 ? s : "Error interno.";
}

const ETIQUETAS: Record<string, string> = {
	acta_nacimiento: "Acta de nacimiento",
	curp: "CURP",
	ine_tutor: "INE del tutor",
	comprobante_domicilio: "Comprobante de domicilio",
	certificado_medico: "Certificado médico",
};

function admin(): SupabaseClient {
	const url = Deno.env.get("SUPABASE_URL") ?? "";
	const key = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY") ?? "";
	return createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
}

function bucketDocs(): string {
	const b = (Deno.env.get("AIDA_DOCUMENTOS_BUCKET") ?? "").trim();
	if (!b) {
		throw new Error("AIDA_DOCUMENTOS_BUCKET");
	}
	return b;
}

function bucketPlantillas(): string {
	const d = (Deno.env.get("AIDA_PLANTILLAS_BUCKET") ?? "").trim();
	if (d) {
		return d;
	}
	return bucketDocs();
}

async function authUser(
	req: Request,
	s: SupabaseClient,
): Promise<{ u: Record<string, unknown> | null; err: string | null }> {
	const h = req.headers.get("Authorization") ?? "";
	const m = h.match(/^Bearer\s+(.+)$/i);
	if (!m?.[1]) {
		return { u: null, err: "No autenticado" };
	}
	const { data, error } = await s.auth.getUser(m[1].trim());
	if (error || !data.user) {
		return { u: null, err: "No autenticado" };
	}
	return { u: data.user as unknown as Record<string, unknown>, err: null };
}

function metaRol(u: Record<string, unknown>): string {
	const um = u["user_metadata"] as Record<string, unknown> | undefined;
	return String(um?.["rol"] ?? "").toLowerCase();
}

function orientadorId(u: Record<string, unknown>): string {
	const um = u["user_metadata"] as Record<string, unknown> | undefined;
	return String(um?.["orientador_id"] ?? "");
}

function alumnoIds(u: Record<string, unknown>): { cuentaId: string; padronId: string; nombre: string } {
	const um = u["user_metadata"] as Record<string, unknown> | undefined;
	return {
		cuentaId: String(um?.["cuenta_id"] ?? ""),
		padronId: String(um?.["padron_id"] ?? ""),
		nombre: String(um?.["nombre_completo"] ?? ""),
	};
}

async function listarEntregas(sb: SupabaseClient, cuentaId: string) {
	const { data, error } = await sb
		.from(TABLA_ENT)
		.select(
			"tipo_documento, estado, motivo_rechazo, ruta_storage, validacion_automatica, etiqueta_personalizada",
		)
		.eq("cuenta_id", cuentaId);
	if (error) {
		return [];
	}
	return (data ?? []).map((row: Record<string, unknown>) => ({
		tipo_documento: String(row.tipo_documento),
		estado: String(row.estado),
		motivo_rechazo: row.motivo_rechazo != null ? String(row.motivo_rechazo) : null,
		ruta_storage: String(row.ruta_storage ?? ""),
		validacion_automatica: Boolean(row.validacion_automatica),
		etiqueta_personalizada:
			row.etiqueta_personalizada != null && String(row.etiqueta_personalizada).trim() !== ""
				? String(row.etiqueta_personalizada).trim()
				: null,
	}));
}

async function eliminarPreviosTipo(
	sb: SupabaseClient,
	bucket: string,
	nombreCompletoAlumno: string,
	tipo: string,
) {
	const slugAlumno = slugificar(nombreCompletoAlumno);
	const slugTipo = TIPOS_DOCUMENTO[tipo] ?? tipo;
	const prefijo = `${slugAlumno}_${slugTipo}`;
	const { data: lista, error } = await sb.storage.from(bucket).list("", { search: prefijo, limit: 50 });
	if (error || !lista?.length) {
		return;
	}
	const aBorrar = lista
		.filter((item: { name: string }) => item.name.toLowerCase().startsWith(`${prefijo.toLowerCase()}.`))
		.map((item: { name: string }) => item.name);
	if (aBorrar.length > 0) {
		await sb.storage.from(bucket).remove(aBorrar);
	}
}

Deno.serve(async (req) => {
	if (req.method === "OPTIONS") {
		return new Response("ok", { headers: corsHeaders });
	}
	if (req.method !== "POST") {
		return jsonRes({ error: "Método no permitido" }, 405);
	}
	const sb = admin();
	try {
		const ct = req.headers.get("content-type") ?? "";
		let action = "";
		let payload: Record<string, unknown> = {};
		let fileBytes: Uint8Array | null = null;
		let fileName = "";
		if (ct.includes("multipart/form-data")) {
			const form = await req.formData();
			action = String(form.get("action") ?? "");
			const p = form.get("payload");
			if (typeof p === "string") {
				try {
					payload = JSON.parse(p) as Record<string, unknown>;
				} catch {
					payload = {};
				}
			}
			const arch = form.get("archivo");
			if (arch instanceof File && arch.size > 0) {
				fileBytes = new Uint8Array(await arch.arrayBuffer());
				fileName = arch.name || "archivo.bin";
			}
		} else {
			const body = (await req.json()) as { action?: string; payload?: Record<string, unknown> };
			action = String(body.action ?? "");
			payload = body.payload ?? {};
		}
		const { u, err } = await authUser(req, sb);
		if (err || !u) {
			return jsonRes({ error: err ?? "No autenticado" }, 401);
		}
		const rol = metaRol(u);

		// --- ALUMNO ---
		if (action === "alumno.sesion") {
			if (rol !== "alumno") {
				return jsonRes({ error: "No autorizado" }, 403);
			}
			const { cuentaId, padronId, nombre } = alumnoIds(u);
			const { data: padGrado, error: errPadG } = await sb
				.from("padron_alumnos")
				.select("grado_alumno, grupo_token_id, institucion_grupo_id, carrera_id, archivo_muerto_en")
				.eq("id", padronId)
				.maybeSingle();
			if (errPadG || (padGrado?.archivo_muerto_en != null)) {
				return jsonRes({ autenticado: false }, 401);
			}
			let gradoMostrado = String((u["user_metadata"] as Record<string, unknown>)?.["grado"] ?? "");
			let gradoToken = gradoMostrado;
			if (padGrado?.grupo_token_id) {
				const { data: tok } = await sb.from("grupo_tokens").select("grado").eq("id", padGrado.grupo_token_id).maybeSingle();
				if (tok?.grado != null && String(tok.grado).trim() !== "") {
					gradoToken = String(tok.grado).trim();
				}
			} else if (padGrado?.institucion_grupo_id) {
				const { data: ig } = await sb
					.from("institucion_grupos")
					.select("grado")
					.eq("id", padGrado.institucion_grupo_id)
					.maybeSingle();
				if (ig?.grado != null && String(ig.grado).trim() !== "") {
					gradoToken = String(ig.grado).trim();
				}
			}
			gradoMostrado = gradoMostradoParaAlumno(padGrado?.grado_alumno as string | null, gradoToken);
			let carreraId: string | null =
				padGrado?.carrera_id != null && String(padGrado.carrera_id).trim() !== ""
					? String(padGrado.carrera_id).trim()
					: null;
			const reqCar = alumnoRequiereCarrera(gradoMostrado);
			let carreraNombre: string | null = null;
			let carreraCodigo: string | null = null;
			let carrerasOpciones: { id: string; codigo: string; nombre: string }[] = [];
			if (reqCar) {
				const { data: cats } = await sb.from("carreras").select("id, codigo, nombre").order("nombre", { ascending: true });
				carrerasOpciones = (cats ?? []).map((c: Record<string, unknown>) => ({
					id: String(c.id),
					codigo: String(c.codigo),
					nombre: String(c.nombre),
				}));
				if (carreraId) {
					const hit = carrerasOpciones.find((x) => x.id === carreraId);
					if (hit) {
						carreraNombre = hit.nombre;
						carreraCodigo = hit.codigo;
					}
				}
			} else {
				carreraId = null;
				carrerasOpciones = [];
			}
			const documentosTotales = Object.keys(TIPOS_DOCUMENTO).length;
			const subidosDb = (await listarEntregas(sb, cuentaId)).length;
			const porcentaje = documentosTotales > 0 ? Math.round((subidosDb / documentosTotales) * 100) : 0;
			return jsonRes({
				autenticado: true,
				nombreCompleto: nombre,
				grupo: String((u["user_metadata"] as Record<string, unknown>)?.["grupo"] ?? ""),
				grado: gradoMostrado,
				requiereCarrera: reqCar,
				carreraId,
				carreraNombre,
				carreraCodigo,
				carrerasOpciones,
				documentosTotales,
				documentosSubidos: subidosDb,
				porcentajeDocumentos: porcentaje,
			});
		}
		if (action === "alumno.documentos") {
			if (rol !== "alumno") {
				return jsonRes({ error: "No autorizado" }, 403);
			}
			const { cuentaId } = alumnoIds(u);
			const filas = await listarEntregas(sb, cuentaId);
			const porTipo = new Map(filas.map((f: { tipo_documento: string }) => [f.tipo_documento, f]));
			const documentos = Object.keys(TIPOS_DOCUMENTO).map((tipo) => {
				const f = porTipo.get(tipo) as
					| {
						estado: string;
						motivo_rechazo: string | null;
						ruta_storage: string;
						validacion_automatica: boolean;
					}
					| undefined;
				let estado = "pendiente_carga";
				let motivoRechazo: string | null = null;
				let validacionAutomatica = false;
				if (f && ["validado", "rechazado", EST_PEND].includes(f.estado)) {
					estado = f.estado;
					motivoRechazo = f.motivo_rechazo;
					validacionAutomatica = f.validacion_automatica;
				} else if (f?.ruta_storage) {
					estado = EST_PEND;
				}
				return {
					tipo,
					etiqueta: ETIQUETAS[tipo] ?? tipo,
					estado,
					motivoRechazo,
					puedeDescargar: Boolean(f?.ruta_storage),
					validacionAutomatica,
				};
			});
			return jsonRes({ documentos });
		}
		if (action === "alumno.documento.subir") {
			if (rol !== "alumno") {
				return jsonRes({ error: "No autorizado" }, 403);
			}
			const { cuentaId, padronId, nombre } = alumnoIds(u);
			let tipo = String(payload.tipoDocumento ?? "");
			let bytes: Uint8Array;
			let nomArch = "";
			if (fileBytes && fileBytes.length > 0) {
				bytes = fileBytes;
				nomArch = fileName;
			} else {
				const b64 = String(payload.fileBase64 ?? "");
				nomArch = String(payload.nombreArchivo ?? "doc.bin");
				bytes = b64ToBytes(b64);
			}
			if (!esTipoDocValido(tipo) || bytes.length === 0 || bytes.length > MAX_BYTES) {
				return jsonRes({ error: "Datos de subida no válidos" }, 400);
			}
			const bucket = bucketDocs();
			const ext = extDesdeNombre(nomArch) || "pdf";
			const nombreTecnico = nombreArchivoEstandar(nombre, tipo, ext);
			await eliminarPreviosTipo(sb, bucket, nombre, tipo);
			const { error: errS } = await sb.storage.from(bucket).upload(nombreTecnico, bytes, {
				contentType: "application/octet-stream",
				upsert: true,
			});
			if (errS) {
				return jsonRes({ error: "No se pudo guardar el archivo" }, 500);
			}
			const ahora = new Date().toISOString();
			const rawOcr = payload["ocrCampos"];
			const ocrCampos =
				rawOcr != null && typeof rawOcr === "object" && !Array.isArray(rawOcr)
					? (rawOcr as Record<string, unknown>)
					: null;
			const ocrTramiteRaw = payload["ocrTramite"];
			const ocrTramite =
				typeof ocrTramiteRaw === "string" && ocrTramiteRaw.trim() !== "" ? ocrTramiteRaw.trim() : null;
			const ocrErrorRaw = payload["ocrError"];
			const ocrError =
				typeof ocrErrorRaw === "string" && ocrErrorRaw.trim() !== "" ? ocrErrorRaw.trim() : null;
			const tieneOcrMeta =
				ocrTramite != null ||
				ocrError != null ||
				(ocrCampos != null && Object.keys(ocrCampos).length > 0);
			const ocrExtraidoEn = tieneOcrMeta ? ahora : null;
			const { error: errDb } = await sb.from(TABLA_ENT).upsert(
				{
					cuenta_id: cuentaId,
					tipo_documento: tipo,
					estado: EST_PEND,
					motivo_rechazo: null,
					ruta_storage: nombreTecnico,
					validacion_automatica: false,
					etiqueta_personalizada: null,
					actualizado_en: ahora,
					subido_en: ahora,
					ocr_campos: ocrCampos,
					ocr_tramite: ocrTramite,
					ocr_extraido_en: ocrExtraidoEn,
					ocr_error: ocrError,
				},
				{ onConflict: "cuenta_id,tipo_documento" },
			);
			if (errDb) {
				await sb.storage.from(bucket).remove([nombreTecnico]);
				return jsonRes({ error: mensajeErrorPostgrestParaCliente(errDb.message) }, 500);
			}
			return jsonRes({ ok: true, ruta: nombreTecnico });
		}
		if (action === "alumno.documento.descargar") {
			if (rol !== "alumno") {
				return jsonRes({ error: "No autorizado" }, 403);
			}
			const { cuentaId } = alumnoIds(u);
			const tipo = String(payload.tipo ?? "");
			if (!esTipoDocValido(tipo)) {
				return jsonRes({ error: "Tipo no válido" }, 400);
			}
			const { data: fila, error: errQ } = await sb
				.from(TABLA_ENT)
				.select("ruta_storage")
				.eq("cuenta_id", cuentaId)
				.eq("tipo_documento", tipo)
				.maybeSingle();
			if (errQ || !fila?.ruta_storage) {
				return jsonRes({ error: "No hay archivo" }, 404);
			}
			const { data: blob, error: errD } = await sb.storage.from(bucketDocs()).download(String(fila.ruta_storage));
			if (errD || !blob) {
				return jsonRes({ error: "No se pudo descargar" }, 500);
			}
			const buf = new Uint8Array(await blob.arrayBuffer());
			return jsonRes({ data: bytesToB64(buf) });
		}
		if (action === "alumno.documento.eliminar") {
			if (rol !== "alumno") {
				return jsonRes({ error: "No autorizado" }, 403);
			}
			const { cuentaId } = alumnoIds(u);
			const tipo = String(payload.tipo ?? "");
			if (!esTipoDocValido(tipo)) {
				return jsonRes({ error: "Tipo no válido" }, 400);
			}
			const bucket = bucketDocs();
			const { data: fila, error: errQ } = await sb
				.from(TABLA_ENT)
				.select("ruta_storage")
				.eq("cuenta_id", cuentaId)
				.eq("tipo_documento", tipo)
				.maybeSingle();
			if (errQ || !fila?.ruta_storage) {
				return jsonRes({ error: "No hay entrega para eliminar" }, 400);
			}
			await sb.storage.from(bucket).remove([String(fila.ruta_storage)]);
			await sb.from(TABLA_ENT).delete().eq("cuenta_id", cuentaId).eq("tipo_documento", tipo);
			return jsonRes({ ok: true });
		}

		// --- ORIENTADOR ---
		if (rol !== "orientador") {
			return jsonRes({ error: "No autorizado" }, 403);
		}

		if (action === "orientador.sesion") {
			const um = u["user_metadata"] as Record<string, unknown>;
			return jsonRes({
				autenticado: true,
				email: um?.["publicEmail"] ?? u["email"],
				nombre: String(um?.["nombre"] ?? ""),
			});
		}

		if (action === "orientador.expediente.listar") {
			const estado = String(payload.estado ?? "activo").toLowerCase();
			let q = sb
				.from("padron_alumnos")
				.select(
					`
				id,
				nombre_completo,
				matricula,
				grado_alumno,
				archivo_muerto_en,
				carrera_id,
				grupo_token_id,
				institucion_grupo_id,
				grupo_tokens ( grado, grupo ),
				institucion_grupos ( grado, grupo ),
				cuentas_alumno ( id )
			`,
				)
				.order("nombre_completo", { ascending: true });
			if (estado === "inactivo") {
				q = q.not("archivo_muerto_en", "is", null);
			} else {
				q = q.is("archivo_muerto_en", null);
			}
			const { data: filasRaw, error } = await q;
			if (error) {
				return jsonRes({ error: "No se pudo cargar expediente" }, 500);
			}
			const filas = filasRaw as Record<string, unknown>[];
			const idsCarrera = [
				...new Set(
					filas
						.map((f) => f.carrera_id)
						.filter((x): x is string => typeof x === "string" && x !== ""),
				),
			];
			const mapaCarrera = new Map<string, { id: string; nombre: string; codigo: string }>();
			if (idsCarrera.length > 0) {
				const { data: carreras } = await sb.from("carreras").select("id, nombre, codigo").in("id", idsCarrera);
				for (const c of carreras ?? []) {
					const row = c as Record<string, unknown>;
					mapaCarrera.set(String(row.id), {
						id: String(row.id),
						nombre: String(row.nombre),
						codigo: String(row.codigo),
					});
				}
			}
			const alumnos = filas.map((f) => {
				const gt = f.grupo_tokens as Record<string, unknown> | null;
				const ig = f.institucion_grupos as Record<string, unknown> | null;
				const gradoBase = gt?.grado != null ? String(gt.grado) : ig?.grado != null ? String(ig.grado) : "1";
				const grupoBase = gt?.grupo != null
					? String(gt.grupo).toUpperCase()
					: ig?.grupo != null
					? String(ig.grupo).toUpperCase()
					: "";
				const gradoMostrado = gradoMostradoParaAlumno(f.grado_alumno as string | null, gradoBase);
				const carrera = f.carrera_id ? mapaCarrera.get(String(f.carrera_id)) : undefined;
				const tokenId = f.grupo_token_id != null && String(f.grupo_token_id).trim() !== ""
					? String(f.grupo_token_id)
					: null;
				const igId = f.institucion_grupo_id != null && String(f.institucion_grupo_id).trim() !== ""
					? String(f.institucion_grupo_id)
					: null;
				return {
					padronId: f.id,
					nombreCompleto: f.nombre_completo,
					matricula: f.matricula ?? "",
					grado: gradoMostrado,
					grupo: grupoBase,
					grupoTokenId: tokenId,
					institucionGrupoId: igId,
					carreraId: carrera?.id ?? null,
					carreraNombre: carrera?.nombre ?? "",
					carreraCodigo: carrera?.codigo ?? "",
					estado: f.archivo_muerto_en ? "inactivo" : "activo",
					cuentaId: cuentaIdDesdePadron(f.cuentas_alumno as { id: string }[] | { id: string } | null),
				};
			});
			const carrerasFiltro = [...mapaCarrera.values()].sort((a, b) => a.nombre.localeCompare(b.nombre, "es"));
			return jsonRes({ alumnos, carreras: carrerasFiltro });
		}

		if (action === "orientador.grupos") {
			const { data: raw, error } = await sb
				.from("grupo_tokens")
				.select("id, institucion_grupo_id, grado, grupo")
				.order("grado", { ascending: true })
				.order("grupo", { ascending: true });
			if (error) {
				return jsonRes({ error: "No se pudieron cargar grupos" }, 500);
			}
			const grupos = (raw ?? []).map((g: Record<string, unknown>) => ({
				id: g.id != null ? String(g.id) : null,
				institucionGrupoId: g.institucion_grupo_id != null ? String(g.institucion_grupo_id) : null,
				grado: String(g.grado ?? ""),
				grupo: String(g.grupo ?? ""),
			}));
			return jsonRes({ grupos });
		}

		if (action === "orientador.expediente.detalle") {
			const cuentaId = String(payload.cuentaId ?? "");
			if (!cuentaId) {
				return jsonRes({ error: "cuentaId obligatorio" }, 400);
			}
			const { data: cuenta, error: errC } = await sb
				.from("cuentas_alumno")
				.select(
					`
				id,
				padron_alumnos (
					id,
					nombre_completo,
					grupo_token_id,
					institucion_grupo_id,
					grado_alumno,
					carrera_id,
					matricula
				)
			`,
				)
				.eq("id", cuentaId)
				.maybeSingle();
			if (errC || !cuenta) {
				return jsonRes({ error: "Alumno no encontrado" }, 404);
			}
			const padron = cuenta.padron_alumnos as unknown as Record<string, unknown>;
			let gradoToken = "";
			let grupoLetra = "";
			if (padron.grupo_token_id) {
				const { data: tok } = await sb
					.from("grupo_tokens")
					.select("grado, grupo")
					.eq("id", padron.grupo_token_id)
					.maybeSingle();
				if (tok) {
					gradoToken = tok.grado != null ? String(tok.grado) : "";
					grupoLetra = tok.grupo != null ? String(tok.grupo) : "";
				}
			} else if (padron.institucion_grupo_id) {
				const { data: ig } = await sb
					.from("institucion_grupos")
					.select("grado, grupo")
					.eq("id", padron.institucion_grupo_id)
					.maybeSingle();
				if (ig) {
					gradoToken = ig.grado != null ? String(ig.grado) : "";
					grupoLetra = ig.grupo != null ? String(ig.grupo) : "";
				}
			}
			const gradoMostrado = gradoMostradoParaAlumno(padron.grado_alumno as string | null, gradoToken);
			const reqCar = alumnoRequiereCarrera(gradoMostrado);
			const carreraIdRaw =
				padron.carrera_id != null && String(padron.carrera_id).trim() !== ""
					? String(padron.carrera_id).trim()
					: null;
			let carreraNombre: string | null = null;
			let carreraCodigo: string | null = null;
			if (carreraIdRaw && reqCar) {
				const { data: car } = await sb.from("carreras").select("nombre, codigo").eq("id", carreraIdRaw).maybeSingle();
				if (car) {
					carreraNombre = car.nombre != null ? String(car.nombre) : null;
					carreraCodigo = car.codigo != null ? String(car.codigo) : null;
				}
			}
			const matriculaMostrada =
				reqCar && padron.matricula != null && String(padron.matricula).trim() !== ""
					? String(padron.matricula).trim()
					: null;
			const { data: carrerasCatalogo } = await sb.from("carreras").select("id, codigo, nombre").order("nombre", { ascending: true });
			const filas = await listarEntregas(sb, cuentaId);
			const porTipo = new Map(filas.map((f: { tipo_documento: string }) => [f.tipo_documento, f]));
			const documentos = Object.keys(TIPOS_DOCUMENTO).map((tipo) => {
				const f = porTipo.get(tipo) as Record<string, unknown> | undefined;
				let estado = "pendiente_carga";
				let motivoRechazo: string | null = null;
				let validacionAutomatica = false;
				if (f && ["validado", "rechazado", EST_PEND].includes(String(f.estado))) {
					estado = String(f.estado);
					motivoRechazo = f.motivo_rechazo != null ? String(f.motivo_rechazo) : null;
					validacionAutomatica = Boolean(f.validacion_automatica);
				} else if (f?.ruta_storage) {
					estado = EST_PEND;
				}
				return {
					tipo,
					etiqueta: ETIQUETAS[tipo] ?? tipo,
					estado,
					motivoRechazo,
					puedeDescargar: Boolean(f?.ruta_storage),
					validacionAutomatica,
				};
			});
			const documentosExtras = filas
				.filter((f: { tipo_documento: string }) => esAdjuntoOrientador(f.tipo_documento))
				.map((f: Record<string, unknown>) => {
					let estado = "pendiente_carga";
					let motivoRechazo: string | null = null;
					let validacionAutomatica = false;
					if (["validado", "rechazado", EST_PEND].includes(String(f.estado))) {
						estado = String(f.estado);
						motivoRechazo = f.motivo_rechazo != null ? String(f.motivo_rechazo) : null;
						validacionAutomatica = Boolean(f.validacion_automatica);
					} else if (f.ruta_storage) {
						estado = EST_PEND;
					}
					const etiqueta =
						f.etiqueta_personalizada != null && String(f.etiqueta_personalizada).trim() !== ""
							? String(f.etiqueta_personalizada).trim()
							: "Documento adicional";
					return {
						tipo: f.tipo_documento,
						etiqueta,
						estado,
						motivoRechazo,
						puedeDescargar: Boolean(f.ruta_storage),
						validacionAutomatica,
						puedeEliminarOrientador: true,
					};
				});
			return jsonRes({
				alumno: {
					cuentaId: cuenta.id,
					padronId: padron.id,
					grupoTokenId: padron.grupo_token_id,
					institucionGrupoId: padron.institucion_grupo_id,
					nombreCompleto: padron.nombre_completo,
					grado: gradoMostrado,
					grupo: grupoLetra,
					requiereCarrera: reqCar,
					carreraId: reqCar ? carreraIdRaw : null,
					carreraNombre: reqCar ? carreraNombre : null,
					carreraCodigo: reqCar ? carreraCodigo : null,
					matricula: matriculaMostrada,
				},
				carrerasCatalogo: (carrerasCatalogo ?? []).map((c: Record<string, unknown>) => ({
					id: String(c.id),
					codigo: String(c.codigo),
					nombre: String(c.nombre),
				})),
				documentos,
				documentosExtras,
			});
		}

		if (action === "orientador.padron.patch") {
			const padronId = String(payload.padronId ?? "");
			const patch = payload.patch as Record<string, unknown> | undefined;
			if (!padronId || !patch) {
				return jsonRes({ error: "padronId y patch obligatorios" }, 400);
			}
			const update: Record<string, unknown> = {};
			if (Object.prototype.hasOwnProperty.call(patch, "matricula")) {
				const v = patch.matricula;
				update.matricula = v === null || v === "" ? null : String(v).trim();
			}
			if (Object.prototype.hasOwnProperty.call(patch, "gradoAlumno")) {
				const v = patch.gradoAlumno;
				update.grado_alumno = v === null || v === "" ? null : String(v).trim();
			}
			if (Object.prototype.hasOwnProperty.call(patch, "carreraId")) {
				const v = patch.carreraId;
				update.carrera_id = v === null || v === "" ? null : String(v).trim();
			}
			if (Object.prototype.hasOwnProperty.call(patch, "grupoTokenIdDestino")) {
				const dest = String(patch.grupoTokenIdDestino ?? "").trim();
				if (dest) {
					const { data: tok } = await sb.from("grupo_tokens").select("id, institucion_grupo_id").eq("id", dest).maybeSingle();
					if (tok) {
						update.grupo_token_id = tok.id;
						update.institucion_grupo_id = tok.institucion_grupo_id;
					}
				}
			}
			if (Object.keys(update).length === 0) {
				return jsonRes({ ok: true });
			}
			const { error } = await sb.from("padron_alumnos").update(update).eq("id", padronId);
			if (error) {
				return jsonRes({ error: mensajeErrorPostgrestParaCliente(error.message) }, 500);
			}
			return jsonRes({ ok: true });
		}

		if (action === "orientador.documento.subir") {
			const cuentaId = String(payload.cuentaId ?? "");
			let etiqueta = String(payload.etiqueta ?? "Documento adicional").trim().slice(0, 80);
			if (!cuentaId) {
				return jsonRes({ error: "cuentaId obligatorio" }, 400);
			}
			if (!etiqueta) {
				etiqueta = "Documento adicional";
			}
			let bytes: Uint8Array;
			let nomArch: string;
			if (fileBytes && fileBytes.length > 0) {
				bytes = fileBytes;
				nomArch = fileName;
			} else {
				bytes = b64ToBytes(String(payload.fileBase64 ?? ""));
				nomArch = String(payload.nombreArchivo ?? "adjunto.pdf");
			}
			if (bytes.length === 0 || bytes.length > MAX_BYTES) {
				return jsonRes({ error: "Archivo no válido" }, 400);
			}
			const bucket = bucketDocs();
			const { data: cuenta, error: errC } = await sb
				.from("cuentas_alumno")
				.select("id, padron_alumnos ( nombre_completo )")
				.eq("id", cuentaId)
				.maybeSingle();
			if (errC || !cuenta) {
				return jsonRes({ error: "Cuenta no encontrada" }, 404);
			}
			const pad = cuenta.padron_alumnos as unknown as { nombre_completo: string };
			const nombreCompleto = pad?.nombre_completo ?? "";
			const ext = extDesdeNombre(nomArch) || "pdf";
			const slugAlumno = slugificar(nombreCompleto);
			const tipoNuevo = crearTipoAdjuntoOrientador();
			const nombreTecnico = nombreRutaAdjuntoOrientador(slugAlumno, etiqueta, tipoNuevo, ext);
			const { error: errS } = await sb.storage.from(bucket).upload(nombreTecnico, bytes, {
				contentType: "application/pdf",
				upsert: true,
			});
			if (errS) {
				return jsonRes({ error: "No se pudo guardar el archivo" }, 500);
			}
			const ahora = new Date().toISOString();
			const rawOcrAdj = payload["ocrCampos"];
			const ocrCamposAdj =
				rawOcrAdj != null && typeof rawOcrAdj === "object" && !Array.isArray(rawOcrAdj)
					? (rawOcrAdj as Record<string, unknown>)
					: null;
			const ocrTramiteAdjRaw = payload["ocrTramite"];
			const ocrTramiteAdj =
				typeof ocrTramiteAdjRaw === "string" && ocrTramiteAdjRaw.trim() !== ""
					? ocrTramiteAdjRaw.trim().slice(0, 64)
					: null;
			const ocrErrorAdjRaw = payload["ocrError"];
			const ocrErrorAdj =
				typeof ocrErrorAdjRaw === "string" && ocrErrorAdjRaw.trim() !== "" ? ocrErrorAdjRaw.trim().slice(0, 2000) : null;
			const tieneOcrMetaAdj =
				ocrTramiteAdj != null ||
				ocrErrorAdj != null ||
				(ocrCamposAdj != null && Object.keys(ocrCamposAdj).length > 0);
			const ocrExtraidoEnAdj = tieneOcrMetaAdj ? ahora : null;
			const { error: errDb } = await sb.from(TABLA_ENT).upsert(
				{
					cuenta_id: cuentaId,
					tipo_documento: tipoNuevo,
					estado: EST_PEND,
					motivo_rechazo: null,
					ruta_storage: nombreTecnico,
					validacion_automatica: false,
					etiqueta_personalizada: etiqueta,
					actualizado_en: ahora,
					subido_en: ahora,
					ocr_campos: ocrCamposAdj,
					ocr_tramite: ocrTramiteAdj,
					ocr_extraido_en: ocrExtraidoEnAdj,
					ocr_error: ocrErrorAdj,
				},
				{ onConflict: "cuenta_id,tipo_documento" },
			);
			if (errDb) {
				await sb.storage.from(bucket).remove([nombreTecnico]);
				return jsonRes({ error: mensajeErrorPostgrestParaCliente(errDb.message) }, 500);
			}
			return jsonRes({ ok: true, tipoDocumento: tipoNuevo, nombreTecnico, etiqueta });
		}

		if (action === "orientador.documento.descargar") {
			const cuentaId = String(payload.cuentaId ?? "");
			const tipo = String(payload.tipo ?? "");
			if (!cuentaId || !tipo) {
				return jsonRes({ error: "Parámetros incompletos" }, 400);
			}
			const { data: fila, error: errQ } = await sb
				.from(TABLA_ENT)
				.select("ruta_storage")
				.eq("cuenta_id", cuentaId)
				.eq("tipo_documento", tipo)
				.maybeSingle();
			if (errQ || !fila?.ruta_storage) {
				return jsonRes({ error: "No hay archivo" }, 404);
			}
			const { data: blob, error: errD } = await sb.storage.from(bucketDocs()).download(String(fila.ruta_storage));
			if (errD || !blob) {
				return jsonRes({ error: "No se pudo descargar" }, 500);
			}
			const buf = new Uint8Array(await blob.arrayBuffer());
			return jsonRes({ data: bytesToB64(buf) });
		}

		if (action === "orientador.documento.eliminar") {
			const cuentaId = String(payload.cuentaId ?? "");
			const tipoDocumento = String(payload.tipoDocumento ?? "");
			if (!cuentaId || !tipoDocumento) {
				return jsonRes({ error: "Parámetros incompletos" }, 400);
			}
			const bucket = bucketDocs();
			const { data: fila, error: errQ } = await sb
				.from(TABLA_ENT)
				.select("ruta_storage")
				.eq("cuenta_id", cuentaId)
				.eq("tipo_documento", tipoDocumento)
				.maybeSingle();
			if (errQ || !fila?.ruta_storage) {
				return jsonRes({ error: "No hay entrega" }, 400);
			}
			await sb.storage.from(bucket).remove([String(fila.ruta_storage)]);
			await sb.from(TABLA_ENT).delete().eq("cuenta_id", cuentaId).eq("tipo_documento", tipoDocumento);
			return jsonRes({ ok: true });
		}

		if (action === "orientador.expediente.zip") {
			const cuentaId = String(payload.cuentaId ?? "");
			if (!cuentaId) {
				return jsonRes({ error: "cuentaId obligatorio" }, 400);
			}
			const bucket = bucketDocs();
			const { data: cuenta, error: errC } = await sb
				.from("cuentas_alumno")
				.select("id, padron_alumnos ( nombre_completo )")
				.eq("id", cuentaId)
				.maybeSingle();
			if (errC || !cuenta) {
				return jsonRes({ error: "Cuenta no encontrada" }, 404);
			}
			const padron = cuenta.padron_alumnos as unknown as { nombre_completo: string };
			const nombreCompleto = padron?.nombre_completo ?? "alumno";
			const filas = (await listarEntregas(sb, cuentaId)).filter((f: { ruta_storage: string; tipo_documento: string }) =>
				f.ruta_storage && esTipoDocValido(f.tipo_documento)
			);
			if (filas.length === 0) {
				return jsonRes({ error: "No hay archivos en el expediente" }, 404);
			}
			const zip = new JSZip();
			const slugBase = nombreCompleto.replace(/\s+/g, "_").slice(0, 40) || "expediente";
			let n = 0;
			for (const f of filas) {
				const row = f as { ruta_storage: string; tipo_documento: string };
				const { data: blob, error: errD } = await sb.storage.from(bucket).download(row.ruta_storage);
				if (errD || !blob) {
					continue;
				}
				const buf = new Uint8Array(await blob.arrayBuffer());
				const ext = row.ruta_storage.includes(".") ? row.ruta_storage.split(".").pop() ?? "pdf" : "pdf";
				const nombreEnZip = nombreArchivoEstandar(nombreCompleto, row.tipo_documento, ext);
				zip.file(`${slugBase}/${nombreEnZip}`, buf);
				n++;
			}
			if (n === 0) {
				return jsonRes({ error: "No se pudieron leer archivos" }, 500);
			}
			const out = await zip.generateAsync({ type: "uint8array" });
			return jsonRes({ data: bytesToB64(out), nombre: `${slugBase}_expediente.zip` });
		}

		if (action === "orientador.plantillas.crear") {
			const titulo = String(payload.titulo ?? "").trim();
			let bytes: Uint8Array;
			let nom: string;
			if (fileBytes && fileBytes.length > 0) {
				bytes = fileBytes;
				nom = fileName || String(payload.nombreArchivo ?? "plantilla.pdf");
			} else {
				bytes = b64ToBytes(String(payload.fileBase64 ?? ""));
				nom = String(payload.nombreArchivo ?? "plantilla.pdf");
			}
			if (!titulo || bytes.length === 0 || bytes.length > MAX_PLANTILLA) {
				return jsonRes({ error: "Datos no válidos" }, 400);
			}
			const bucket = bucketPlantillas();
			const oid = orientadorId(u);
			const ruta = `plantillas/${oid}/${crypto.randomUUID()}.pdf`;
			const { error: errS } = await sb.storage.from(bucket).upload(ruta, bytes, {
				contentType: "application/pdf",
				upsert: false,
			});
			if (errS) {
				return jsonRes({ error: "No se pudo subir plantilla" }, 500);
			}
			const { error: errI } = await sb.from("orientador_plantillas").insert({
				titulo,
				nombre_archivo: nom.toLowerCase().endsWith(".pdf") ? nom : `${nom}.pdf`,
				ruta_storage: ruta,
			});
			if (errI) {
				await sb.storage.from(bucket).remove([ruta]);
				return jsonRes({ error: mensajeErrorPostgrestParaCliente(errI.message) }, 500);
			}
			return jsonRes({ ok: true });
		}

		return jsonRes({ error: `Acción desconocida: ${action}` }, 400);
	} catch (e) {
		const msg = mensajeErrorCapturaParaCliente(e);
		console.error(e);
		return jsonRes({ error: msg }, 500);
	}
});
