-- Verificación rápida del esquema AIDA (ejecutar en Supabase SQL Editor).
-- Revisa tablas, columnas esperadas, extensión pgcrypto y carreras de catálogo.

-- 1) Tablas obligatorias
SELECT
	'1_tablas' AS chequeo,
	t.nombre AS objeto,
	CASE
		WHEN EXISTS (
			SELECT 1
			FROM pg_tables
			WHERE schemaname = 'public' AND tablename = t.nombre
		) THEN 'OK'
		ELSE 'FALTA'
	END AS estado
FROM (
	VALUES
		('grupo_tokens'),
		('institucion_grupos'),
		('padron_alumnos'),
		('carreras'),
		('cuentas_alumno'),
		('entregas_documento_alumno'),
		('orientadores'),
		('orientador_plantillas'),
		('logs')
) AS t(nombre)
ORDER BY t.nombre;

-- 2) Columnas obligatorias (public)
SELECT
	'2_columnas' AS chequeo,
	(c.tabla || '.' || c.columna) AS objeto,
	CASE
		WHEN EXISTS (
			SELECT 1
			FROM information_schema.columns x
			WHERE
				x.table_schema = 'public'
				AND x.table_name = c.tabla
				AND x.column_name = c.columna
		) THEN 'OK'
		ELSE 'FALTA'
	END AS estado
FROM (
	VALUES
		('grupo_tokens', 'fecha_limite_entrega'),
		('grupo_tokens', 'institucion_grupo_id'),
		('padron_alumnos', 'grado_alumno'),
		('padron_alumnos', 'carrera_id'),
		('padron_alumnos', 'matricula'),
		('padron_alumnos', 'archivo_muerto_en'),
		('entregas_documento_alumno', 'etiqueta_personalizada')
) AS c(tabla, columna)
ORDER BY c.tabla, c.columna;

-- 3) Extensión (gen_random_uuid en tablas nuevas)
SELECT
	'3_extension' AS chequeo,
	'pgcrypto' AS objeto,
	CASE
		WHEN EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pgcrypto') THEN 'OK'
		ELSE 'FALTA'
	END AS estado;

-- 4) Carreras de ejemplo (mínimo 3 filas)
SELECT
	'4_carreras' AS chequeo,
	'public.carreras (filas)' AS objeto,
	CASE
		WHEN (SELECT count(*)::int FROM public.carreras) >= 3 THEN 'OK'
		ELSE 'REVISAR (esperadas al menos 3: Programación, Enfermería, Gestión)'
	END AS estado,
	(SELECT count(*)::int FROM public.carreras) AS total_filas;

-- 5) Resumen: todo debe ser OK en 1–3; 4 con total_filas >= 3
-- (Ejecuta manualmente: si algún estado es FALTA, aplica los ALTER/create de schema.sql o los .sql sueltos.)
