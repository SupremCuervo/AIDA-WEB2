-- Periodos académicos, asignación de grupos por periodo y fechas de cambio de semestre.
-- Ejecutar en Supabase SQL Editor después del schema principal.
--
-- Si ya tenías la tabla orientador_semestre_fechas sin nombre_anios y da error PGRST204,
-- puedes ejecutar solo: supabase/migracion_nombre_anios_semestre.sql
-- Tras ALTER, en Dashboard → Settings → API a veces hace falta unos segundos para refrescar el esquema.
--
-- Si periodo_grupo_tokens apuntaba a periodos_academicos (instalación antigua), ejecuta:
-- supabase/migracion_periodo_grupos_a_semestre.sql

-- Un registro (o el primero que exista) define las dos fechas anuales de referencia para cambio de semestre / subida de grado.
create table if not exists public.orientador_semestre_fechas (
	id uuid primary key default gen_random_uuid(),
	primer_periodo_fecha date,
	segundo_periodo_fecha date,
	-- Identificador legible: años de cada fecha, ej. 2030-2034 (2 feb 2030 y 4 feb 2034).
	nombre_anios text,
	actualizado_en timestamptz not null default now()
);

comment on table public.orientador_semestre_fechas is 'Fechas de referencia (calendario escolar) para procesos automáticos de cambio de semestre; la app usa normalmente una sola fila.';

-- Si la tabla ya existía sin esta columna (instalaciones anteriores):
alter table public.orientador_semestre_fechas add column if not exists nombre_anios text;

comment on column public.orientador_semestre_fechas.nombre_anios is 'Nombre derivado al guardar: AAAA-AAAA según el año de primer_periodo_fecha y segundo_periodo_fecha.';

alter table public.orientador_semestre_fechas enable row level security;

-- (Opcional / legado) Ventana por fechas; la app ya no crea periodos aquí: el historial usa el ciclo de semestre.
create table if not exists public.periodos_academicos (
	id uuid primary key default gen_random_uuid(),
	fecha_inicio date not null,
	fecha_fin date not null,
	creado_en timestamptz not null default now(),
	constraint periodos_academicos_fechas_ok check (fecha_fin >= fecha_inicio)
);

comment on table public.periodos_academicos is 'Legado: ventana por fechas. La asignación de grupos va por orientador_semestre_fechas.';

create index if not exists idx_periodos_academicos_inicio on public.periodos_academicos (fecha_inicio desc);

alter table public.periodos_academicos enable row level security;

-- Secciones del catálogo por ciclo de semestre (misma fila que las fechas y nombre AAAA-AAAA).
-- Instalaciones antiguas: migración supabase/migracion_padron_institucion_grupo.sql (periodo_grupo_tokens → aquí).
create table if not exists public.periodo_institucion_grupos (
	periodo_id uuid not null references public.orientador_semestre_fechas (id) on delete cascade,
	institucion_grupo_id uuid not null references public.institucion_grupos (id) on delete cascade,
	asignado_en timestamptz not null default now(),
	primary key (periodo_id, institucion_grupo_id)
);

create index if not exists idx_periodo_institucion_grupos_ig on public.periodo_institucion_grupos (institucion_grupo_id);

alter table public.periodo_institucion_grupos enable row level security;

comment on table public.periodo_institucion_grupos is 'Secciones (grado+letra) asignadas al periodo de semestre (orientador_semestre_fechas.id).';
