-- =============================================================================
-- AIDA ORIENTACION - NUEVA LOGICA (BASE INICIAL)
-- Archivo incremental para la nueva etapa del panel orientador.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1) Catalogo de estado del expediente
-- -----------------------------------------------------------------------------
do $$
begin
	if not exists (
		select 1
		from pg_type
		where typname = 'estado_expediente_orientacion'
	) then
		create type public.estado_expediente_orientacion as enum ('activo', 'inactivo');
	end if;
end$$;

-- -----------------------------------------------------------------------------
-- 2) Vista base para expediente (orientacion)
--    Unifica nombre, matricula, grado, grupo, carrera y estado activo/inactivo.
-- -----------------------------------------------------------------------------
create or replace view public.v_orientacion_expediente as
select
	pa.id as padron_id,
	pa.nombre_completo,
	coalesce(pa.matricula, '') as matricula,
	coalesce(nullif(pa.grado_alumno, ''), gt.grado::text, ig.grado::text, '1') as grado,
	coalesce(gt.grupo, ig.grupo, '') as grupo,
	pa.carrera_id,
	coalesce(c.nombre, '') as carrera_nombre,
	coalesce(c.codigo, '') as carrera_codigo,
	case
		when pa.archivo_muerto_en is null then 'activo'::public.estado_expediente_orientacion
		else 'inactivo'::public.estado_expediente_orientacion
	end as estado,
	ca.id as cuenta_id,
	pa.creado_en,
	pa.archivo_muerto_en
from public.padron_alumnos pa
left join public.grupo_tokens gt on gt.id = pa.grupo_token_id
left join public.institucion_grupos ig on ig.id = pa.institucion_grupo_id
left join public.carreras c on c.id = pa.carrera_id
left join public.cuentas_alumno ca on ca.padron_id = pa.id;

comment on view public.v_orientacion_expediente is
	'Vista principal para la seccion Expediente del orientador.';

-- -----------------------------------------------------------------------------
-- 3) Funcion de busqueda para expediente
-- -----------------------------------------------------------------------------
create or replace function public.fn_orientacion_expediente_buscar(
	p_estado public.estado_expediente_orientacion default 'activo',
	p_grado text default '',
	p_grupo text default '',
	p_carrera_id uuid default null,
	p_nombre text default '',
	p_matricula text default ''
)
returns table (
	padron_id uuid,
	nombre_completo text,
	matricula text,
	grado text,
	grupo text,
	carrera_id uuid,
	carrera_nombre text,
	carrera_codigo text,
	estado public.estado_expediente_orientacion,
	cuenta_id uuid
)
language sql
stable
as $$
	select
		v.padron_id,
		v.nombre_completo,
		v.matricula,
		v.grado,
		upper(v.grupo) as grupo,
		v.carrera_id,
		v.carrera_nombre,
		v.carrera_codigo,
		v.estado,
		v.cuenta_id
	from public.v_orientacion_expediente v
	where
		v.estado = p_estado
		and (trim(p_grado) = '' or v.grado = trim(p_grado))
		and (trim(p_grupo) = '' or upper(v.grupo) = upper(trim(p_grupo)))
		and (p_carrera_id is null or v.carrera_id = p_carrera_id)
		and (trim(p_nombre) = '' or v.nombre_completo ilike ('%' || trim(p_nombre) || '%'))
		and (trim(p_matricula) = '' or v.matricula ilike ('%' || trim(p_matricula) || '%'))
	order by v.nombre_completo asc;
$$;

comment on function public.fn_orientacion_expediente_buscar(
	public.estado_expediente_orientacion,
	text,
	text,
	uuid,
	text,
	text
) is 'Busqueda principal de alumnos para Expediente (activo/inactivo + filtros).';

-- -----------------------------------------------------------------------------
-- 4) Indices recomendados para rendimiento de busqueda
-- -----------------------------------------------------------------------------
create index if not exists idx_padron_archivo_muerto_en
	on public.padron_alumnos (archivo_muerto_en);

create index if not exists idx_padron_nombre_completo
	on public.padron_alumnos (nombre_completo);

create index if not exists idx_padron_matricula
	on public.padron_alumnos (matricula);

create index if not exists idx_padron_carrera_id
	on public.padron_alumnos (carrera_id);

create index if not exists idx_padron_grado_alumno
	on public.padron_alumnos (grado_alumno);

-- -----------------------------------------------------------------------------
-- Nota:
-- Este archivo es la base inicial. Aqui iremos agregando Escaner, Crear tabla,
-- Cargas, Plantillas y Periodos con la nueva logica.
-- -----------------------------------------------------------------------------

