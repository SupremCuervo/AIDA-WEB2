-- Campos extraídos por el servicio OCR (API-OCR) por entrega de documento.
-- Ejecutar en Supabase SQL Editor si la tabla ya existe sin estas columnas.

alter table public.entregas_documento_alumno
	add column if not exists ocr_campos jsonb;

alter table public.entregas_documento_alumno
	add column if not exists ocr_tramite text;

alter table public.entregas_documento_alumno
	add column if not exists ocr_extraido_en timestamptz;

alter table public.entregas_documento_alumno
	add column if not exists ocr_error text;

comment on column public.entregas_documento_alumno.ocr_campos is
	'JSON: clave → { "value": string, "confidence": number? } devuelto por /ocr/extract.';

comment on column public.entregas_documento_alumno.ocr_tramite is
	'Trámite enviado al OCR (curp, ine, acta_nacimiento, comprobante, certificado_medico).';

comment on column public.entregas_documento_alumno.ocr_extraido_en is
	'Marca de tiempo de la última extracción OCR guardada.';

comment on column public.entregas_documento_alumno.ocr_error is
	'Último error corto si no hubo extracción (ej. timeout, servicio no configurado).';
