-- -----------------------------------------------------------------------------
-- Tokens solo donde el padrón ya marca grado escolar superior a la sección
-- enlazada (misma letra de grupo, otro grado). No rellena todo el catálogo:
-- así no se mezclan secciones con cargas históricas (p. ej. un lote solo 1.° A)
-- ni se inventan claves para grupos que aún no usas.
--
-- Ej.: alumno con token de 1.° A y grado_alumno = 2 → si existe institucion_grupos
-- (grado=2, grupo=A) sin token, se inserta un grupo_tokens para esa fila.
--
-- Idempotente por sección (not exists token en ig_new).
-- Revisa clave_acceso (prefijo promo-) y sustituye por claves reales si aplica.
-- -----------------------------------------------------------------------------

insert into public.grupo_tokens (clave_acceso, grupo, grado, institucion_grupo_id, fecha_limite_entrega)
select distinct on (ig_new.id)
	'promo-' || replace(ig_new.id::text, '-', ''),
	trim(ig_new.grupo),
	ig_new.grado::text,
	ig_new.id,
	null::date
from public.padron_alumnos p
cross join lateral (
	select coalesce(
		(
			select gt.institucion_grupo_id
			from public.grupo_tokens gt
			where gt.id = p.grupo_token_id
			limit 1
		),
		p.institucion_grupo_id
	) as base_ig_id
) sec
inner join public.institucion_grupos ig_old on ig_old.id = sec.base_ig_id
inner join public.institucion_grupos ig_new
	on upper(trim(ig_new.grupo)) = upper(trim(ig_old.grupo))
	and ig_new.grado = (trim(both from p.grado_alumno))::integer
where p.archivo_muerto_en is null
	and p.grado_alumno is not null
	and trim(both from p.grado_alumno) ~ '^[1-6]$'
	and (trim(both from p.grado_alumno))::integer > ig_old.grado
	and not exists (
		select 1
		from public.grupo_tokens t
		where t.institucion_grupo_id = ig_new.id
	)
order by ig_new.id;
