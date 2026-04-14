-- =============================================================================
-- AIDA: historial con actor orientador en logs disparados por triggers.
-- Los triggers no conocen la sesión HTTP; la API Next llama a
-- orientador_api_update_padron_alumnos, que hace SET LOCAL del contexto y
-- actualiza padron_alumnos en la misma transacción.
-- Ejecutar en Supabase SQL Editor después de migracion_logs_acciones_descriptivas.sql
-- =============================================================================

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
	v_ins_actor_tipo text;
	v_ins_actor_id uuid;
	v_ins_actor_etiq text;
	v_audit_etiq text;
	v_audit_id_str text;
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

	v_audit_etiq := nullif(trim(coalesce(current_setting('aida.audit_actor_etiqueta', true), '')), '');
	v_audit_id_str := nullif(trim(coalesce(current_setting('aida.audit_actor_id', true), '')), '');
	if v_audit_etiq is not null and v_audit_etiq <> '' then
		v_ins_actor_tipo := 'orientador';
		begin
			v_ins_actor_id := v_audit_id_str::uuid;
		exception
			when invalid_text_representation then
				v_ins_actor_id := null;
		end;
		v_ins_actor_etiq := v_audit_etiq;
	else
		v_ins_actor_tipo := 'sistema';
		v_ins_actor_id := null;
		v_ins_actor_etiq := 'Sistema';
	end if;

	insert into public.logs (actor_tipo, actor_id, actor_etiqueta, accion, entidad, entidad_id, detalle, origen)
	values (
		v_ins_actor_tipo,
		v_ins_actor_id,
		v_ins_actor_etiq,
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

-- Actualización de expediente desde API con contexto de auditoría (misma transacción que el trigger).
create or replace function public.orientador_api_update_padron_alumnos(
	p_padron_id uuid,
	p_actor_id uuid,
	p_actor_etiqueta text,
	p_set jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
	v_n int;
begin
	if p_padron_id is null then
		return jsonb_build_object('ok', false, 'error', 'padron_id_requerido');
	end if;

	perform set_config('aida.audit_actor_id', coalesce(nullif(trim(p_actor_id::text), ''), ''), true);
	perform set_config('aida.audit_actor_etiqueta', coalesce(nullif(trim(p_actor_etiqueta), ''), ''), true);

	update public.padron_alumnos
	set
		nombre_completo = case
			when p_set ? 'nombre_completo' then (p_set->>'nombre_completo')::text
			else nombre_completo
		end,
		grupo_token_id = case
			when p_set ? 'grupo_token_id' then (p_set->>'grupo_token_id')::uuid
			else grupo_token_id
		end,
		institucion_grupo_id = case
			when not (p_set ? 'institucion_grupo_id') then institucion_grupo_id
			when jsonb_typeof(p_set->'institucion_grupo_id') = 'null' then null
			when nullif(trim(p_set->>'institucion_grupo_id'), '') is null then null
			else (p_set->>'institucion_grupo_id')::uuid
		end,
		grado_alumno = case
			when not (p_set ? 'grado_alumno') then grado_alumno
			when jsonb_typeof(p_set->'grado_alumno') = 'null' then null
			else nullif(trim(p_set->>'grado_alumno'), '')
		end,
		carrera_id = case
			when not (p_set ? 'carrera_id') then carrera_id
			when jsonb_typeof(p_set->'carrera_id') = 'null' then null
			when nullif(trim(p_set->>'carrera_id'), '') is null then null
			else (p_set->>'carrera_id')::uuid
		end,
		matricula = case
			when not (p_set ? 'matricula') then matricula
			when jsonb_typeof(p_set->'matricula') = 'null' then null
			else nullif(trim(p_set->>'matricula'), '')
		end,
		archivo_muerto_en = case
			when not (p_set ? 'archivo_muerto_en') then archivo_muerto_en
			when jsonb_typeof(p_set->'archivo_muerto_en') = 'null' then null
			else (p_set->>'archivo_muerto_en')::timestamptz
		end
	where id = p_padron_id;

	get diagnostics v_n = row_count;
	if v_n = 0 then
		return jsonb_build_object('ok', false, 'error', 'not_found');
	end if;

	return jsonb_build_object('ok', true);
end;
$$;

revoke all on function public.orientador_api_update_padron_alumnos(uuid, uuid, text, jsonb) from public;
grant execute on function public.orientador_api_update_padron_alumnos(uuid, uuid, text, jsonb) to service_role;
