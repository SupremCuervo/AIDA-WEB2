-- =============================================================================
-- AIDA: reactivar triggers de auditoría (trg_logs_*)
-- Ejecutar después de migracion_recrear_tabla_logs.sql
-- y después de definir public.logs_trigger_auditoria_fila().
-- =============================================================================

begin;

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

-- Si no existe la función principal de trigger, se crea una base segura.
do $$
begin
	if to_regprocedure('public.logs_trigger_auditoria_fila()') is null then
		execute $f$
			create function public.logs_trigger_auditoria_fila()
			returns trigger
			language plpgsql
			security definer
			set search_path = public
			as $body$
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
					initcap(replace(lower(tg_op), '_', ' ')) || ' en ' || replace(tg_table_name::text, '_', ' '),
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
			$body$;
		$f$;
	end if;
end;
$$;

drop trigger if exists trg_logs_padron_alumnos on public.padron_alumnos;
create trigger trg_logs_padron_alumnos
after insert or update on public.padron_alumnos
for each row execute procedure public.logs_trigger_auditoria_fila();

drop trigger if exists trg_logs_grupo_tokens on public.grupo_tokens;
create trigger trg_logs_grupo_tokens
after insert or update on public.grupo_tokens
for each row execute procedure public.logs_trigger_auditoria_fila();

drop trigger if exists trg_logs_entregas_documento on public.entregas_documento_alumno;
create trigger trg_logs_entregas_documento
after insert or update on public.entregas_documento_alumno
for each row execute procedure public.logs_trigger_auditoria_fila();

drop trigger if exists trg_logs_orientador_plantillas on public.orientador_plantillas;
create trigger trg_logs_orientador_plantillas
after insert or update on public.orientador_plantillas
for each row execute procedure public.logs_trigger_auditoria_fila();

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

commit;

