-- =============================================================================
-- AIDA: datos de demostración — orientador + carga con 10 alumnos (1.° grado)
-- =============================================================================
-- Prerrequisitos:
--   1) Ejecutar aida_base_completa.sql
--   2) Ejecutar cargas_alumnos_extension.sql  ← obligatorio para la parte "carga"
--   3) Si tu BD tenía cargas_alumnos.clave_acceso, ejecuta migracion_carga_quitar_clave_global.sql
--
-- Si ves el error de tablas inexistentes al insertar la carga, ejecuta primero:
--   supabase/cargas_alumnos_extension.sql
--
-- Para borrar todas las tablas de la app y volver a empezar:
--   supabase/aida_eliminar_todas_las_tablas.sql
--   (luego: aida_base_completa.sql + cargas_alumnos_extension.sql + este script)
--
-- Credenciales orientador:
--   Email: orientador@cecyteh.edu.mx
--   Contraseña: 123456789
--
-- Claves alumno (una por grupo, en grupo_tokens): demo-seed-a … demo-seed-e
--   Validar clave del grupo correspondiente y nombre exacto (prefijo "DEMO SEED ").
-- =============================================================================

begin;

do $req_cargas$
begin
	if to_regclass('public.cargas_alumnos') is null
		or to_regclass('public.carga_alumnos_linea') is null then
		raise exception
			'Faltan las tablas de cargas. En el SQL Editor de Supabase ejecuta primero el archivo supabase/cargas_alumnos_extension.sql y luego vuelve a ejecutar este seed.'
			using errcode = 'P0001';
	end if;
end $req_cargas$;

do $lim_lineas$
begin
	if to_regclass('public.carga_alumnos_linea') is not null then
		delete from public.carga_alumnos_linea
		where padron_id in (
			select p.id from public.padron_alumnos p
			where p.nombre_completo like 'DEMO SEED %'
		);
	end if;
end $lim_lineas$;

delete from public.padron_alumnos p
where p.nombre_completo like 'DEMO SEED %'
	and not exists (select 1 from public.cuentas_alumno c where c.padron_id = p.id);

delete from public.cargas_alumnos c
using public.orientadores o
where c.orientador_id = o.id
	and o.email = 'orientador@cecyteh.edu.mx'
	and c.fecha_cierre = '2027-06-30'::date
	and c.grado_carga = 1
	and c.grupos_letras = array['A', 'B', 'C', 'D', 'E']::text[];

insert into public.orientadores (email, password_hash, nombre)
values (
	'orientador@cecyteh.edu.mx',
	'$2a$10$Yn.eSOBX1K7w56cAg3pfI.HctE1aLU7cT6GKRLyr05r2jMY/4O1K.',
	'Orientador Demo CECyTEH'
)
on conflict (email) do update set
	password_hash = excluded.password_hash,
	nombre = excluded.nombre;

-- Tokens demo por sección 1.° A–E (una fila por institucion_grupo_id)
update public.grupo_tokens gt
set
	clave_acceso = 'demo-seed-' || lower(ig.grupo),
	fecha_limite_entrega = '2027-06-30'::date,
	grado = '1',
	grupo = ig.grupo
from public.institucion_grupos ig
where gt.institucion_grupo_id = ig.id
	and ig.grado = 1
	and ig.grupo in ('A', 'B', 'C', 'D', 'E');

insert into public.grupo_tokens (clave_acceso, grupo, grado, institucion_grupo_id, fecha_limite_entrega)
select 'demo-seed-' || lower(ig.grupo), ig.grupo, '1', ig.id, '2027-06-30'::date
from public.institucion_grupos ig
where ig.grado = 1
	and ig.grupo in ('A', 'B', 'C', 'D', 'E')
	and not exists (select 1 from public.grupo_tokens t where t.institucion_grupo_id = ig.id);

insert into public.cargas_alumnos (orientador_id, fecha_cierre, grado_carga, grupos_letras)
select o.id, '2027-06-30'::date, 1, array['A', 'B', 'C', 'D', 'E']::text[]
from public.orientadores o
where o.email = 'orientador@cecyteh.edu.mx'
limit 1;

do $$
declare
	cid uuid;
	rec record;
	ig uuid;
	tok uuid;
	pid uuid;
begin
	select c.id into cid
	from public.cargas_alumnos c
	inner join public.orientadores o on o.id = c.orientador_id
	where c.fecha_cierre = '2027-06-30'::date
		and c.grado_carga = 1
		and c.grupos_letras = array['A', 'B', 'C', 'D', 'E']::text[]
		and o.email = 'orientador@cecyteh.edu.mx'
	order by c.creado_en desc
	limit 1;
	if cid is null then
		raise exception 'No se encontró la carga demo (1.° A–E, cierre 2027-06-30)';
	end if;

	for rec in select * from (
		values
			('A', 'DEMO SEED Ana López Martínez'),
			('B', 'DEMO SEED Bruno García Ruiz'),
			('C', 'DEMO SEED Carla Mendoza Díaz'),
			('D', 'DEMO SEED Diego Herrera Luna'),
			('E', 'DEMO SEED Elena Castro Peña'),
			('A', 'DEMO SEED Fernando Ortiz Soto'),
			('B', 'DEMO SEED Gabriela Ramos Neri'),
			('C', 'DEMO SEED Hugo Vargas Leal'),
			('D', 'DEMO SEED Isabel Delgado Mora'),
			('E', 'DEMO SEED Jorge Navarro Rey')
	) as t(grupo, nombre)
	loop
		select igt.id into ig
		from public.institucion_grupos igt
		where igt.grado = 1 and igt.grupo = rec.grupo
		limit 1;
		if ig is null then
			raise exception 'Falta institucion_grupos para 1° grupo %', rec.grupo;
		end if;
		select gt.id into tok
		from public.grupo_tokens gt
		where gt.institucion_grupo_id = ig
		limit 1;
		if tok is null then
			raise exception 'Falta grupo_tokens para 1° grupo %', rec.grupo;
		end if;
		insert into public.padron_alumnos (institucion_grupo_id, grupo_token_id, nombre_completo, grado_alumno)
		values (ig, tok, rec.nombre, '1')
		returning id into pid;
		insert into public.carga_alumnos_linea (carga_id, grupo_letra, nombre_completo, padron_id)
		values (cid, rec.grupo, rec.nombre, pid);
	end loop;
end $$;

commit;
