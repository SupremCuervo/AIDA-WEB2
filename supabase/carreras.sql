-- Ejecutar en Supabase SQL Editor si ya tienes el resto del esquema.
-- Catálogo de carreras y vínculo en padrón (grado 1: sin carrera; 2.° en adelante: obligatorio elegir en la app).

create table if not exists public.carreras (
	id uuid primary key default gen_random_uuid(),
	codigo text not null unique,
	nombre text not null
);

alter table public.carreras enable row level security;

comment on table public.carreras is 'Catálogo de carreras para alumnos de 2.° grado en adelante.';

insert into public.carreras (codigo, nombre) values
	('PROGRAMACION', 'Programación'),
	('ENFERMERIA', 'Enfermería'),
	('GESTION', 'Gestión')
on conflict (codigo) do update set nombre = excluded.nombre;

alter table public.padron_alumnos add column if not exists carrera_id uuid references public.carreras (id) on delete set null;

comment on column public.padron_alumnos.carrera_id is 'Solo si grado mostrado >= 2; debe quedar null en grado 1.';
