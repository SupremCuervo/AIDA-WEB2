import type { SupabaseClient } from "@supabase/supabase-js";
import { ESTADOS_ENTREGA_DOCUMENTO, type EstadoEntregaDocumentoPersistido } from "@/lib/alumno/estado-documento";
import { mensajeCausaParaUsuario } from "@/lib/mensaje-red-amigable";
import type { CampoOcrCelda } from "@/lib/ocr/campos-ocr-vista";
import { parseCamposOcrDesdeJson } from "@/lib/ocr/campos-ocr-vista";
import { slugificar, TIPOS_DOCUMENTO, type TipoDocumentoClave } from "@/lib/nombre-archivo";

const TABLA_ENTREGAS = "entregas_documento_alumno";

export async function contarEntregasPorCuenta(
	supabase: SupabaseClient,
	cuentaId: string,
): Promise<number> {
	const tiposObligatorios = Object.keys(TIPOS_DOCUMENTO);
	const { data, error } = await supabase
		.from(TABLA_ENTREGAS)
		.select("tipo_documento")
		.eq("cuenta_id", cuentaId)
		.in("tipo_documento", tiposObligatorios);
	if (error) {
		console.error("contarEntregasPorCuenta", error);
		return 0;
	}
	return data?.length ?? 0;
}

export async function eliminarArchivosPreviosDelTipo(
	supabase: SupabaseClient,
	bucket: string,
	nombreCompletoAlumno: string,
	tipo: TipoDocumentoClave,
): Promise<void> {
	const slugAlumno = slugificar(nombreCompletoAlumno);
	const slugTipo = TIPOS_DOCUMENTO[tipo];
	const prefijo = `${slugAlumno}_${slugTipo}`;
	const { data: lista, error } = await supabase.storage.from(bucket).list("", {
		search: prefijo,
		limit: 50,
	});
	if (error || !lista?.length) {
		return;
	}
	const aBorrar = lista
		.filter((item) => item.name.toLowerCase().startsWith(`${prefijo.toLowerCase()}.`))
		.map((item) => item.name);
	if (aBorrar.length > 0) {
		await supabase.storage.from(bucket).remove(aBorrar);
	}
}

export type FilaEntrega = {
	tipo_documento: string;
	estado: string;
	motivo_rechazo: string | null;
	ruta_storage: string;
	validacion_automatica: boolean;
	etiqueta_personalizada: string | null;
	ocr_campos: Record<string, CampoOcrCelda> | null;
	ocr_tramite: string | null;
	ocr_extraido_en: string | null;
	ocr_error: string | null;
};

export async function listarEntregasPorCuenta(
	supabase: SupabaseClient,
	cuentaId: string,
): Promise<FilaEntrega[]> {
	const { data, error } = await supabase
		.from(TABLA_ENTREGAS)
		.select(
			"tipo_documento, estado, motivo_rechazo, ruta_storage, validacion_automatica, etiqueta_personalizada, ocr_campos, ocr_tramite, ocr_extraido_en, ocr_error",
		)
		.eq("cuenta_id", cuentaId);
	if (error) {
		console.error("listarEntregasPorCuenta", error);
		return [];
	}
	return (data ?? []).map((row) => {
		const r = row as Record<string, unknown>;
		return {
			tipo_documento: String(r.tipo_documento),
			estado: String(r.estado),
			motivo_rechazo: r.motivo_rechazo != null ? String(r.motivo_rechazo) : null,
			ruta_storage: String(r.ruta_storage ?? ""),
			validacion_automatica: Boolean(r.validacion_automatica),
			etiqueta_personalizada:
				r.etiqueta_personalizada != null && String(r.etiqueta_personalizada).trim() !== ""
					? String(r.etiqueta_personalizada).trim()
					: null,
			ocr_campos: parseCamposOcrDesdeJson(r.ocr_campos),
			ocr_tramite: r.ocr_tramite != null && String(r.ocr_tramite).trim() !== "" ? String(r.ocr_tramite).trim() : null,
			ocr_extraido_en:
				r.ocr_extraido_en != null && String(r.ocr_extraido_en).trim() !== ""
					? String(r.ocr_extraido_en).trim()
					: null,
			ocr_error: r.ocr_error != null && String(r.ocr_error).trim() !== "" ? String(r.ocr_error).trim() : null,
		};
	});
}

export async function upsertEntregaDocumento(
	supabase: SupabaseClient,
	params: {
		cuentaId: string;
		tipoDocumento: TipoDocumentoClave;
		estado: EstadoEntregaDocumentoPersistido;
		rutaStorage: string;
		validacionAutomatica: boolean;
		ocrCampos: Record<string, CampoOcrCelda> | null;
		ocrTramite: string | null;
		ocrExtraidoEn: string | null;
		ocrError: string | null;
	},
): Promise<{ error: Error | null }> {
	const ahora = new Date().toISOString();
	const { error } = await supabase.from(TABLA_ENTREGAS).upsert(
		{
			cuenta_id: params.cuentaId,
			tipo_documento: params.tipoDocumento,
			estado: params.estado,
			motivo_rechazo: null,
			ruta_storage: params.rutaStorage,
			validacion_automatica: params.validacionAutomatica,
			etiqueta_personalizada: null,
			actualizado_en: ahora,
			subido_en: ahora,
			ocr_campos: params.ocrCampos,
			ocr_tramite: params.ocrTramite,
			ocr_extraido_en: params.ocrExtraidoEn,
			ocr_error: params.ocrError,
		},
		{ onConflict: "cuenta_id,tipo_documento" },
	);
	return { error: error ? new Error(mensajeCausaParaUsuario(error)) : null };
}

export async function upsertEntregaAdjuntoOrientador(
	supabase: SupabaseClient,
	params: {
		cuentaId: string;
		tipoDocumento: string;
		estado: EstadoEntregaDocumentoPersistido;
		rutaStorage: string;
		validacionAutomatica: boolean;
		etiquetaPersonalizada: string | null;
		ocrCampos: Record<string, CampoOcrCelda> | null;
		ocrTramite: string | null;
		ocrExtraidoEn: string | null;
		ocrError: string | null;
	},
): Promise<{ error: Error | null }> {
	const ahora = new Date().toISOString();
	const { error } = await supabase.from(TABLA_ENTREGAS).upsert(
		{
			cuenta_id: params.cuentaId,
			tipo_documento: params.tipoDocumento,
			estado: params.estado,
			motivo_rechazo: null,
			ruta_storage: params.rutaStorage,
			validacion_automatica: params.validacionAutomatica,
			etiqueta_personalizada: params.etiquetaPersonalizada,
			actualizado_en: ahora,
			subido_en: ahora,
			ocr_campos: params.ocrCampos,
			ocr_tramite: params.ocrTramite,
			ocr_extraido_en: params.ocrExtraidoEn,
			ocr_error: params.ocrError,
		},
		{ onConflict: "cuenta_id,tipo_documento" },
	);
	return { error: error ? new Error(mensajeCausaParaUsuario(error)) : null };
}

export async function actualizarOcrCamposEnEntrega(
	supabase: SupabaseClient,
	cuentaId: string,
	tipoDocumento: string,
	nuevoOcrCampos: Record<string, CampoOcrCelda>,
): Promise<{ error: Error | null }> {
	const { data: existente, error: errQ } = await supabase
		.from(TABLA_ENTREGAS)
		.select("ruta_storage")
		.eq("cuenta_id", cuentaId)
		.eq("tipo_documento", tipoDocumento)
		.maybeSingle();
	if (errQ) {
		return { error: new Error(mensajeCausaParaUsuario(errQ)) };
	}
	const ruta = existente?.ruta_storage != null ? String(existente.ruta_storage).trim() : "";
	if (!ruta) {
		return { error: new Error("No hay documento subido para este tipo") };
	}
	const ahora = new Date().toISOString();
	const { error } = await supabase
		.from(TABLA_ENTREGAS)
		.update({
			ocr_campos: nuevoOcrCampos,
			ocr_error: null,
			actualizado_en: ahora,
		})
		.eq("cuenta_id", cuentaId)
		.eq("tipo_documento", tipoDocumento);
	return { error: error ? new Error(mensajeCausaParaUsuario(error)) : null };
}

export async function eliminarEntregaPorCuentaYTipo(
	supabase: SupabaseClient,
	bucket: string,
	cuentaId: string,
	tipoDocumento: string,
): Promise<{ error: Error | null }> {
	const { data: fila, error: errQ } = await supabase
		.from(TABLA_ENTREGAS)
		.select("ruta_storage")
		.eq("cuenta_id", cuentaId)
		.eq("tipo_documento", tipoDocumento)
		.maybeSingle();
	if (errQ) {
		return { error: new Error(errQ.message) };
	}
	if (!fila?.ruta_storage) {
		return { error: new Error("No hay entrega para eliminar") };
	}
	const ruta = String(fila.ruta_storage);
	const { error: errS } = await supabase.storage.from(bucket).remove([ruta]);
	if (errS) {
		console.error("eliminarEntrega storage", errS);
	}
	const { error: errD } = await supabase
		.from(TABLA_ENTREGAS)
		.delete()
		.eq("cuenta_id", cuentaId)
		.eq("tipo_documento", tipoDocumento);
	if (errD) {
		return { error: new Error(mensajeCausaParaUsuario(errD)) };
	}
	return { error: null };
}

export async function orientadorActualizarEstadoEntrega(
	supabase: SupabaseClient,
	params: {
		cuentaId: string;
		tipoDocumento: TipoDocumentoClave;
		estado: EstadoEntregaDocumentoPersistido;
		motivoRechazo: string | null;
		validacionAutomatica: boolean;
	},
): Promise<{ error: Error | null; filas: number }> {
	const ahora = new Date().toISOString();
	const { data, error } = await supabase
		.from(TABLA_ENTREGAS)
		.update({
			estado: params.estado,
			motivo_rechazo: params.motivoRechazo,
			validacion_automatica: params.validacionAutomatica,
			actualizado_en: ahora,
		})
		.eq("cuenta_id", params.cuentaId)
		.eq("tipo_documento", params.tipoDocumento)
		.select("id");
	if (error) {
		return { error: new Error(mensajeCausaParaUsuario(error)), filas: 0 };
	}
	return { error: null, filas: data?.length ?? 0 };
}
