-- =============================================================================
-- AIDA: migración — cargas sin clave global; cada grupo usa su fila en grupo_tokens
-- Ejecutar una vez en bases que ya tenían cargas_alumnos.clave_acceso.
-- =============================================================================

drop index if exists public.uq_cargas_alumnos_clave_acceso;

alter table public.cargas_alumnos drop constraint if exists cargas_clave_no_vacia;

alter table public.cargas_alumnos drop column if exists clave_acceso;

comment on table public.cargas_alumnos is
	'Lote de inscripción: fecha de cierre común y letras de grupo; la clave de acceso por grupo está en grupo_tokens (una por sección).';
