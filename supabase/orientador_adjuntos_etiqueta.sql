-- Adjuntos extra del orientador (citatorios, etc.): etiqueta legible en la UI.
-- Ejecutar en Supabase SQL Editor si la tabla ya existía sin esta columna.

alter table public.entregas_documento_alumno add column if not exists etiqueta_personalizada text;

comment on column public.entregas_documento_alumno.etiqueta_personalizada is 'Nombre legible para adjuntos orientador_adjunto_* (citatorios, etc.). NULL en los 5 documentos del trámite.';
