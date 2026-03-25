-- OPCIONAL y DESTRUCTIVO: limpiar el catálogo de secciones y regenerarlo desde grupo_tokens.
-- Ejecuta solo tras backup. Requiere migracion_padron_institucion_grupo.sql aplicada.

update public.padron_alumnos set institucion_grupo_id = null where institucion_grupo_id is not null;
update public.grupo_tokens set institucion_grupo_id = null where institucion_grupo_id is not null;

truncate table public.periodo_institucion_grupos;

truncate table public.institucion_grupos restart identity;

insert into public.institucion_grupos (grado, grupo)
select distinct
	case
		when trim(gt.grado) ~ '^[1-6]$' then trim(gt.grado)::smallint
		else 1::smallint
	end,
	upper(trim(gt.grupo))
from public.grupo_tokens gt
where trim(gt.grupo) <> ''
on conflict (grado, grupo) do nothing;

update public.grupo_tokens gt
set institucion_grupo_id = ig.id
from public.institucion_grupos ig
where
	trim(gt.grado) = ig.grado::text
	and upper(trim(gt.grupo)) = upper(trim(ig.grupo));

update public.padron_alumnos p
set institucion_grupo_id = gt.institucion_grupo_id
from public.grupo_tokens gt
where p.grupo_token_id = gt.id
	and gt.institucion_grupo_id is not null;
