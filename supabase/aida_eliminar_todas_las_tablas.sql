-- =============================================================================
-- AIDA: eliminar todas las tablas y funciones del esquema usado por la app
-- =============================================================================
-- Ejecutar en Supabase SQL Editor (staging/producción con backup previo).
-- Solo borra objetos listados aquí; no toca tablas de otros proyectos en public
-- (p. ej. storage.* vive en otro esquema).
--
-- Si quieres vaciar TODO el esquema public de Supabase (peligroso), usa al final
-- el bloque comentado DROP SCHEMA.
-- =============================================================================

begin;

-- Tablas (orden: dependientes primero). CASCADE quita triggers e índices.
drop table if exists public.periodo_institucion_grupos cascade;
drop table if exists public.entregas_documento_alumno cascade;
drop table if exists public.cuentas_alumno cascade;
drop table if exists public.padron_alumnos cascade;
drop table if exists public.grupo_tokens cascade;
drop table if exists public.orientador_plantillas cascade;
drop table if exists public.orientadores cascade;
drop table if exists public.periodos_academicos cascade;
drop table if exists public.orientador_semestre_fechas cascade;
drop table if exists public.carreras cascade;
drop table if exists public.institucion_grupos cascade;
drop table if exists public.logs cascade;

-- Funciones RPC / triggers (firmas completas)
drop function if exists public.registrar_log(text, uuid, text, text, text, text, jsonb, text) cascade;
drop function if exists public.aud_archivar_padrones(uuid[], uuid, text, uuid, text) cascade;
drop function if exists public.aud_reactivar_padron(uuid, text, uuid, text) cascade;
drop function if exists public.logs_trigger_auditoria_fila() cascade;

commit;

-- -----------------------------------------------------------------------------
-- OPCIÓN NUCLEAR (solo si sabes lo que haces): borrar TODO public y recrearlo
-- -----------------------------------------------------------------------------
-- No ejecutes en producción sin backup. Supabase puede recrear objetos internos
-- al volver a desplegar; suele preferirse borrar solo las tablas de arriba.
--
-- begin;
-- drop schema if exists public cascade;
-- create schema public;
-- grant usage on schema public to postgres, anon, authenticated, service_role;
-- grant all on schema public to postgres, service_role;
-- grant usage on schema public to anon, authenticated;
-- commit;
--
-- Tras eso tendrías que volver a ejecutar aida_base_completa.sql y revisar
-- extensiones (pgcrypto) y políticas que Supabase genere por defecto.
