-- Catálogo de secciones: grados 1–6 × grupos A–K (66 filas).
-- Idempotente: no duplica (unique grado, grupo). Ejecutar en Supabase SQL Editor si faltan letras (ej. 1° F).

insert into public.institucion_grupos (grado, grupo)
select g.n, upper(trim(l.x))
from generate_series(1, 6) as g(n)
cross join (
	values
		('A'),
		('B'),
		('C'),
		('D'),
		('E'),
		('F'),
		('G'),
		('H'),
		('I'),
		('J'),
		('K')
) as l(x)
on conflict (grado, grupo) do nothing;

-- Si un alumno ya está en grado 2+ en padrón pero falta token en esa sección (misma letra),
-- ejecuta grupo_tokens_completar_secciones_sin_clave.sql (solo esos casos; no rellena todo el catálogo).
