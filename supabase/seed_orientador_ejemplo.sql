-- Orientador de ejemplo (ejecutar en Supabase SQL Editor después de aida_base_completa.sql)
--
-- Correo: orientadro@cecyteh.edu.mx
-- Contraseña: 123456789
-- (Cámbiala en producción; esta clave es débil.)
--
-- Otro hash: cd aida-web && node -e "console.log(require('bcryptjs').hashSync('TU_CLAVE', 10))"

insert into public.orientadores (email, password_hash, nombre)
values (
	'orientadro@cecyteh.edu.mx',
	'$2a$10$fFuw61JsXxwqZoO34tZjFuZb3KDiscHOgNGYHSw6fLmuN.ShrGViC',
	'Orientador CECYTEH'
)
on conflict (email) do update set
	nombre = excluded.nombre,
	password_hash = excluded.password_hash;
