-- Auditoría: tabla logs, función registrar_log, RPC de archivo/reactivar y disparadores por fila.
-- Ejecutar en Supabase SQL Editor (después del resto del esquema).

create table if not exists public.logs (
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

create index if not exists idx_logs_creado on public.logs (creado_en desc);
create index if not exists idx_logs_entidad on public.logs (entidad, entidad_id);

alter table public.logs enable row level security;

comment on table public.logs is 'Auditoría: API (actor orientador/sistema) y disparadores (origen trigger, actor sistema).';

-- Registro desde la API Next (service_role) o desde procedimientos almacenados.
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

-- Archivar: una sola operación + un registro de auditoría con actor (desde la API).
create or replace function public.aud_archivar_padrones(
	p_padron_ids uuid[],
	p_grupo_token_id uuid,
	p_actor_tipo text,
	p_actor_id uuid,
	p_actor_etiqueta text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_count int := 0;
	v_ids uuid[];
begin
	if p_padron_ids is not null and cardinality(p_padron_ids) > 0 then
		with u as (
			update public.padron_alumnos p
			set archivo_muerto_en = now()
			where
				p.id = any (p_padron_ids)
				and p.archivo_muerto_en is null
				and (p_grupo_token_id is null or p.grupo_token_id = p_grupo_token_id)
			returning p.id
		)
		select count(*)::int, coalesce(array_agg(u.id), '{}') into v_count, v_ids from u;
	elsif p_grupo_token_id is not null then
		with u as (
			update public.padron_alumnos p
			set archivo_muerto_en = now()
			where p.grupo_token_id = p_grupo_token_id and p.archivo_muerto_en is null
			returning p.id
		)
		select count(*)::int, coalesce(array_agg(u.id), '{}') into v_count, v_ids from u;
	end if;

	perform public.registrar_log(
		coalesce(nullif(trim(p_actor_tipo), ''), 'sistema'),
		p_actor_id,
		coalesce(nullif(trim(p_actor_etiqueta), ''), 'sistema'),
		'ARCHIVAR_EXPEDIENTE',
		'padron_alumnos',
		null,
		jsonb_build_object(
			'archivados', v_count,
			'padron_ids', coalesce(v_ids, '{}'),
			'grupo_token_id', p_grupo_token_id
		),
		'api'
	);

	return jsonb_build_object('ok', true, 'archivados', v_count, 'padron_ids', coalesce(v_ids, '{}'));
end;
$$;

create or replace function public.aud_reactivar_padron(
	p_padron_id uuid,
	p_actor_tipo text,
	p_actor_id uuid,
	p_actor_etiqueta text
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_nombre text;
	v_ok boolean := false;
begin
	update public.padron_alumnos p
	set archivo_muerto_en = null
	where p.id = p_padron_id and p.archivo_muerto_en is not null
	returning p.nombre_completo into v_nombre;

	if found then
		v_ok := true;
		perform public.registrar_log(
			coalesce(nullif(trim(p_actor_tipo), ''), 'sistema'),
			p_actor_id,
			coalesce(nullif(trim(p_actor_etiqueta), ''), 'sistema'),
			'REACTIVAR_EXPEDIENTE',
			'padron_alumnos',
			p_padron_id::text,
			jsonb_build_object('nombre_completo', v_nombre),
			'api'
		);
		return jsonb_build_object('ok', true, 'padronId', p_padron_id);
	end if;

	return jsonb_build_object('ok', false, 'error', 'no_encontrado_o_ya_activo');
end;
$$;

-- Disparador genérico: captura cualquier INSERT/UPDATE/DELETE (actor sistema; detalle = fila).
create or replace function public.logs_trigger_auditoria_fila()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_id text;
	v_detalle jsonb;
begin
	v_id := coalesce(new.id::text, old.id::text);
	v_detalle := jsonb_build_object(
		'operacion', tg_op,
		'antes', case when tg_op in ('UPDATE', 'DELETE') then (row_to_json(old))::jsonb else null end,
		'despues', case when tg_op in ('INSERT', 'UPDATE') then (row_to_json(new))::jsonb else null end
	);

	insert into public.logs (actor_tipo, actor_id, actor_etiqueta, accion, entidad, entidad_id, detalle, origen)
	values (
		'sistema',
		null,
		'sistema',
		tg_op || '_' || tg_table_name,
		tg_table_name,
		v_id,
		v_detalle,
		'trigger'
	);

	if tg_op = 'DELETE' then
		return old;
	end if;
	return new;
end;
$$;

drop trigger if exists trg_logs_padron_alumnos on public.padron_alumnos;
create trigger trg_logs_padron_alumnos
after insert or update or delete on public.padron_alumnos
for each row execute procedure public.logs_trigger_auditoria_fila();

drop trigger if exists trg_logs_grupo_tokens on public.grupo_tokens;
create trigger trg_logs_grupo_tokens
after insert or update or delete on public.grupo_tokens
for each row execute procedure public.logs_trigger_auditoria_fila();

drop trigger if exists trg_logs_entregas_documento on public.entregas_documento_alumno;
create trigger trg_logs_entregas_documento
after insert or update or delete on public.entregas_documento_alumno
for each row execute procedure public.logs_trigger_auditoria_fila();

drop trigger if exists trg_logs_orientador_plantillas on public.orientador_plantillas;
create trigger trg_logs_orientador_plantillas
after insert or update or delete on public.orientador_plantillas
for each row execute procedure public.logs_trigger_auditoria_fila();

drop trigger if exists trg_logs_cuentas_alumno on public.cuentas_alumno;
create trigger trg_logs_cuentas_alumno
after insert or update or delete on public.cuentas_alumno
for each row execute procedure public.logs_trigger_auditoria_fila();

revoke all on function public.registrar_log(text, uuid, text, text, text, text, jsonb, text) from public;
revoke all on function public.aud_archivar_padrones(uuid[], uuid, text, uuid, text) from public;
revoke all on function public.aud_reactivar_padron(uuid, text, uuid, text) from public;

grant execute on function public.registrar_log(text, uuid, text, text, text, text, jsonb, text) to service_role;
grant execute on function public.aud_archivar_padrones(uuid[], uuid, text, uuid, text) to service_role;
grant execute on function public.aud_reactivar_padron(uuid, text, uuid, text) to service_role;
