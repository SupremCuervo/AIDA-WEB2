-- Matrícula por alumno (desde 2.° grado, junto con carrera).
alter table public.padron_alumnos add column if not exists matricula text;

comment on column public.padron_alumnos.matricula is 'Número o clave de matrícula; solo a partir de 2.° grado (con carrera). Null en 1.°.';
