-- Catálogo de secciones (grado 1–6 + letra). Cada fila es un «grupo real» de la institución.
-- grupo_tokens enlaza opcionalmente 1:1 (un token por sección).
-- Ejecutar en Supabase SQL Editor en bases ya existentes.

create table if not exists public.institucion_grupos (
	id uuid primary key default gen_random_uuid(),
	grado smallint not null check (grado >= 1 and grado <= 6),
	grupo text not null,
	creado_en timestamptz not null default now(),
	unique (grado, grupo)
);

alter table public.institucion_grupos enable row level security;

comment on table public.institucion_grupos is 'Secciones escolares (grado + letra). Los tokens de acceso enlazan aquí; puede existir sección sin token.';

alter table public.grupo_tokens add column if not exists institucion_grupo_id uuid references public.institucion_grupos (id) on delete set null;

create unique index if not exists uq_grupo_tokens_un_token_por_seccion on public.grupo_tokens (institucion_grupo_id) where institucion_grupo_id is not null;

-- Enlazar tokens ya existentes con su sección (crea la sección si faltaba).
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
	gt.institucion_grupo_id is null
	and trim(gt.grado) = ig.grado::text
	and upper(trim(gt.grupo)) = upper(ig.grupo);

-- Plantilla: grados 1–6 con grupos A–E (ajusta letras si tu escuela usa otras).
insert into public.institucion_grupos (grado, grupo)
select g.n, upper(trim(l.x))
from generate_series(1, 6) as g(n)
cross join (
	values ('A'), ('B'), ('C'), ('D'), ('E')
) as l(x)
on conflict (grado, grupo) do nothing;
