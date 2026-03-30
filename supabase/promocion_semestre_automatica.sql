-- Promoción automática por fechas de semestre (orientador_semestre_fechas).
-- Tras aplicar, el job HTTP /api/cron/promocion-semestre marca estas columnas para no repetir el mismo periodo.
--
-- Enlazar el cron (ejemplos):
-- 1) Vercel: ya hay `aida-web/vercel.json` (diario 12:00 UTC); define CRON_SECRET en el proyecto
--    (Vercel lo envía automáticamente en Authorization al invocar el cron).
-- 2) Supabase: extensión pg_cron + pg_net → net.http_get(
--      url := 'https://TU_DOMINIO/api/cron/promocion-semestre',
--      headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_secret', true))
--    );
-- 3) Cualquier scheduler externo (GitHub Actions, etc.) con GET + header Authorization.

alter table public.orientador_semestre_fechas
	add column if not exists promocion_primer_ejecutada_en timestamptz;

alter table public.orientador_semestre_fechas
	add column if not exists promocion_segundo_ejecutada_en timestamptz;

comment on column public.orientador_semestre_fechas.promocion_primer_ejecutada_en is
	'Marca de tiempo en que se aplicó la promoción automática ligada a primer_periodo_fecha.';

comment on column public.orientador_semestre_fechas.promocion_segundo_ejecutada_en is
	'Marca de tiempo en que se aplicó la promoción automática ligada a segundo_periodo_fecha.';
