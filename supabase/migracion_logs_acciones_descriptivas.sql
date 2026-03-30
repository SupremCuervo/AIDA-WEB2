-- =============================================================================
-- AIDA: mensajes de auditoría legibles (columna acción) + triggers ajustados.
-- Ejecutar en Supabase SQL Editor en bases ya desplegadas.
-- Incluye: reemplazo de logs_trigger_auditoria_fila, triggers solo INSERT/UPDATE
--   donde la API ya registra DELETE con actor orientador, y triggers extra
--   (cargas, semestre, carreras, secciones) si existen las tablas.
-- =============================================================================

create or replace function public.logs_ref_expediente_padron(p_id uuid, p_matricula text)
returns text
language sql
immutable
as $$
	select case
		when p_matricula is not null and btrim(p_matricula) <> '' then btrim(p_matricula)
		else right(replace(p_id::text, '-', ''), 4)
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
	v_accion text;
	v_ref text;
	v_parts text[];
	v_mat text;
	v_pid uuid;
begin
	v_id := coalesce(new.id::text, old.id::text);
	v_detalle := jsonb_build_object(
		'operacion', tg_op,
		'antes', case when tg_op in ('UPDATE', 'DELETE') then (row_to_json(old))::jsonb else null end,
		'despues', case when tg_op in ('INSERT', 'UPDATE') then (row_to_json(new))::jsonb else null end
	);

	v_accion := null;

	-- -------------------------------------------------------------------------
	if tg_table_name = 'padron_alumnos' then
		if tg_op = 'INSERT' then
			v_ref := public.logs_ref_expediente_padron(new.id, new.matricula);
			v_accion := 'Expediente ' || v_ref || ' creado';
		elsif tg_op = 'UPDATE' then
			-- Solo archivo_muerto_en: lo registra la API (PATCH o RPC con skip).
			if coalesce(current_setting('aida.omitir_log_trigger_padron', true), '') = '1' then
				return new;
			end if;
			if old.archivo_muerto_en is distinct from new.archivo_muerto_en
				and row(
					old.nombre_completo,
					old.grupo_token_id,
					old.institucion_grupo_id,
					old.grado_alumno,
					old.carrera_id,
					old.matricula
				) is not distinct from row(
					new.nombre_completo,
					new.grupo_token_id,
					new.institucion_grupo_id,
					new.grado_alumno,
					new.carrera_id,
					new.matricula
				) then
				return new;
			end if;
			v_ref := public.logs_ref_expediente_padron(new.id, new.matricula);
			v_parts := array[]::text[];
			if old.nombre_completo is distinct from new.nombre_completo then
				v_parts := array_append(v_parts, 'nombre');
			end if;
			if old.grupo_token_id is distinct from new.grupo_token_id
				or old.institucion_grupo_id is distinct from new.institucion_grupo_id then
				v_parts := array_append(v_parts, 'grupo o sección');
			end if;
			if old.grado_alumno is distinct from new.grado_alumno then
				v_parts := array_append(v_parts, 'grado');
			end if;
			if old.carrera_id is distinct from new.carrera_id then
				v_parts := array_append(v_parts, 'carrera');
			end if;
			if old.matricula is distinct from new.matricula then
				v_parts := array_append(v_parts, 'matrícula');
			end if;
			if old.archivo_muerto_en is distinct from new.archivo_muerto_en then
				if new.archivo_muerto_en is null then
					v_parts := array_append(v_parts, 'reactivación');
				else
					v_parts := array_append(v_parts, 'archivo muerto');
				end if;
			end if;
			if cardinality(v_parts) > 0 then
				v_accion := 'Actualización de ' || array_to_string(v_parts, ', ') || ' al expediente ' || v_ref;
			else
				v_accion := 'Actualización de expediente ' || v_ref;
			end if;
		end if;

	elsif tg_table_name = 'grupo_tokens' then
		if tg_op = 'INSERT' then
			v_accion := 'Token de acceso creado para ' || trim(coalesce(new.grado, '')) || '°' ||
				upper(trim(coalesce(new.grupo, '')));
		elsif tg_op = 'UPDATE' then
			v_accion := 'Token de acceso actualizado (' || trim(coalesce(new.grado, '')) || '°' ||
				upper(trim(coalesce(new.grupo, ''))) || ')';
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
			if old.estado is distinct from new.estado then
				v_accion := 'Estado de documento actualizado en expediente ' || v_ref || ' (' ||
					coalesce(new.tipo_documento, '') || ')';
			else
				v_accion := 'Documento actualizado en expediente ' || v_ref;
			end if;
		end if;

	elsif tg_table_name = 'orientador_plantillas' then
		if tg_op = 'INSERT' then
			v_accion := 'Nueva plantilla subida';
		elsif tg_op = 'UPDATE' then
			v_accion := 'Plantilla actualizada';
		end if;

	elsif tg_table_name = 'cuentas_alumno' then
		if tg_op = 'INSERT' then
			select p.id, p.matricula into v_pid, v_mat
			from padron_alumnos p
			where p.id = new.padron_id
			limit 1;
			v_ref := public.logs_ref_expediente_padron(v_pid, v_mat);
			v_accion := 'Cuenta de acceso creada para expediente ' || v_ref;
		elsif tg_op = 'UPDATE' then
			v_accion := 'Cuenta de alumno actualizada';
		end if;

	elsif tg_table_name = 'carreras' then
		if tg_op = 'INSERT' then
			v_accion := 'Nueva carrera en el catálogo: ' || coalesce(new.nombre, new.codigo);
		elsif tg_op = 'UPDATE' then
			v_accion := 'Carrera actualizada en el catálogo: ' || coalesce(new.nombre, new.codigo);
		elsif tg_op = 'DELETE' then
			v_accion := 'Carrera eliminada del catálogo: ' || coalesce(old.nombre, old.codigo);
		end if;

	elsif tg_table_name = 'institucion_grupos' then
		if tg_op = 'INSERT' then
			v_accion := 'Nueva sección en catálogo (' || coalesce(new.grado::text, '') || '° ' ||
				upper(trim(coalesce(new.grupo, ''))) || ')';
		elsif tg_op = 'UPDATE' then
			v_accion := 'Sección del catálogo actualizada';
		elsif tg_op = 'DELETE' then
			v_accion := 'Sección eliminada del catálogo';
		end if;

	elsif tg_table_name = 'orientador_semestre_fechas' then
		if tg_op = 'UPDATE' then
			if old.primer_periodo_fecha is distinct from new.primer_periodo_fecha
				or old.segundo_periodo_fecha is distinct from new.segundo_periodo_fecha
				or old.nombre_anios is distinct from new.nombre_anios then
				v_accion := 'Periodos actualizados';
			else
				v_accion := 'Calendario escolar actualizado';
			end if;
		end if;

	elsif tg_table_name = 'cargas_alumnos' then
		if tg_op = 'INSERT' then
			v_accion := 'Creación de carga de alumnos';
		elsif tg_op = 'DELETE' then
			v_accion := 'Carga de alumnos eliminada';
		end if;
	end if;

	if v_accion is null then
		v_accion := initcap(replace(lower(tg_op), '_', ' ')) || ' en ' ||
			replace(tg_table_name::text, '_', ' ');
	end if;

	insert into public.logs (actor_tipo, actor_id, actor_etiqueta, accion, entidad, entidad_id, detalle, origen)
	values (
		'sistema',
		null,
		'Sistema',
		v_accion,
		tg_table_name::text,
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

-- Padron: la API registra DELETE con actor orientador (evitar duplicado).
drop trigger if exists trg_logs_padron_alumnos on public.padron_alumnos;
create trigger trg_logs_padron_alumnos
after insert or update on public.padron_alumnos
for each row execute procedure public.logs_trigger_auditoria_fila();

-- Token: la API registra DELETE con actor orientador.
drop trigger if exists trg_logs_grupo_tokens on public.grupo_tokens;
create trigger trg_logs_grupo_tokens
after insert or update on public.grupo_tokens
for each row execute procedure public.logs_trigger_auditoria_fila();

-- Entregas: solo inserción y cambios (DELETE desde API puede registrar aparte).
drop trigger if exists trg_logs_entregas_documento on public.entregas_documento_alumno;
create trigger trg_logs_entregas_documento
after insert or update on public.entregas_documento_alumno
for each row execute procedure public.logs_trigger_auditoria_fila();

-- Plantillas: la API registra DELETE con actor orientador.
drop trigger if exists trg_logs_orientador_plantillas on public.orientador_plantillas;
create trigger trg_logs_orientador_plantillas
after insert or update on public.orientador_plantillas
for each row execute procedure public.logs_trigger_auditoria_fila();

-- Cuentas: mantener insert/update/delete (poco ruido).
drop trigger if exists trg_logs_cuentas_alumno on public.cuentas_alumno;
create trigger trg_logs_cuentas_alumno
after insert or update or delete on public.cuentas_alumno
for each row execute procedure public.logs_trigger_auditoria_fila();

drop trigger if exists trg_logs_carreras on public.carreras;
create trigger trg_logs_carreras
after insert or update or delete on public.carreras
for each row execute procedure public.logs_trigger_auditoria_fila();

drop trigger if exists trg_logs_institucion_grupos on public.institucion_grupos;
create trigger trg_logs_institucion_grupos
after insert or update or delete on public.institucion_grupos
for each row execute procedure public.logs_trigger_auditoria_fila();

drop trigger if exists trg_logs_orientador_semestre on public.orientador_semestre_fechas;
create trigger trg_logs_orientador_semestre
after insert or update on public.orientador_semestre_fechas
for each row execute procedure public.logs_trigger_auditoria_fila();

do $$
begin
	if to_regclass('public.cargas_alumnos') is not null then
		execute 'drop trigger if exists trg_logs_cargas_alumnos on public.cargas_alumnos';
		execute 'create trigger trg_logs_cargas_alumnos after insert or delete on public.cargas_alumnos for each row execute procedure public.logs_trigger_auditoria_fila()';
	end if;
end;
$$;

-- Un solo registro por operación masiva de archivo muerto (evita N disparadores).
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
	perform set_config('aida.omitir_log_trigger_padron', '1', true);
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
	perform set_config('aida.omitir_log_trigger_padron', '', true);

	perform public.registrar_log(
		coalesce(nullif(trim(p_actor_tipo), ''), 'sistema'),
		p_actor_id,
		coalesce(nullif(trim(p_actor_etiqueta), ''), 'sistema'),
		case
			when v_count <= 0 then 'Archivo muerto: sin cambios'
			when v_count = 1 then 'Un expediente pasado a archivo muerto'
			else 'Archivo muerto: ' || v_count::text || ' expedientes actualizados'
		end,
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
	v_mat text;
	v_ref text;
begin
	perform set_config('aida.omitir_log_trigger_padron', '1', true);
	update public.padron_alumnos p
	set archivo_muerto_en = null
	where p.id = p_padron_id and p.archivo_muerto_en is not null
	returning p.nombre_completo, p.matricula into v_nombre, v_mat;

	if not found then
		perform set_config('aida.omitir_log_trigger_padron', '', true);
		return jsonb_build_object('ok', false, 'error', 'no_encontrado_o_ya_activo');
	end if;

	perform set_config('aida.omitir_log_trigger_padron', '', true);
	v_ref := public.logs_ref_expediente_padron(p_padron_id, v_mat);
	perform public.registrar_log(
		coalesce(nullif(trim(p_actor_tipo), ''), 'sistema'),
		p_actor_id,
		coalesce(nullif(trim(p_actor_etiqueta), ''), 'sistema'),
		'Reactivación de expediente ' || v_ref,
		'padron_alumnos',
		p_padron_id::text,
		jsonb_build_object('nombre_completo', v_nombre),
		'api'
	);
	return jsonb_build_object('ok', true, 'padronId', p_padron_id);
end;
$$;

comment on function public.logs_trigger_auditoria_fila() is
	'Auditoría por fila: acción en español legible; detalle conserva JSON técnico.';
