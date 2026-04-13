-- Ejecutar en Supabase SQL Editor si periodo_grupo_tokens apuntaba a periodos_academicos.
-- Tras esto, periodo_id referencia orientador_semestre_fechas (mismo id que usa «Guardar periodos»).

alter table public.periodo_grupo_tokens drop constraint if exists periodo_grupo_tokens_periodo_id_fkey;

truncate table public.periodo_grupo_tokens;

alter table public.periodo_grupo_tokens
	add constraint periodo_grupo_tokens_periodo_id_fkey
	foreign key (periodo_id) references public.orientador_semestre_fechas (id) on delete cascade;
