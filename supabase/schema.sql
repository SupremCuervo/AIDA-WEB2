-- AIDA: tablas sin Supabase Auth (solo acceso desde API Next con service_role).
-- Ejecutar en Supabase SQL Editor (o migraciones).

create extension if not exists "pgcrypto";

-- Clave de acceso por grupo (la entrega el orientador al alumno).
create table if not exists public.grupo_tokens (
	id uuid primary key default gen_random_uuid(),
	clave_acceso text not null unique,
	grupo text not null,
	grado text not null,
	creado_en timestamptz not null default now(),
	fecha_limite_entrega date
);

-- Secciones (grado 1–6 + letra). Opcional: un token por sección vía grupo_tokens.institucion_grupo_id.
create table if not exists public.institucion_grupos (
	id uuid primary key default gen_random_uuid(),
	grado smallint not null check (grado >= 1 and grado <= 6),
	grupo text not null,
	creado_en timestamptz not null default now(),
	unique (grado, grupo)
);

alter table public.institucion_grupos enable row level security;

alter table public.grupo_tokens add column if not exists institucion_grupo_id uuid references public.institucion_grupos (id) on delete set null;

create unique index if not exists uq_grupo_tokens_un_token_por_seccion on public.grupo_tokens (institucion_grupo_id) where institucion_grupo_id is not null;

comment on table public.institucion_grupos is 'Catálogo de secciones; el orientador asigna token por sección cuando aplique.';

comment on column public.grupo_tokens.institucion_grupo_id is 'Sección del catálogo (1:1 con token cuando existe); null si el token aún no enlaza o es legado.';

-- Padrón (sustituye al Excel): alumnos permitidos por grupo_token.
create table if not exists public.padron_alumnos (
	id uuid primary key default gen_random_uuid(),
	grupo_token_id uuid not null references public.grupo_tokens (id) on delete cascade,
	nombre_completo text not null,
	creado_en timestamptz not null default now(),
	unique (grupo_token_id, nombre_completo)
);

-- Grado escolar mostrado para este alumno (expediente / panel). Si es null, se usa grupo_tokens.grado.
alter table public.padron_alumnos add column if not exists grado_alumno text;

comment on column public.padron_alumnos.grado_alumno is 'Opcional. Grado escolar 1–6 en toda la app; si null, aplica el grado del enlace (grupo_tokens.grado).';

-- Carreras (catálogo). En grado 1 no aplica; desde 2.° el alumno u orientador eligen una.
create table if not exists public.carreras (
	id uuid primary key default gen_random_uuid(),
	codigo text not null unique,
	nombre text not null
);

alter table public.carreras enable row level security;

comment on table public.carreras is 'Catálogo de carreras para alumnos de 2.° grado en adelante.';

insert into public.carreras (codigo, nombre) values
	('PROGRAMACION', 'Programación'),
	('ENFERMERIA', 'Enfermería'),
	('GESTION', 'Gestión')
on conflict (codigo) do update set nombre = excluded.nombre;

alter table public.padron_alumnos add column if not exists carrera_id uuid references public.carreras (id) on delete set null;

comment on column public.padron_alumnos.carrera_id is 'Solo si grado mostrado >= 2; debe quedar null en grado 1.';

alter table public.padron_alumnos add column if not exists matricula text;

comment on column public.padron_alumnos.matricula is 'Número o clave de matrícula; solo a partir de 2.° grado (con carrera). Null en 1.°.';

alter table public.padron_alumnos add column if not exists archivo_muerto_en timestamptz null;

comment on column public.padron_alumnos.archivo_muerto_en is 'Expediente bajado a archivo muerto (inactivo). Los datos se conservan; el alumno no puede entrar hasta reactivar.';

-- Cuenta local (no auth de Supabase): una fila por alumno del padrón que ya definió contraseña.
create table if not exists public.cuentas_alumno (
	id uuid primary key default gen_random_uuid(),
	padron_id uuid not null unique references public.padron_alumnos (id) on delete cascade,
	password_hash text not null,
	creado_en timestamptz not null default now(),
	actualizado_en timestamptz not null default now()
);

create index if not exists idx_padron_grupo on public.padron_alumnos (grupo_token_id);

alter table public.grupo_tokens enable row level security;
alter table public.padron_alumnos enable row level security;
alter table public.cuentas_alumno enable row level security;

-- Sin políticas: anon/authenticated no leen ni escriben. Solo service_role (API servidor).

comment on table public.grupo_tokens is 'Tokens/claves de acceso por grupo (grado + letra de grupo).';
comment on table public.padron_alumnos is 'Lista institucional de alumnos por clave de grupo; obligatorio para crear cuenta.';
comment on table public.cuentas_alumno is 'Credenciales alumno (hash); no usa auth.users.';

-- Entregas de documentos (web): una fila por cuenta y tipo cuando el alumno subió archivo.
-- validado = puede marcarlo un orientador o, en el futuro, un sistema automático 100% seguro; subida alumno → revisión manual hasta entonces.
create table if not exists public.entregas_documento_alumno (
	id uuid primary key default gen_random_uuid(),
	cuenta_id uuid not null references public.cuentas_alumno (id) on delete cascade,
	tipo_documento text not null,
	estado text not null check (estado in ('validado', 'rechazado', 'pendiente_revision_manual')),
	motivo_rechazo text,
	ruta_storage text not null,
	validacion_automatica boolean not null default false,
	subido_en timestamptz not null default now(),
	actualizado_en timestamptz not null default now(),
	unique (cuenta_id, tipo_documento)
);

alter table public.entregas_documento_alumno add column if not exists etiqueta_personalizada text;
alter table public.entregas_documento_alumno add column if not exists ocr_campos jsonb;
alter table public.entregas_documento_alumno add column if not exists ocr_tramite text;
alter table public.entregas_documento_alumno add column if not exists ocr_extraido_en timestamptz;
alter table public.entregas_documento_alumno add column if not exists ocr_error text;

comment on column public.entregas_documento_alumno.etiqueta_personalizada is 'Nombre legible para adjuntos orientador_adjunto_* (citatorios, etc.). NULL en los 5 documentos del trámite.';
comment on column public.entregas_documento_alumno.ocr_campos is 'JSON devuelto por OCR extract.';
comment on column public.entregas_documento_alumno.ocr_tramite is 'Trámite usado en extract.';
comment on column public.entregas_documento_alumno.ocr_extraido_en is 'Marca de tiempo extracción.';
comment on column public.entregas_documento_alumno.ocr_error is 'Error si no hubo extracción.';

create index if not exists idx_entregas_doc_cuenta on public.entregas_documento_alumno (cuenta_id);

alter table public.entregas_documento_alumno enable row level security;

comment on table public.entregas_documento_alumno is 'Estado por documento; tipos estándar en TIPOS_DOCUMENTO; adjuntos extra con tipo orientador_adjunto_<uuid>.';

-- Cuentas orientador (acceso panel administrativo; no usa auth.users).
create table if not exists public.orientadores (
	id uuid primary key default gen_random_uuid(),
	email text not null unique,
	password_hash text not null,
	nombre text not null default '',
	estado_acceso text not null default 'activo' check (estado_acceso in ('activo', 'inactivo')),
	rol_panel text not null default 'normal' check (rol_panel in ('normal', 'jefe')),
	creado_en timestamptz not null default now()
);

alter table public.orientadores enable row level security;

comment on table public.orientadores is 'Credenciales orientador (bcrypt); sesión vía JWT en cookie HttpOnly.';
comment on column public.orientadores.estado_acceso is 'Control de acceso al panel orientador: solo activo puede iniciar sesión.';
comment on column public.orientadores.rol_panel is 'normal: sin historial global ni solicitudes. jefe: permisos completos.';

create table if not exists public.orientador_solicitudes_acceso (
	id uuid primary key default gen_random_uuid(),
	email text not null unique,
	password_hash text not null,
	estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada')),
	creado_en timestamptz not null default now(),
	revisado_en timestamptz null,
	revisado_por_orientador_id uuid null references public.orientadores(id) on delete set null
);

alter table public.orientador_solicitudes_acceso enable row level security;

comment on table public.orientador_solicitudes_acceso is 'Solicitudes de acceso de orientadores pendientes de aceptación/rechazo.';

-- Muro de plantillas (PDF compartido entre orientadores).
create table if not exists public.orientador_plantillas (
	id uuid primary key default gen_random_uuid(),
	titulo text not null default '',
	nombre_archivo text not null,
	ruta_storage text not null unique,
	creado_en timestamptz not null default now(),
	definicion_relleno jsonb
);

alter table public.orientador_plantillas enable row level security;

comment on table public.orientador_plantillas is 'PDFs del muro; anotaciones en cliente opcionales; definicion_relleno = zonas para PDF automático con datos del alumno.';

comment on column public.orientador_plantillas.definicion_relleno is 'JSON { version: 1, campos: [{ id, pageIndex, xPct, yPct, fontSizePt, clave }] }.';

create index if not exists idx_orientador_plantillas_creado on public.orientador_plantillas (creado_en desc);

-- Si ya existía grupo_tokens sin la columna de fecha límite:
alter table public.grupo_tokens add column if not exists fecha_limite_entrega date;

comment on column public.grupo_tokens.fecha_limite_entrega is 'Último día válido: desde el día siguiente los alumnos no pueden validar la clave ni usar sesión (el token queda inactivo; no se borra la fila).';

/*
 * Primer orientador (ejecutar una vez, cambiar correo y hash):
 * insert into public.orientadores (email, password_hash, nombre)
 * values (
 *   'orientador@escuela.edu',
 *   '$2a$10$...', -- generar con bcrypt para tu contraseña
 *   'Orientador'
 * );
 */

-- Auditoría (también en supabase/auditoria_logs.sql; ejecutar ese archivo o copiar aquí en SQL Editor).
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
