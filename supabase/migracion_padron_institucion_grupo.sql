-- Padrón anclado a institucion_grupos; grupo_tokens solo 1.° (clave). Al subir de grado se borra el token.
-- Periodo asocia secciones (institucion_grupos), no tokens.
-- Ejecutar en Supabase SQL Editor (backup antes).

-- 0) Asegurar filas en institucion_grupos y enlaces en grupo_tokens (igual que institucion_grupos.sql)
INSERT INTO public.institucion_grupos (grado, grupo)
SELECT DISTINCT
	CASE
		WHEN trim(gt.grado) ~ '^[1-6]$' THEN trim(gt.grado)::smallint
		ELSE 1::smallint
	END,
	upper(trim(gt.grupo))
FROM public.grupo_tokens gt
WHERE trim(gt.grupo) <> ''
ON CONFLICT (grado, grupo) DO NOTHING;

UPDATE public.grupo_tokens gt
SET institucion_grupo_id = ig.id
FROM public.institucion_grupos ig
WHERE
	gt.institucion_grupo_id IS NULL
	AND trim(gt.grado) = ig.grado::text
	AND upper(trim(gt.grupo)) = upper(trim(ig.grupo));

-- 1) Columna en padrón
ALTER TABLE public.padron_alumnos
ADD COLUMN IF NOT EXISTS institucion_grupo_id uuid REFERENCES public.institucion_grupos (id) ON DELETE SET NULL;

COMMENT ON COLUMN public.padron_alumnos.institucion_grupo_id IS 'Sección (grado+letra); obligatoria si grupo_token_id es null (p. ej. 2.° sin clave).';

-- 2) Backfill desde tokens
UPDATE public.padron_alumnos p
SET institucion_grupo_id = gt.institucion_grupo_id
FROM public.grupo_tokens gt
WHERE p.grupo_token_id = gt.id
	AND p.institucion_grupo_id IS NULL
	AND gt.institucion_grupo_id IS NOT NULL;

UPDATE public.padron_alumnos p
SET institucion_grupo_id = ig.id
FROM public.grupo_tokens gt
JOIN public.institucion_grupos ig
	ON ig.grado = CASE
		WHEN trim(gt.grado) ~ '^[1-6]$' THEN trim(gt.grado)::smallint
		ELSE 1::smallint
	END
	AND upper(trim(ig.grupo)) = upper(trim(gt.grupo))
WHERE p.grupo_token_id = gt.id
	AND p.institucion_grupo_id IS NULL;

-- 3) FK grupo_token_id: CASCADE → SET NULL y nullable
ALTER TABLE public.padron_alumnos DROP CONSTRAINT IF EXISTS padron_alumnos_grupo_token_id_fkey;
ALTER TABLE public.padron_alumnos ALTER COLUMN grupo_token_id DROP NOT NULL;
ALTER TABLE public.padron_alumnos ADD CONSTRAINT padron_alumnos_grupo_token_id_fkey
	FOREIGN KEY (grupo_token_id) REFERENCES public.grupo_tokens (id) ON DELETE SET NULL;

-- 4) Unicidad por nombre (índices parciales)
ALTER TABLE public.padron_alumnos DROP CONSTRAINT IF EXISTS padron_alumnos_grupo_token_id_nombre_completo_key;

DROP INDEX IF EXISTS uq_padron_token_nombre;
DROP INDEX IF EXISTS uq_padron_ig_nombre;

CREATE UNIQUE INDEX uq_padron_token_nombre
	ON public.padron_alumnos (grupo_token_id, nombre_completo)
	WHERE grupo_token_id IS NOT NULL;

CREATE UNIQUE INDEX uq_padron_ig_nombre
	ON public.padron_alumnos (institucion_grupo_id, nombre_completo)
	WHERE institucion_grupo_id IS NOT NULL AND grupo_token_id IS NULL;

ALTER TABLE public.padron_alumnos DROP CONSTRAINT IF EXISTS padron_tiene_grupo_o_token;
ALTER TABLE public.padron_alumnos ADD CONSTRAINT padron_tiene_grupo_o_token CHECK (
	grupo_token_id IS NOT NULL OR institucion_grupo_id IS NOT NULL
);

-- 5) Periodo por sección (reemplaza periodo_grupo_tokens)
CREATE TABLE IF NOT EXISTS public.periodo_institucion_grupos (
	periodo_id uuid NOT NULL REFERENCES public.orientador_semestre_fechas (id) ON DELETE CASCADE,
	institucion_grupo_id uuid NOT NULL REFERENCES public.institucion_grupos (id) ON DELETE CASCADE,
	asignado_en timestamptz NOT NULL DEFAULT now(),
	PRIMARY KEY (periodo_id, institucion_grupo_id)
);

CREATE INDEX IF NOT EXISTS idx_periodo_institucion_grupos_ig ON public.periodo_institucion_grupos (institucion_grupo_id);

ALTER TABLE public.periodo_institucion_grupos ENABLE ROW LEVEL SECURITY;

COMMENT ON TABLE public.periodo_institucion_grupos IS 'Secciones del catálogo asignadas al ciclo de semestre (orientador_semestre_fechas.id).';

INSERT INTO public.periodo_institucion_grupos (periodo_id, institucion_grupo_id)
SELECT DISTINCT p.periodo_id, COALESCE(gt.institucion_grupo_id, ig.id)
FROM public.periodo_grupo_tokens p
INNER JOIN public.grupo_tokens gt ON gt.id = p.grupo_token_id
LEFT JOIN public.institucion_grupos ig
	ON ig.grado = CASE
		WHEN trim(gt.grado) ~ '^[1-6]$' THEN trim(gt.grado)::smallint
		ELSE 1::smallint
	END
	AND upper(trim(ig.grupo)) = upper(trim(gt.grupo))
WHERE COALESCE(gt.institucion_grupo_id, ig.id) IS NOT NULL
ON CONFLICT DO NOTHING;

DROP TABLE IF EXISTS public.periodo_grupo_tokens;
