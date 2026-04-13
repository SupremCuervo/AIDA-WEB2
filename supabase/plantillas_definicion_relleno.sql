-- Zonas de relleno automático por plantilla (JSON en definicion_relleno).
-- Ejecutar en Supabase SQL Editor si la tabla ya existía sin esta columna.

alter table public.orientador_plantillas
	add column if not exists definicion_relleno jsonb;

comment on column public.orientador_plantillas.definicion_relleno is
	'Definición de campos: posición % en cada página y clave de dato del alumno (ver plantilla-definicion-relleno en el código).';
