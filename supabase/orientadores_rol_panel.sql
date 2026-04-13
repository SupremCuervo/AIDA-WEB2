-- =============================================================================
-- AIDA: rol de panel en orientadores (normal vs jefe)
-- =============================================================================
-- normal: acceso al panel habitual, sin historial de acciones ni gestión de
--         solicitudes de nuevos orientadores.
-- jefe:   acceso completo (historial + aceptar/rechazar solicitudes).
--
-- Tras ejecutar, los orientadores existentes quedan como jefe (mismo alcance
-- que antes). Los nuevos registros usan por defecto normal (p. ej. alta vía
-- solicitud aceptada).
--
-- Promover o degradar manualmente:
--   update public.orientadores set rol_panel = 'jefe' where email = 'correo@...';
--   update public.orientadores set rol_panel = 'normal' where email = 'correo@...';
-- =============================================================================

alter table public.orientadores
	add column if not exists rol_panel text;

update public.orientadores
set rol_panel = 'jefe'
where rol_panel is null
	or trim(rol_panel) = '';

alter table public.orientadores
	alter column rol_panel set not null,
	alter column rol_panel set default 'normal';

alter table public.orientadores drop constraint if exists orientadores_rol_panel_chk;

alter table public.orientadores
	add constraint orientadores_rol_panel_chk check (rol_panel in ('normal', 'jefe'));

comment on column public.orientadores.rol_panel is
	'normal: sin historial global ni solicitudes de acceso. jefe: permisos completos en el panel.';
