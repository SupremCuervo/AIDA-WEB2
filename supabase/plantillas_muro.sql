-- Plantillas compartidas entre orientadores (muro). El PDF base se guarda; las anotaciones en el editor no se persisten.

create table if not exists public.orientador_plantillas (
	id uuid primary key default gen_random_uuid(),
	titulo text not null default '',
	nombre_archivo text not null,
	ruta_storage text not null unique,
	creado_en timestamptz not null default now(),
	definicion_relleno jsonb
);

alter table public.orientador_plantillas enable row level security;

comment on table public.orientador_plantillas is 'PDFs del muro de plantillas; visibles para todos los orientadores vía API servidor.';

create index if not exists idx_orientador_plantillas_creado on public.orientador_plantillas (creado_en desc);
