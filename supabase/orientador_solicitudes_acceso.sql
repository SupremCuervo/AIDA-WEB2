alter table public.orientadores
	add column if not exists estado_acceso text not null default 'activo'
	check (estado_acceso in ('activo', 'inactivo'));

comment on column public.orientadores.estado_acceso is 'Control de acceso al panel orientador: solo activo puede iniciar sesión.';

create table if not exists public.orientador_solicitudes_acceso (
	id uuid primary key default gen_random_uuid(),
	email text not null unique,
	password_hash text not null,
	estado text not null default 'pendiente' check (estado in ('pendiente', 'aceptada', 'rechazada')),
	creado_en timestamptz not null default now(),
	revisado_en timestamptz null,
	revisado_por_orientador_id uuid null references public.orientadores(id) on delete set null
);

alter table public.orientador_solicitudes_acceso enable row level security;

comment on table public.orientador_solicitudes_acceso is 'Solicitudes de acceso de orientadores pendientes de aceptación/rechazo.';
