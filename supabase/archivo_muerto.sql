-- Archivo muerto (inactivos): el expediente deja de estar activo pero los datos permanecen.

alter table public.padron_alumnos add column if not exists archivo_muerto_en timestamptz null;

comment on column public.padron_alumnos.archivo_muerto_en is 'Expediente bajado a archivo muerto (inactivo). Los datos se conservan; el alumno no puede entrar hasta reactivar.';
