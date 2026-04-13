-- Ejecutar una vez en Supabase → SQL Editor (corrige PGRST204 si falta la columna).
alter table public.orientador_semestre_fechas add column if not exists nombre_anios text;

comment on column public.orientador_semestre_fechas.nombre_anios is 'AAAA-AAAA según año de primer_periodo_fecha y segundo_periodo_fecha.';
