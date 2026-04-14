-- Lista ordenada de textos distintos en logs.accion (filtro del panel historial).
-- Ejecutar en Supabase SQL Editor si quieres la consulta optimizada; la API tiene respaldo sin esta función.

create or replace function public.orientador_logs_lista_acciones()
returns setof text
language sql
stable
security definer
set search_path = public
as $$
	select distinct l.accion
	from public.logs l
	where l.accion is not null
		and btrim(l.accion) <> ''
	order by 1;
$$;

revoke all on function public.orientador_logs_lista_acciones() from public;
grant execute on function public.orientador_logs_lista_acciones() to service_role;
