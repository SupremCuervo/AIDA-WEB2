-- =============================================================================
-- AIDA: recrear tabla public.logs y función registrar_log
-- Ejecutar en Supabase SQL Editor.
-- =============================================================================

begin;

-- Eliminar objetos dependientes para recrearlos limpios.
drop trigger if exists trg_logs_padron_alumnos on public.padron_alumnos;
drop trigger if exists trg_logs_grupo_tokens on public.grupo_tokens;
drop trigger if exists trg_logs_entregas_documento on public.entregas_documento_alumno;
drop trigger if exists trg_logs_orientador_plantillas on public.orientador_plantillas;
drop trigger if exists trg_logs_cuentas_alumno on public.cuentas_alumno;
drop trigger if exists trg_logs_carreras on public.carreras;
drop trigger if exists trg_logs_institucion_grupos on public.institucion_grupos;
drop trigger if exists trg_logs_orientador_semestre on public.orientador_semestre_fechas;

do $$
begin
	if to_regclass('public.cargas_alumnos') is not null then
		execute 'drop trigger if exists trg_logs_cargas_alumnos on public.cargas_alumnos';
	end if;
end;
$$;

drop function if exists public.logs_trigger_auditoria_fila() cascade;
drop function if exists public.logs_ref_expediente_padron(uuid, text) cascade;
drop function if exists public.registrar_log(text, uuid, text, text, text, text, jsonb, text) cascade;
drop table if exists public.logs cascade;

create table public.logs (
	id uuid primary key default gen_random_uuid(),
	creado_en timestamptz not null default now(),
	actor_tipo text not null check (actor_tipo in ('orientador', 'sistema', 'alumno')),
	actor_id uuid,
	actor_etiqueta text not null default 'sistema',
	accion text not null,
	entidad text not null,
	entidad_id text,
	detalle jsonb,
	origen text not null default 'api' check (origen in ('api', 'trigger'))
);

create index idx_logs_creado on public.logs (creado_en desc);
create index idx_logs_entidad on public.logs (entidad, entidad_id);

alter table public.logs enable row level security;

comment on table public.logs is
	'Auditoría de acciones. API registra actor orientador/sistema; trigger registra origen trigger.';

create or replace function public.registrar_log(
	p_actor_tipo text,
	p_actor_id uuid,
	p_actor_etiqueta text,
	p_accion text,
	p_entidad text,
	p_entidad_id text,
	p_detalle jsonb default null,
	p_origen text default 'api'
) returns uuid
language plpgsql
security definer
set search_path = public
as $$
declare
	v_id uuid;
	v_tipo text;
	v_etiq text;
	v_origen text;
begin
	v_tipo := case
		when lower(trim(coalesce(p_actor_tipo, ''))) in ('orientador', 'sistema', 'alumno')
			then lower(trim(p_actor_tipo))
		else 'sistema'
	end;

	v_etiq := coalesce(nullif(trim(p_actor_etiqueta), ''), 'sistema');
	v_origen := case
		when lower(trim(coalesce(p_origen, ''))) = 'trigger' then 'trigger'
		else 'api'
	end;

	insert into public.logs (actor_tipo, actor_id, actor_etiqueta, accion, entidad, entidad_id, detalle, origen)
	values (v_tipo, p_actor_id, v_etiq, p_accion, p_entidad, p_entidad_id, p_detalle, v_origen)
	returning id into v_id;

	return v_id;
end;
$$;

revoke all on table public.logs from anon, authenticated;
revoke all on function public.registrar_log(text, uuid, text, text, text, text, jsonb, text) from public;

grant execute on function public.registrar_log(text, uuid, text, text, text, text, jsonb, text) to service_role;
grant select on public.logs to service_role;

commit;

