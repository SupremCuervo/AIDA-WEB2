-- =============================================================================
-- AIDA: politicas RLS por rol (alumno, orientador, admin)
-- =============================================================================
-- Objetivo:
--	1) Documentos y expedientes visibles por propietario (alumno)
--	2) Orientador solo ve expedientes de sus alumnos
--	3) Admin ve todo
--
-- Nota importante:
--	Si la API usa service_role, RLS se omite por defecto.
--	Para "forzar" estas politicas en runtime, usar:
--	alter role service_role set row_security = on;
--	o ejecutar consultas con un rol no-bypassrls.
-- =============================================================================

create extension if not exists "pgcrypto";

-- -----------------------------------------------------------------------------
-- 1) Tabla puente: orientador -> secciones/grupos permitidos
-- -----------------------------------------------------------------------------
create table if not exists public.orientador_institucion_grupos (
	orientador_id uuid not null references public.orientadores (id) on delete cascade,
	institucion_grupo_id uuid not null references public.institucion_grupos (id) on delete cascade,
	creado_en timestamptz not null default now(),
	primary key (orientador_id, institucion_grupo_id)
);

alter table public.orientador_institucion_grupos enable row level security;

comment on table public.orientador_institucion_grupos is
	'Relacion de secciones asignadas a cada orientador para delimitar alumnos y expedientes visibles.';

-- -----------------------------------------------------------------------------
-- 2) Helpers de claims JWT para RLS
-- -----------------------------------------------------------------------------
create or replace function public.rls_claim_text(clave text)
returns text
language sql
stable
as $$
	select coalesce(
		(current_setting('request.jwt.claims', true)::jsonb ->> clave),
		''
	);
$$;

create or replace function public.rls_claim_uuid(clave text)
returns uuid
language plpgsql
stable
as $$
declare
	v_text text;
begin
	v_text := public.rls_claim_text(clave);
	if v_text is null or btrim(v_text) = '' then
		return null;
	end if;
	return v_text::uuid;
exception
	when others then
		return null;
end;
$$;

create or replace function public.rls_actor_rol()
returns text
language sql
stable
as $$
	select lower(coalesce(nullif(public.rls_claim_text('rol'), ''), nullif(public.rls_claim_text('role'), ''), ''));
$$;

create or replace function public.rls_is_admin()
returns boolean
language sql
stable
as $$
	select public.rls_actor_rol() = 'admin';
$$;

create or replace function public.rls_is_orientador()
returns boolean
language sql
stable
as $$
	select public.rls_actor_rol() = 'orientador';
$$;

create or replace function public.rls_is_alumno()
returns boolean
language sql
stable
as $$
	select public.rls_actor_rol() = 'alumno';
$$;

create or replace function public.rls_actor_padron_id()
returns uuid
language sql
stable
as $$
	select coalesce(public.rls_claim_uuid('padron_id'), public.rls_claim_uuid('padronId'));
$$;

create or replace function public.rls_actor_cuenta_id()
returns uuid
language sql
stable
as $$
	select coalesce(public.rls_claim_uuid('cuenta_id'), public.rls_claim_uuid('cuentaId'));
$$;

create or replace function public.rls_actor_orientador_id()
returns uuid
language sql
stable
as $$
	select coalesce(public.rls_claim_uuid('orientador_id'), public.rls_claim_uuid('orientadorId'));
$$;

-- -----------------------------------------------------------------------------
-- 3) Predicados de negocio reutilizables
-- -----------------------------------------------------------------------------
create or replace function public.rls_orientador_tiene_grupo(institucion_grupo_id uuid)
returns boolean
language sql
stable
as $$
	select exists (
		select 1
		from public.orientador_institucion_grupos oig
		where
			oig.orientador_id = public.rls_actor_orientador_id()
			and oig.institucion_grupo_id = rls_orientador_tiene_grupo.institucion_grupo_id
	);
$$;

create or replace function public.rls_orientador_ve_padron(p_padron_id uuid)
returns boolean
language sql
stable
as $$
	select exists (
		select 1
		from public.padron_alumnos p
		left join public.grupo_tokens gt on gt.id = p.grupo_token_id
		where
			p.id = p_padron_id
			and public.rls_orientador_tiene_grupo(coalesce(p.institucion_grupo_id, gt.institucion_grupo_id))
	);
$$;

create or replace function public.rls_orientador_ve_cuenta(p_cuenta_id uuid)
returns boolean
language sql
stable
as $$
	select exists (
		select 1
		from public.cuentas_alumno c
		where
			c.id = p_cuenta_id
			and public.rls_orientador_ve_padron(c.padron_id)
	);
$$;

-- -----------------------------------------------------------------------------
-- 4) Limpieza de politicas previas para idempotencia
-- -----------------------------------------------------------------------------
drop policy if exists p_admin_all_orientadores on public.orientadores;
drop policy if exists p_admin_all_orientador_institucion_grupos on public.orientador_institucion_grupos;
drop policy if exists p_orientador_self_read on public.orientadores;
drop policy if exists p_orientador_self_update on public.orientadores;

drop policy if exists p_admin_all_institucion_grupos on public.institucion_grupos;
drop policy if exists p_orientador_read_institucion_grupos_asignados on public.institucion_grupos;
drop policy if exists p_orientador_read_grupo_tokens_asignados on public.grupo_tokens;
drop policy if exists p_admin_all_grupo_tokens on public.grupo_tokens;

drop policy if exists p_admin_all_padron on public.padron_alumnos;
drop policy if exists p_alumno_read_own_padron on public.padron_alumnos;
drop policy if exists p_orientador_read_padron_asignado on public.padron_alumnos;
drop policy if exists p_orientador_update_padron_asignado on public.padron_alumnos;

drop policy if exists p_admin_all_cuentas on public.cuentas_alumno;
drop policy if exists p_alumno_read_own_cuenta on public.cuentas_alumno;
drop policy if exists p_alumno_update_own_cuenta on public.cuentas_alumno;
drop policy if exists p_orientador_read_cuentas_asignadas on public.cuentas_alumno;

drop policy if exists p_admin_all_entregas on public.entregas_documento_alumno;
drop policy if exists p_alumno_rw_own_entregas on public.entregas_documento_alumno;
drop policy if exists p_orientador_read_entregas_asignadas on public.entregas_documento_alumno;
drop policy if exists p_orientador_update_entregas_asignadas on public.entregas_documento_alumno;

drop policy if exists p_admin_all_plantillas on public.orientador_plantillas;
drop policy if exists p_orientador_rw_plantillas on public.orientador_plantillas;

drop policy if exists p_admin_all_logs on public.logs;
drop policy if exists p_orientador_read_logs_propios on public.logs;
drop policy if exists p_alumno_read_logs_propios on public.logs;

drop policy if exists p_public_read_carreras on public.carreras;
drop policy if exists p_admin_all_carreras on public.carreras;

drop policy if exists p_admin_all_semestre on public.orientador_semestre_fechas;
drop policy if exists p_orientador_read_semestre on public.orientador_semestre_fechas;
drop policy if exists p_orientador_write_semestre on public.orientador_semestre_fechas;

drop policy if exists p_admin_all_periodo_ig on public.periodo_institucion_grupos;
drop policy if exists p_orientador_read_periodo_ig_asignado on public.periodo_institucion_grupos;
drop policy if exists p_orientador_write_periodo_ig_asignado on public.periodo_institucion_grupos;

-- -----------------------------------------------------------------------------
-- 5) Politicas por tabla
-- -----------------------------------------------------------------------------

-- ORIENTADORES
create policy p_admin_all_orientadores
on public.orientadores
for all
using (public.rls_is_admin())
with check (public.rls_is_admin());

create policy p_orientador_self_read
on public.orientadores
for select
using (id = public.rls_actor_orientador_id());

create policy p_orientador_self_update
on public.orientadores
for update
using (id = public.rls_actor_orientador_id())
with check (id = public.rls_actor_orientador_id());

-- ORIENTADOR <-> GRUPOS
create policy p_admin_all_orientador_institucion_grupos
on public.orientador_institucion_grupos
for all
using (public.rls_is_admin())
with check (public.rls_is_admin());

-- INSTITUCION_GRUPOS
create policy p_admin_all_institucion_grupos
on public.institucion_grupos
for all
using (public.rls_is_admin())
with check (public.rls_is_admin());

create policy p_orientador_read_institucion_grupos_asignados
on public.institucion_grupos
for select
using (
	public.rls_is_orientador()
	and public.rls_orientador_tiene_grupo(id)
);

-- GRUPO_TOKENS
create policy p_admin_all_grupo_tokens
on public.grupo_tokens
for all
using (public.rls_is_admin())
with check (public.rls_is_admin());

create policy p_orientador_read_grupo_tokens_asignados
on public.grupo_tokens
for select
using (
	public.rls_is_orientador()
	and public.rls_orientador_tiene_grupo(institucion_grupo_id)
);

-- PADRON_ALUMNOS (expediente logico del alumno)
create policy p_admin_all_padron
on public.padron_alumnos
for all
using (public.rls_is_admin())
with check (public.rls_is_admin());

create policy p_alumno_read_own_padron
on public.padron_alumnos
for select
using (
	public.rls_is_alumno()
	and id = public.rls_actor_padron_id()
);

create policy p_orientador_read_padron_asignado
on public.padron_alumnos
for select
using (
	public.rls_is_orientador()
	and public.rls_orientador_ve_padron(id)
);

create policy p_orientador_update_padron_asignado
on public.padron_alumnos
for update
using (
	public.rls_is_orientador()
	and public.rls_orientador_ve_padron(id)
)
with check (
	public.rls_is_orientador()
	and public.rls_orientador_ve_padron(id)
);

-- CUENTAS_ALUMNO
create policy p_admin_all_cuentas
on public.cuentas_alumno
for all
using (public.rls_is_admin())
with check (public.rls_is_admin());

create policy p_alumno_read_own_cuenta
on public.cuentas_alumno
for select
using (
	public.rls_is_alumno()
	and id = public.rls_actor_cuenta_id()
);

create policy p_alumno_update_own_cuenta
on public.cuentas_alumno
for update
using (
	public.rls_is_alumno()
	and id = public.rls_actor_cuenta_id()
)
with check (
	public.rls_is_alumno()
	and id = public.rls_actor_cuenta_id()
);

create policy p_orientador_read_cuentas_asignadas
on public.cuentas_alumno
for select
using (
	public.rls_is_orientador()
	and public.rls_orientador_ve_cuenta(id)
);

-- ENTREGAS_DOCUMENTO_ALUMNO
create policy p_admin_all_entregas
on public.entregas_documento_alumno
for all
using (public.rls_is_admin())
with check (public.rls_is_admin());

create policy p_alumno_rw_own_entregas
on public.entregas_documento_alumno
for all
using (
	public.rls_is_alumno()
	and cuenta_id = public.rls_actor_cuenta_id()
)
with check (
	public.rls_is_alumno()
	and cuenta_id = public.rls_actor_cuenta_id()
);

create policy p_orientador_read_entregas_asignadas
on public.entregas_documento_alumno
for select
using (
	public.rls_is_orientador()
	and public.rls_orientador_ve_cuenta(cuenta_id)
);

create policy p_orientador_update_entregas_asignadas
on public.entregas_documento_alumno
for update
using (
	public.rls_is_orientador()
	and public.rls_orientador_ve_cuenta(cuenta_id)
)
with check (
	public.rls_is_orientador()
	and public.rls_orientador_ve_cuenta(cuenta_id)
);

-- ORIENTADOR_PLANTILLAS
create policy p_admin_all_plantillas
on public.orientador_plantillas
for all
using (public.rls_is_admin())
with check (public.rls_is_admin());

create policy p_orientador_rw_plantillas
on public.orientador_plantillas
for all
using (public.rls_is_orientador())
with check (public.rls_is_orientador());

-- LOGS (AUDITORIA)
create policy p_admin_all_logs
on public.logs
for all
using (public.rls_is_admin())
with check (public.rls_is_admin());

create policy p_orientador_read_logs_propios
on public.logs
for select
using (
	public.rls_is_orientador()
	and (
		actor_tipo = 'orientador'
		and actor_id = public.rls_actor_orientador_id()
	)
);

create policy p_alumno_read_logs_propios
on public.logs
for select
using (
	public.rls_is_alumno()
	and (
		actor_tipo = 'alumno'
		and actor_id = public.rls_actor_cuenta_id()
	)
);

-- CARRERAS (catalogo)
create policy p_public_read_carreras
on public.carreras
for select
using (
	public.rls_is_admin()
	or public.rls_is_orientador()
	or public.rls_is_alumno()
);

create policy p_admin_all_carreras
on public.carreras
for all
using (public.rls_is_admin())
with check (public.rls_is_admin());

-- SEMESTRE / PERIODOS
create policy p_admin_all_semestre
on public.orientador_semestre_fechas
for all
using (public.rls_is_admin())
with check (public.rls_is_admin());

create policy p_orientador_read_semestre
on public.orientador_semestre_fechas
for select
using (public.rls_is_orientador());

create policy p_orientador_write_semestre
on public.orientador_semestre_fechas
for update
using (public.rls_is_orientador())
with check (public.rls_is_orientador());

create policy p_admin_all_periodo_ig
on public.periodo_institucion_grupos
for all
using (public.rls_is_admin())
with check (public.rls_is_admin());

create policy p_orientador_read_periodo_ig_asignado
on public.periodo_institucion_grupos
for select
using (
	public.rls_is_orientador()
	and public.rls_orientador_tiene_grupo(institucion_grupo_id)
);

create policy p_orientador_write_periodo_ig_asignado
on public.periodo_institucion_grupos
for all
using (
	public.rls_is_orientador()
	and public.rls_orientador_tiene_grupo(institucion_grupo_id)
)
with check (
	public.rls_is_orientador()
	and public.rls_orientador_tiene_grupo(institucion_grupo_id)
);

-- -----------------------------------------------------------------------------
-- 6) Grants minimos para runtime con RLS
-- -----------------------------------------------------------------------------
-- Recomendado: crear roles de BD y mapearlos desde JWT:
--	rol=alumno		-> db role: authenticated (o api_alumno)
--	rol=orientador	-> db role: authenticated (o api_orientador)
--	rol=admin		-> db role: authenticated (o api_admin)
--
-- Este script no fuerza grants destructivos para no romper setups existentes.

