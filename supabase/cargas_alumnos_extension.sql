-- =============================================================================
-- AIDA: extension — cargas multi-grupo con un solo token (alumno 1.° y otros grados)
-- Ejecutar después de aida_base_completa.sql (o en BD ya existente).
-- =============================================================================

create table if not exists public.cargas_alumnos (
	id uuid primary key default gen_random_uuid(),
	orientador_id uuid not null references public.orientadores (id) on delete cascade,
	fecha_cierre date not null,
	grado_carga smallint not null default 1 check (grado_carga >= 1 and grado_carga <= 6),
	grupos_letras text[] not null default array[]::text[],
	creado_en timestamptz not null default now(),
	constraint cargas_grupos_no_vacio check (cardinality(grupos_letras) > 0)
);

comment on table public.cargas_alumnos is
	'Lote de inscripción: fecha de cierre común y letras de grupo; clave por grupo en grupo_tokens (1:1 con sección).';

create table if not exists public.carga_alumnos_linea (
	id uuid primary key default gen_random_uuid(),
	carga_id uuid not null references public.cargas_alumnos (id) on delete cascade,
	grupo_letra text not null,
	nombre_completo text not null,
	padron_id uuid not null unique references public.padron_alumnos (id) on delete cascade,
	constraint carga_linea_grupo_trim check (length(trim(grupo_letra)) > 0),
	constraint carga_linea_nombre_trim check (length(trim(nombre_completo)) > 0)
);

create unique index if not exists uq_carga_linea_carga_grupo_nombre
	on public.carga_alumnos_linea (carga_id, upper(trim(grupo_letra)), trim(nombre_completo));

create index if not exists idx_carga_linea_carga on public.carga_alumnos_linea (carga_id);
create index if not exists idx_carga_linea_padron on public.carga_alumnos_linea (padron_id);

comment on table public.carga_alumnos_linea is
	'Alumno incluido en una carga; padron_id apunta al registro institucional (institucion_grupo_id).';

alter table public.cargas_alumnos enable row level security;
alter table public.carga_alumnos_linea enable row level security;
