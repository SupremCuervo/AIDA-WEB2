-- =============================================================================
-- AIDA: Logs solo con actor orientador (correo)
-- Ejecutar en Supabase SQL Editor.
--
-- Objetivo:
-- - Eliminar logs existentes.
-- - Recrear funciones/triggers para NO guardar "sistema".
-- - Registrar por trigger solo cuando se pueda resolver correo de orientador.
--
-- Nota:
-- - Si no hay contexto de orientador (id/correo), el trigger NO inserta log.
-- =============================================================================

begin;

-- 1) Limpiar logs actuales
truncate table public.logs;

-- 2) Desmontar triggers actuales
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

-- 3) registrar_log: no permitir sistema (solo orientador con correo)
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
	v_tipo := lower(trim(coalesce(p_actor_tipo, '')));
	v_etiq := trim(coalesce(p_actor_etiqueta, ''));
	v_origen := case
		when lower(trim(coalesce(p_origen, ''))) = 'trigger' then 'trigger'
		else 'api'
	end;

	-- Solo orientador con correo y actor_id.
	if v_tipo <> 'orientador' or p_actor_id is null or v_etiq = '' or position('@' in v_etiq) = 0 then
		return null;
	end if;

	insert into public.logs (actor_tipo, actor_id, actor_etiqueta, accion, entidad, entidad_id, detalle, origen)
	values ('orientador', p_actor_id, v_etiq, p_accion, p_entidad, p_entidad_id, p_detalle, v_origen)
	returning id into v_id;

	return v_id;
end;
$$;

-- 4) Trigger: resolver actor orientador y correo; si no hay actor, no loguear.
create or replace function public.logs_trigger_auditoria_fila()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
	v_id text;
	v_detalle jsonb;
	v_accion text;
	v_ref text;
	v_parts text[];
	v_mat text;
	v_pid uuid;
	v_actor_id uuid;
	v_actor_email text;
	v_guc_id text;
	v_guc_email text;
begin
	v_id := coalesce(new.id::text, old.id::text);
	v_detalle := jsonb_build_object(
		'operacion', tg_op,
		'antes', case when tg_op in ('UPDATE', 'DELETE') then (row_to_json(old))::jsonb else null end,
		'despues', case when tg_op in ('INSERT', 'UPDATE') then (row_to_json(new))::jsonb else null end
	);

	v_accion := null;

	-- Acciones legibles (igual que tu esquema actual)
	if tg_table_name = 'padron_alumnos' then
		if tg_op = 'INSERT' then
			v_ref := public.logs_ref_expediente_padron(new.id, new.matricula);
			v_accion := 'Expediente ' || v_ref || ' creado';
		elsif tg_op = 'UPDATE' then
			if coalesce(current_setting('aida.omitir_log_trigger_padron', true), '') = '1' then
				return new;
			end if;
			v_ref := public.logs_ref_expediente_padron(new.id, new.matricula);
			v_parts := array[]::text[];
			if old.nombre_completo is distinct from new.nombre_completo then v_parts := array_append(v_parts, 'nombre'); end if;
			if old.grupo_token_id is distinct from new.grupo_token_id
				or old.institucion_grupo_id is distinct from new.institucion_grupo_id then
				v_parts := array_append(v_parts, 'grupo o sección');
			end if;
			if old.grado_alumno is distinct from new.grado_alumno then v_parts := array_append(v_parts, 'grado'); end if;
			if old.carrera_id is distinct from new.carrera_id then v_parts := array_append(v_parts, 'carrera'); end if;
			if old.matricula is distinct from new.matricula then v_parts := array_append(v_parts, 'matrícula'); end if;
			if cardinality(v_parts) > 0 then
				v_accion := 'Actualización de ' || array_to_string(v_parts, ', ') || ' al expediente ' || v_ref;
			else
				v_accion := 'Actualización de expediente ' || v_ref;
			end if;
		end if;
	elsif tg_table_name = 'grupo_tokens' then
		if tg_op = 'INSERT' then
			v_accion := 'Token de acceso creado para ' || trim(coalesce(new.grado, '')) || '°' || upper(trim(coalesce(new.grupo, '')));
		elsif tg_op = 'UPDATE' then
			v_accion := 'Token de acceso actualizado (' || trim(coalesce(new.grado, '')) || '°' || upper(trim(coalesce(new.grupo, ''))) || ')';
		end if;
	elsif tg_table_name = 'entregas_documento_alumno' then
		select p.id, p.matricula into v_pid, v_mat
		from cuentas_alumno c
		join padron_alumnos p on p.id = c.padron_id
		where c.id = coalesce(new.cuenta_id, old.cuenta_id)
		limit 1;
		v_ref := public.logs_ref_expediente_padron(v_pid, v_mat);
		if tg_op = 'INSERT' then
			v_accion := 'Nuevo documento subido al expediente ' || v_ref;
		elsif tg_op = 'UPDATE' then
			v_accion := 'Documento actualizado en expediente ' || v_ref;
		end if;
	elsif tg_table_name = 'orientador_plantillas' then
		if tg_op = 'INSERT' then v_accion := 'Nueva plantilla subida'; end if;
		if tg_op = 'UPDATE' then v_accion := 'Plantilla actualizada'; end if;
	elsif tg_table_name = 'cuentas_alumno' then
		if tg_op = 'INSERT' then
			select p.id, p.matricula into v_pid, v_mat from padron_alumnos p where p.id = new.padron_id limit 1;
			v_ref := public.logs_ref_expediente_padron(v_pid, v_mat);
			v_accion := 'Cuenta de acceso creada para expediente ' || v_ref;
		elsif tg_op = 'UPDATE' then
			v_accion := 'Cuenta de alumno actualizada';
		end if;
	elsif tg_table_name = 'carreras' then
		if tg_op = 'INSERT' then v_accion := 'Nueva carrera en el catálogo: ' || coalesce(new.nombre, new.codigo); end if;
		if tg_op = 'UPDATE' then v_accion := 'Carrera actualizada en el catálogo: ' || coalesce(new.nombre, new.codigo); end if;
		if tg_op = 'DELETE' then v_accion := 'Carrera eliminada del catálogo: ' || coalesce(old.nombre, old.codigo); end if;
	elsif tg_table_name = 'institucion_grupos' then
		if tg_op = 'INSERT' then v_accion := 'Nueva sección en catálogo'; end if;
		if tg_op = 'UPDATE' then v_accion := 'Sección del catálogo actualizada'; end if;
		if tg_op = 'DELETE' then v_accion := 'Sección eliminada del catálogo'; end if;
	elsif tg_table_name = 'orientador_semestre_fechas' then
		if tg_op = 'UPDATE' then v_accion := 'Periodos actualizados'; end if;
	elsif tg_table_name = 'cargas_alumnos' then
		if tg_op = 'INSERT' then v_accion := 'Creación de carga de alumnos'; end if;
		if tg_op = 'DELETE' then v_accion := 'Carga de alumnos eliminada'; end if;
	end if;

	if v_accion is null then
		v_accion := initcap(replace(lower(tg_op), '_', ' ')) || ' en ' || replace(tg_table_name::text, '_', ' ');
	end if;

	-- Resolver actor (prioridad: GUC de sesión; respaldo: orientador_id en carga)
	v_guc_id := nullif(trim(coalesce(current_setting('aida.auditoria_orientador_id', true), '')), '');
	v_guc_email := nullif(trim(coalesce(current_setting('aida.auditoria_orientador_email', true), '')), '');

	if v_guc_id is not null then
		begin
			v_actor_id := v_guc_id::uuid;
		exception when invalid_text_representation then
			v_actor_id := null;
		end;
	end if;

	if v_actor_id is null and tg_table_name = 'cargas_alumnos' then
		v_actor_id := case when tg_op = 'DELETE' then old.orientador_id else new.orientador_id end;
	end if;

	if v_actor_id is not null then
		select trim(email) into v_actor_email from public.orientadores where id = v_actor_id limit 1;
	end if;
	if (v_actor_email is null or v_actor_email = '') and v_guc_email is not null then
		v_actor_email := v_guc_email;
	end if;

	-- Sin correo => no insertar (evita "sistema")
	if v_actor_id is null or v_actor_email is null or v_actor_email = '' or position('@' in v_actor_email) = 0 then
		if tg_op = 'DELETE' then
			return old;
		end if;
		return new;
	end if;

	insert into public.logs (actor_tipo, actor_id, actor_etiqueta, accion, entidad, entidad_id, detalle, origen)
	values ('orientador', v_actor_id, v_actor_email, v_accion, tg_table_name::text, v_id, v_detalle, 'trigger');

	if tg_op = 'DELETE' then
		return old;
	end if;
	return new;
end;
$$;

-- 5) Montar triggers de nuevo
create trigger trg_logs_padron_alumnos
after insert or update on public.padron_alumnos
for each row execute procedure public.logs_trigger_auditoria_fila();

create trigger trg_logs_grupo_tokens
after insert or update on public.grupo_tokens
for each row execute procedure public.logs_trigger_auditoria_fila();

create trigger trg_logs_entregas_documento
after insert or update on public.entregas_documento_alumno
for each row execute procedure public.logs_trigger_auditoria_fila();

create trigger trg_logs_orientador_plantillas
after insert or update on public.orientador_plantillas
for each row execute procedure public.logs_trigger_auditoria_fila();

create trigger trg_logs_cuentas_alumno
after insert or update or delete on public.cuentas_alumno
for each row execute procedure public.logs_trigger_auditoria_fila();

create trigger trg_logs_carreras
after insert or update or delete on public.carreras
for each row execute procedure public.logs_trigger_auditoria_fila();

create trigger trg_logs_institucion_grupos
after insert or update or delete on public.institucion_grupos
for each row execute procedure public.logs_trigger_auditoria_fila();

create trigger trg_logs_orientador_semestre
after insert or update on public.orientador_semestre_fechas
for each row execute procedure public.logs_trigger_auditoria_fila();

do $$
begin
	if to_regclass('public.cargas_alumnos') is not null then
		execute 'create trigger trg_logs_cargas_alumnos after insert or delete on public.cargas_alumnos for each row execute procedure public.logs_trigger_auditoria_fila()';
	end if;
end;
$$;

commit;

